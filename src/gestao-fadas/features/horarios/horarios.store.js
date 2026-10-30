'use strict';

/**
 * Acesso ao banco novo da fatia Horários e escala. Escrita: SQL no executor do banco novo (`novo/escritor.js`, só INSERT/UPDATE/SELECT
 * em gf_*, sem DELETE: remover é preencher `removida_em`). Leitura da tela: models do banco novo (`novo/leitura.js`), que
 * funciona com a escrita desligada. As duas formas de linha são as mesmas colunas.
 */

const { randomUUID } = require('crypto');
const { chaveDe } = require('../../_comum/dominio/horarios');

const COLUNAS = 'id, id_tarologo, data_inicio, data_fim, absence_type, today_hours, observacao, updated_at_texto, note_updated_at, note_start_date, note_end_date, command_id, roster_actor, roster_at';
const hora = (v) => String(v).slice(0, 5);

/** Linha(s) de `gf_horarios_excecoes` + períodos -> `ScheduleOverride` do front (campo ausente fica ausente, nunca null). */
function linhaParaExcecao(l, periodos) {
  const o = {
    todayHours: l.today_hours, periods: periodos.map((p) => ({ start: hora(p.inicio), end: hora(p.fim) })), note: l.observacao,
    updatedAt: l.updated_at_texto, absenceType: l.absence_type, startDate: l.data_inicio, endDate: l.data_fim,
  };
  if (l.command_id) o.commandId = l.command_id;
  if (l.note_updated_at) o.noteUpdatedAt = l.note_updated_at;
  if (l.note_start_date) o.noteStartDate = l.note_start_date;
  if (l.note_end_date) o.noteEndDate = l.note_end_date;
  if (l.roster_actor) o.rosterResponse = { actor: l.roster_actor, at: l.roster_at };
  return o;
}

/** Agrupa linhas e períodos em `[{ id, tarotId, key, override }]`. */
function montar(linhas, periodos) {
  const porExcecao = new Map();
  for (const p of [...periodos].sort((a, b) => a.ordem - b.ordem)) {
    if (!porExcecao.has(p.id_excecao)) porExcecao.set(p.id_excecao, []);
    porExcecao.get(p.id_excecao).push(p);
  }
  return linhas.map((l) => {
    const override = linhaParaExcecao(l, porExcecao.get(l.id) || []);
    return { id: l.id, tarotId: l.id_tarologo, key: chaveDe(l.id_tarologo, override), override };
  });
}

const marcas = (n) => Array.from({ length: n }, () => '?').join(', ');

/** Exceções ativas de um tarólogo DENTRO da transação, travando as linhas (`FOR UPDATE`). */
async function ativasDoTarologo(ex, tarotId) {
  // Uma gravação por tarólogo de cada vez, mesmo sem nenhuma linha ainda: a segunda enxerga a revisão nova e vira 409.
  await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_horarios:${tarotId}`]);
  const [linhas] = await ex.execute(`SELECT ${COLUNAS} FROM gf_horarios_excecoes WHERE id_tarologo = ? AND removida_em IS NULL ORDER BY id FOR UPDATE`, [tarotId]);
  if (!linhas.length) return [];
  const [periodos] = await ex.execute(`SELECT id_excecao, ordem, inicio, fim FROM gf_horarios_periodos WHERE id_excecao IN (${marcas(linhas.length)})`, linhas.map((l) => l.id));
  return montar(linhas, periodos);
}

async function inserirExcecao(ex, tarotId, override, operationKey) {
  const id = randomUUID();
  await ex.execute(
    'INSERT INTO gf_horarios_excecoes (id, id_tarologo, data_inicio, data_fim, absence_type, today_hours, observacao, updated_at_texto, note_updated_at, note_start_date, note_end_date, command_id, roster_actor, roster_at, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, tarotId, override.startDate, override.endDate, override.absenceType, override.todayHours, override.note, override.updatedAt,
      override.noteUpdatedAt ?? null, override.noteStartDate ?? null, override.noteEndDate ?? null, override.commandId ?? null,
      override.rosterResponse ? override.rosterResponse.actor : null, override.rosterResponse ? override.rosterResponse.at : null, operationKey],
  );
  for (const [i, p] of override.periods.entries()) {
    await ex.execute('INSERT INTO gf_horarios_periodos (id_excecao, ordem, inicio, fim) VALUES (?, ?, ?, ?)', [id, i + 1, p.start, p.end]);
  }
  return id;
}

const removerExcecao = (ex, id) => ex.execute('UPDATE gf_horarios_excecoes SET removida_em = CURRENT_TIMESTAMP WHERE id = ? AND removida_em IS NULL', [id]);

/** Semana habitual de um tarólogo dentro da transação (travada). */
async function semanaDoTarologo(ex, tarotId) {
  const [linhas] = await ex.execute('SELECT weekday, hours FROM gf_escalas_semanais WHERE id_tarologo = ? FOR UPDATE', [tarotId]);
  return Object.fromEntries(linhas.map((l) => [l.weekday, l.hours]));
}
const inserirDia = (ex, tarotId, dia, horas) => ex.execute('INSERT INTO gf_escalas_semanais (id_tarologo, weekday, hours) VALUES (?, ?, ?)', [tarotId, dia, horas]);
const atualizarDia = (ex, tarotId, dia, horas) => ex.execute('UPDATE gf_escalas_semanais SET hours = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id_tarologo = ? AND weekday = ?', [horas, tarotId, dia]);

/** Leitura da tela (models do banco novo): tudo, ou só um tarólogo. */
async function lerTudo(modelos, tarotId) {
  const onde = tarotId ? { id_tarologo: tarotId } : {};
  const linhas = await modelos.GfHorariosExcecoes.findAll({ where: { ...onde, removida_em: null }, order: [['id_tarologo', 'ASC'], ['data_inicio', 'ASC'], ['id', 'ASC']] });
  const periodos = linhas.length ? await modelos.GfHorariosPeriodos.findAll({ where: { id_excecao: linhas.map((l) => l.id) } }) : [];
  const semanais = await modelos.GfEscalasSemanais.findAll({ where: onde, order: [['id_tarologo', 'ASC']] });
  return { excecoes: montar(linhas, periodos), semanais };
}

module.exports = { montar, ativasDoTarologo, inserirExcecao, removerExcecao, semanaDoTarologo, inserirDia, atualizarDia, lerTudo, linhaParaExcecao };
