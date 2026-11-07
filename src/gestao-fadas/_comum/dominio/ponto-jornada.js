'use strict';

/**
 * Domínio puro da jornada da atendente (relatório "Jornada e atividades" e "Equipe no dia"), porte versionado de
 * `features/admin/staff-workday-model.ts` e `features/admin/staff-day-overview-model.ts` do front da Nice (v702).
 * Regras: período de até 31 dias; janela do turno = dia Fadas (corte configurável); pausas contadas por turno; lacunas só dentro de trecho
 * conectado e trabalhando, nunca além do último sinal; previsão do dia vem da escala, estado atual vem do ponto.
 * Sem banco, sem Express. Se o front mudar a regra, regerar os casos de `scripts/verificar-gf-ponto.js`.
 */

const { operationalWindow, validDate, nextDate, saoPauloWallTimestamp } = require('./operacao-calendario');
const { staffRosterForDate } = require('./ponto-escala');
const { estadoDoTurno } = require('./ponto-turno');

const LIMITE_RELATORIO_DIAS = 31;
const BATIDAS = { start: 'Entrada', pause: 'Iniciou pausa', resume: 'Voltou da pausa', end: 'Encerrou o turno', lost: 'Conexão perdida', restored: 'Conexão restabelecida' };
const ROTULOS = { working: 'Em turno', paused: 'Em pausa', ended: 'Turno encerrado', unconfirmed: 'Saída sem confirmação' };

const validStaffPeriod = (de, ate) => validDate(de) && validDate(ate) && ate >= de && Date.parse(ate) - Date.parse(de) < LIMITE_RELATORIO_DIAS * 86400000;

function workdayWindow(data, turnos, selecionado, agora = Date.now(), historia, dataFinal = data) {
  const dia = selecionado ? operationalWindow(selecionado.operationalDate, selecionado.operationalDate, historia) : operationalWindow(data, dataFinal, historia);
  const primeiro = selecionado ? Date.parse(selecionado.startedAt) : Math.min(Date.parse(dia.startAt), ...turnos.map((s) => Date.parse(s.startedAt)));
  const fimDe = (t) => (t.endedAt ? Date.parse(t.endedAt) + 1 : Math.min(agora + 1, Math.max(Date.parse(dia.endAt), Date.parse(t.lastSeenAt) + 1)));
  const fim = selecionado ? fimDe(selecionado) : Math.max(Date.parse(dia.endAt), ...turnos.map(fimDe));
  return { from: new Date(primeiro).toISOString(), until: new Date(Math.max(primeiro + 1, fim)).toISOString() };
}

function workdayRows(contaId, nome, faixa, turnos, gestao, umbler) {
  const saida = [];
  for (const turno of turnos) {
    if (turno.accountId !== contaId) continue;
    for (const [i, e] of turno.events.entries()) {
      saida.push({
        id: `ponto:${turno.id}:${i}`, at: e.at, source: 'Ponto',
        action: e.kind === 'lost' && 'evidence' in e && e.evidence === 'last-signal' ? 'Último sinal antes da interrupção' : BATIDAS[e.kind],
        author: ['lost', 'restored'].includes(e.kind) ? 'Sistema' : turno.accountName,
      });
    }
  }
  for (const e of gestao) {
    if (!e.at || e.actorId !== contaId || e.actorKind === 'system' || e.actorKind === 'unknown' || e.actionCode === 'history.accessed') continue;
    saida.push({ id: `gestao:${e.id}`, at: e.at, source: 'Gestão', action: e.action, author: e.actorName || nome, detail: e.detail, client: e.clientName || e.clientId, reference: e.recordId, audit: e });
  }
  for (const e of umbler) {
    if (e.actorKind !== 'person' || e.actorId !== contaId) continue;
    saida.push({ id: `umbler:${e.id}`, at: e.at, source: 'Umbler', action: e.action, author: e.actorName || nome, detail: e.detail, reference: e.conversationId, url: e.url, client: e.clientId });
  }
  const primeiro = Date.parse(faixa.from); const fim = Date.parse(faixa.until);
  return saida.filter((r) => Date.parse(r.at) >= primeiro && Date.parse(r.at) < fim)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
}

function workdayPauses(turnos) {
  let count = 0; let duracaoMs = 0; let abertas = 0;
  for (const turno of turnos) {
    let pausadoEm;
    for (const e of turno.events) {
      if (e.kind === 'pause' && pausadoEm === undefined) { pausadoEm = Date.parse(e.at); count++; }
      if (pausadoEm !== undefined && (e.kind === 'resume' || e.kind === 'end')) { duracaoMs += Math.max(0, Date.parse(e.at) - pausadoEm); pausadoEm = undefined; }
    }
    if (pausadoEm !== undefined) abertas++;
  }
  return { count, minutes: Math.floor(duracaoMs / 60000), open: abertas };
}

/** Lacunas nas ações observadas dentro de um trecho aberto e conectado (nunca presume saída). */
function workdayGaps(turnos, acoes, agora, minimo = 30) {
  const saida = [];
  const atividade = acoes.filter((a) => a.source !== 'Ponto').map((a) => Date.parse(a.at)).sort((a, b) => a - b);
  function examinar(inicio, fim) {
    let cursor = inicio;
    for (const em of [...atividade.filter((x) => x > inicio && x < fim), fim]) {
      const minutos = Math.floor((em - cursor) / 60000);
      if (minutos >= minimo) saida.push({ start: cursor, end: em, minutes: minutos });
      cursor = em;
    }
  }
  for (const turno of turnos) {
    let trabalhando = false; let conectado = true; let inicio;
    for (const e of turno.events) {
      const em = Date.parse(e.at);
      if (e.kind === 'start' || e.kind === 'resume') trabalhando = true;
      if (e.kind === 'pause' || e.kind === 'end') trabalhando = false;
      if (e.kind === 'lost') conectado = false;
      if (e.kind === 'restored') conectado = true;
      if (trabalhando && conectado) inicio = inicio === undefined ? em : inicio;
      else if (inicio !== undefined) { examinar(inicio, em); inicio = undefined; }
    }
    if (inicio !== undefined) examinar(inicio, Math.min(agora, Date.parse(turno.lastSeenAt)));
  }
  return saida.sort((a, b) => a.start - b.start);
}

function tocaODia(turno, dia) {
  const ultimo = turno.endedAt || turno.lastSeenAt;
  return Date.parse(turno.startedAt) < dia.end && Date.parse(ultimo) >= dia.start;
}

/** `summarizeStaffDay`: previsão pela escala, estado pelo ponto e faixas de cobertura do dia Fadas. */
function summarizeStaffDay(contas, dados, data, agora, historia) {
  const janela = operationalWindow(data, data, historia);
  const dia = { start: Date.parse(janela.startAt), end: Date.parse(janela.endAt) };
  const registros = new Map(dados.map((r) => [r.accountId, r]));
  const linhas = contas.map((conta) => {
    const registro = registros.get(conta.id);
    const periodos = [];
    // O turno da madrugada da data civil anterior e a manhã seguinte também tocam este dia Fadas.
    for (const civil of [nextDate(data, -1), data, nextDate(data)]) {
      for (const previsto of staffRosterForDate(registro && registro.roster, civil) || []) {
        const inicio = Math.max(dia.start, Date.parse(saoPauloWallTimestamp(civil, previsto.start)));
        const diaFim = previsto.end < previsto.start ? nextDate(civil) : civil;
        const fim = Math.min(dia.end, Date.parse(saoPauloWallTimestamp(diaFim, previsto.end)));
        if (fim > inicio) periodos.push({ start: inicio, end: fim });
      }
    }
    const turnos = ((registro && registro.shifts) || []).filter((s) => tocaODia(s, dia) && Date.parse(s.startedAt) <= agora)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const ultimo = turnos[0];
    const estado = ultimo ? estadoDoTurno(ultimo, agora) : undefined;
    const atravessa = ultimo && Date.parse(ultimo.endedAt || ultimo.lastSeenAt) > dia.end;
    const rotulo = atravessa ? 'Continuou no dia seguinte' : estado ? ROTULOS[estado] : dia.start > agora ? 'Dia futuro' : 'Sem entrada registrada';
    const escala = staffRosterForDate(registro && registro.roster, data);
    return { id: conta.id, name: conta.name, periods: periodos, last: ultimo, status: atravessa ? undefined : estado, label: rotulo, rosterLabel: !escala ? 'Sem escala definida' : escala.length === 0 ? 'Folga' : 'Sem turno neste dia operacional' };
  });
  const limites = [...new Set([dia.start, dia.end, ...linhas.flatMap((r) => r.periods.flatMap((p) => [p.start, p.end]))])].sort((a, b) => a - b);
  const faixas = [];
  for (let i = 1; i < limites.length; i++) {
    const start = limites[i - 1]; const end = limites[i];
    faixas.push({ start, end, names: linhas.filter((r) => r.periods.some((p) => p.start <= start && p.end >= end)).map((r) => r.name) });
  }
  return { rows: linhas, bands: faixas, day: dia };
}

module.exports = { LIMITE_RELATORIO_DIAS, validStaffPeriod, workdayWindow, workdayRows, workdayPauses, workdayGaps, summarizeStaffDay };
