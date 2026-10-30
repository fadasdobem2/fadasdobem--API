'use strict';

/**
 * Acesso ao banco novo da fatia Presença. Escrita: SQL no executor do banco novo (`novo/escritor.js`, só INSERT/UPDATE/SELECT em gf_*;
 * o pedido de confirmação limpo é `limpa_em`, nunca DELETE). Leitura da tela: models do banco novo (`novo/leitura.js`), que funciona
 * com a escrita desligada. O perfil que o domínio (`_comum/dominio/presenca.js`) usa é o `TarotProfile` do front, só com os campos de presença.
 */

const HISTORICO_MAX = 50; // entradas mais recentes que a leitura devolve e o domínio enxerga

const iso = (v) => (v === null || v === undefined ? undefined : new Date(v).toISOString());
const dia = (v) => (v === null || v === undefined ? undefined : String(v).slice(0, 10));
const defin = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

/** Linhas do banco -> `TarotProfile` parcial (campo ausente fica ausente, nunca null). */
function montarPerfil(estado, confirmacao, historico) {
  const confirmacaoAtiva = confirmacao && !confirmacao.limpa_em ? defin({
    reason: confirmacao.reason, requestedAt: iso(confirmacao.requested_at), deadlineAt: iso(confirmacao.deadline_at), offlineAt: iso(confirmacao.offline_at),
    idleTimeoutMs: confirmacao.idle_timeout_ms === null || confirmacao.idle_timeout_ms === undefined ? undefined : Number(confirmacao.idle_timeout_ms),
  }) : undefined;
  const periodo = estado.confirmed_period_date ? { date: dia(estado.confirmed_period_date), startAt: iso(estado.confirmed_period_start_at), endAt: iso(estado.confirmed_period_end_at) } : undefined;
  return defin({
    id: estado.id_tarologo, shiftStatus: estado.shift_status, online: estado.shift_status !== 'Offline', status: estado.shift_status === 'Em pausa' ? 'Pausa' : 'Disponível',
    expectedReturn: iso(estado.expected_return), returnForecast: estado.return_forecast ? json(estado.return_forecast) : undefined, pauseReason: estado.pause_reason || undefined,
    presenceLastActivityAt: iso(estado.presence_last_activity_at), presenceConfirmedAt: iso(estado.presence_confirmed_at), presenceScheduleUpdatedAt: iso(estado.presence_schedule_updated_at),
    presenceConfirmedPeriod: periodo, presenceConfirmation: confirmacaoAtiva, shiftAvailableSince: iso(estado.shift_available_since), shiftExit: estado.shift_exit || undefined,
    presenceDate: dia(estado.presence_date), returnUntil: iso(estado.return_until),
    presenceHistory: (historico || []).map((h) => ({ id: h.id, actorId: h.actor_id, actorName: h.actor_name, at: iso(h.at), date: dia(h.date), before: h.antes, after: h.depois })),
  });
}

/** Leitura da tela (models do banco novo): todos os estados, ou só um tarólogo. */
async function lerTudo(modelos, tarotId) {
  const onde = tarotId ? { id_tarologo: tarotId } : {};
  const estados = await modelos.GfPresencaEstado.findAll({ where: onde, order: [['id_tarologo', 'ASC']] });
  const confirmacoes = await modelos.GfPresencaConfirmacoes.findAll({ where: onde });
  const historicos = await modelos.GfPresencaHistorico.findAll({ where: onde, order: [['id_tarologo', 'ASC'], ['ordem', 'ASC']] });
  const porTarologo = (linhas, id) => linhas.filter((l) => l.id_tarologo === id);
  return estados.map((e) => ({ perfil: montarPerfil(e, confirmacoes.find((c) => c.id_tarologo === e.id_tarologo), porTarologo(historicos, e.id_tarologo).slice(-HISTORICO_MAX)), revisao: Number(e.revisao), ultimaAtividade: e.presence_last_activity_at }));
}

/** Estado de um tarólogo DENTRO da transação, travado (lock consultivo + FOR UPDATE). `null` se ainda não há estado. */
async function carregarTravado(ex, tarotId) {
  await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_presenca:${tarotId}`]);
  const [estados] = await ex.execute('SELECT * FROM gf_presenca_estado WHERE id_tarologo = ? FOR UPDATE', [tarotId]);
  if (!estados[0]) return null;
  const [confirmacoes] = await ex.execute('SELECT * FROM gf_presenca_confirmacoes WHERE id_tarologo = ? FOR UPDATE', [tarotId]);
  const [historico] = await ex.execute(`SELECT id, actor_id, actor_name, at, date, antes, depois, ordem FROM gf_presenca_historico WHERE id_tarologo = ? ORDER BY ordem DESC LIMIT ${HISTORICO_MAX}`, [tarotId]);
  return { perfil: montarPerfil(estados[0], confirmacoes[0], historico.reverse()), revisao: Number(estados[0].revisao), ultimaAtividade: estados[0].presence_last_activity_at };
}

const COLUNAS = ['shift_status', 'shift_exit', 'pause_reason', 'presence_date', 'expected_return', 'return_until', 'return_forecast', 'shift_available_since', 'presence_last_activity_at', 'presence_confirmed_at',
  'presence_schedule_updated_at', 'confirmed_period_date', 'confirmed_period_start_at', 'confirmed_period_end_at'];
const valoresDe = (p) => [p.shiftStatus, p.shiftExit ?? null, p.pauseReason ?? null, p.presenceDate ?? null, p.expectedReturn ?? null, p.returnUntil ?? null, p.returnForecast ? JSON.stringify(p.returnForecast) : null,
  p.shiftAvailableSince ?? null, p.presenceLastActivityAt ?? null, p.presenceConfirmedAt ?? null, p.presenceScheduleUpdatedAt ?? null,
  p.presenceConfirmedPeriod ? p.presenceConfirmedPeriod.date : null, p.presenceConfirmedPeriod ? p.presenceConfirmedPeriod.startAt : null, p.presenceConfirmedPeriod ? p.presenceConfirmedPeriod.endAt : null];

/** Grava o estado novo (insere ou atualiza), o pedido de confirmação e as entradas de histórico que o perfil antigo não tinha. Devolve a revisão. */
async function gravar(ex, tarotId, antes, depois, { operationKey = null } = {}) {
  let revisao = 1;
  if (!antes) {
    await ex.execute(`INSERT INTO gf_presenca_estado (id_tarologo, ${COLUNAS.join(', ')}) VALUES (?, ${COLUNAS.map(() => '?').join(', ')})`, [tarotId, ...valoresDe(depois)]);
  } else {
    revisao = antes.revisao + 1;
    await ex.execute(`UPDATE gf_presenca_estado SET ${COLUNAS.map((c) => `${c} = ?`).join(', ')}, revisao = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id_tarologo = ?`, [...valoresDe(depois), revisao, tarotId]);
  }
  const c = depois.presenceConfirmation;
  const [existe] = await ex.execute('SELECT id_tarologo FROM gf_presenca_confirmacoes WHERE id_tarologo = ? FOR UPDATE', [tarotId]);
  if (c) {
    const v = [c.reason, c.requestedAt, c.deadlineAt ?? null, c.offlineAt ?? null, c.idleTimeoutMs ?? null];
    if (existe[0]) await ex.execute('UPDATE gf_presenca_confirmacoes SET reason = ?, requested_at = ?, deadline_at = ?, offline_at = ?, idle_timeout_ms = ?, limpa_em = NULL WHERE id_tarologo = ?', [...v, tarotId]);
    else await ex.execute('INSERT INTO gf_presenca_confirmacoes (id_tarologo, reason, requested_at, deadline_at, offline_at, idle_timeout_ms) VALUES (?, ?, ?, ?, ?, ?)', [tarotId, ...v]);
  } else if (existe[0]) {
    await ex.execute('UPDATE gf_presenca_confirmacoes SET limpa_em = CURRENT_TIMESTAMP WHERE id_tarologo = ? AND limpa_em IS NULL', [tarotId]);
  }
  const conhecidos = new Set(((antes && antes.perfil.presenceHistory) || []).map((h) => h.id));
  const novas = (depois.presenceHistory || []).filter((h) => !conhecidos.has(h.id));
  if (novas.length) {
    const [[{ maximo }]] = await ex.execute('SELECT COALESCE(MAX(ordem), 0) AS maximo FROM gf_presenca_historico WHERE id_tarologo = ?', [tarotId]);
    let ordem = Number(maximo);
    for (const h of novas) {
      ordem += 1;
      await ex.execute('INSERT INTO gf_presenca_historico (id, id_tarologo, ordem, actor_id, actor_name, at, date, antes, depois, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [h.id, tarotId, ordem, h.actorId, h.actorName, h.at, h.date, h.before, h.after, operationKey]);
    }
  }
  return revisao;
}

/** Batimento: só o carimbo de atividade, sem mexer na revisão. */
const registrarAtividade = (ex, tarotId, emIso) => ex.execute('UPDATE gf_presenca_estado SET presence_last_activity_at = ? WHERE id_tarologo = ?', [emIso, tarotId]);

/** Tarólogos que o job precisa olhar: com turno Disponível ou com pedido de confirmação ainda aberto/obsoleto. */
async function candidatos(ex) {
  const [linhas] = await ex.execute("SELECT e.id_tarologo FROM gf_presenca_estado e LEFT JOIN gf_presenca_confirmacoes c ON c.id_tarologo = e.id_tarologo AND c.limpa_em IS NULL WHERE e.shift_status = 'Disponível' OR c.id_tarologo IS NOT NULL ORDER BY e.id_tarologo");
  return linhas.map((l) => l.id_tarologo);
}

module.exports = { HISTORICO_MAX, montarPerfil, lerTudo, carregarTravado, gravar, registrarAtividade, candidatos };
