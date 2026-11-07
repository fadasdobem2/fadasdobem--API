'use strict';

/**
 * `schedules` do snapshot (Maturacao/59, 3.9; Maturacao/60, seção 10): a escala semanal + as exceções por dia, em linhas
 * `{ id, tarologistId, date, startsAt, endsAt, status, updatedAt }`, uma por período, para o dia operacional de hoje e o de amanhã.
 *  - Exceção ativa que cobre o dia vale no lugar da semana; ausência (férias, licença, folga estendida) ou exceção sem horário = `status:'off'`.
 *  - Semana: o texto da escala vira períodos (`periodosDoTexto`); dia sem escala não gera linha (a Lilly lê "sem escala", não "folga").
 *  - Ids determinísticos: `<tarólogo>@<dia>#<n>`. Nada de observação (texto livre) sai.
 */

const { periodosDoTexto } = require('../../../_comum/dominio/horarios');
const { periodoOperacional, diaDaSemana } = require('./contexto.tempo');

const iso = (v) => (v ? new Date(v).toISOString() : undefined);
const hhmm = (v) => `${v}`.slice(0, 5);
const dia = (v) => `${v}`.slice(0, 10);

/** A exceção mais específica (menor intervalo; empate: a de maior id) que cobre o dia. */
function excecaoDoDia(excecoes, tarotId, data) {
  const cobre = excecoes.filter((e) => e.id_tarologo === tarotId && dia(e.data_inicio) <= data && dia(e.data_fim) >= data);
  const largura = (e) => Date.parse(dia(e.data_fim)) - Date.parse(dia(e.data_inicio));
  return cobre.sort((a, b) => largura(a) - largura(b) || (a.id < b.id ? 1 : -1))[0];
}

const linha = (tarotId, data, n, extra) => ({ id: `${tarotId}@${data}#${n}`, tarologistId: tarotId, date: data, ...extra });

function periodosDaExcecao(e, periodos) {
  const doBanco = periodos.filter((p) => p.id_excecao === e.id).sort((a, b) => a.ordem - b.ordem).map((p) => ({ start: hhmm(p.inicio), end: hhmm(p.fim) }));
  return doBanco.length ? doBanco : periodosDoTexto(e.today_hours || '');
}

/** @returns {object[]} linhas de `schedules` para os tarólogos e dias pedidos. */
function montarEscalas({ tarologistIds, dias, horarios }) {
  const saida = [];
  const { excecoes, periodos, semanais } = horarios;
  for (const tarotId of tarologistIds) {
    for (const data of dias) {
      const exc = excecaoDoDia(excecoes, tarotId, data);
      let lista; let atualizado; let folga = false;
      if (exc) {
        atualizado = iso(exc.atualizado_em);
        folga = exc.absence_type !== 'Nenhuma';
        lista = folga ? [] : periodosDaExcecao(exc, periodos);
        if (!folga && !lista.length) folga = true;
      } else {
        const semana = semanais.find((s) => s.id_tarologo === tarotId && s.weekday === diaDaSemana(data));
        if (!semana) continue;
        atualizado = iso(semana.atualizado_em);
        lista = periodosDoTexto(semana.hours || '');
        folga = !lista.length && /folga/i.test(semana.hours || '');
        if (!lista.length && !folga) continue;
      }
      if (folga) { saida.push(linha(tarotId, data, 0, { status: 'off', updatedAt: atualizado })); continue; }
      lista.forEach((p, i) => {
        const t = periodoOperacional(data, p.start, p.end);
        if (t) saida.push(linha(tarotId, data, i + 1, { startsAt: t.startsAt, endsAt: t.endsAt, status: 'active', updatedAt: atualizado }));
      });
    }
  }
  return saida;
}

/** Notas do horário no formato do contrato (sem o texto livre). */
const montarNotasDoHorario = (notas) => notas.map((n) => Object.fromEntries(Object.entries({
  id: n.id, tarologistId: n.tarologistId, scheduleId: n.scheduleId || undefined, date: n.date, expectedAt: n.expectedAt || undefined, endsAt: n.endsAt || undefined, at: n.at, status: n.status,
}).filter(([, v]) => v !== undefined && v !== null)));

module.exports = { montarEscalas, montarNotasDoHorario };
