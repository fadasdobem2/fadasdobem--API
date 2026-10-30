'use strict';

/**
 * A ENTRADA do fluxo do painel (`_comum/dominio/painel-fluxo.js`) lida do servidor, dentro da transação (Maturacao/39): os agendamentos
 * abertos (as reservas cruzam filas), as consultas abertas e as encerradas há pouco (mais os pedidos de mais tempo ainda ativos), o
 * cadastro e a presença do tarólogo, a escala semanal e as exceções, a admissão do dia, as restrições e a conta do tarólogo. Cada fonte
 * só entra se a fatia dela está ligada (flag), como no resto do gate. O relógio é o `agora` recebido: o fluxo nunca chama `Date.now()`.
 * Só o tarólogo-alvo entra em `profiles` (o `freeNow` dele não depende das demais): a lista inteira do painel segue no navegador.
 */

const store = require('./agenda.store');
const adm = require('./agenda-admissao.store');
const ciclo = require('../consultas-ciclo/ciclo.store');
const presencaStore = require('../presenca/presenca.store');
const horariosStore = require('../horarios/horarios.store');
const { hojeDe } = require('../../_comum/dominio/painel-tempo');
const base = require('./agenda-fila.contexto');

const { ligado } = base;
const COLUNAS_CONSULTA = 'id, id_consulta_legado, legado_estado, id_tarologo, id_cliente, status, item, version';

/** Consultas que o painel enxerga: em curso, encerradas nas últimas 48 h e pedidos de mais tempo ainda ativos. */
async function consultasDoPainel(ex) {
  const [linhas] = await ex.execute(`SELECT ${COLUNAS_CONSULTA} FROM gf_consultas_ext WHERE status = 'Em curso' OR encerrada_em > CURRENT_TIMESTAMP - INTERVAL '2 day' OR (item -> 'tarologistMoreTimeRequest' ->> 'active') = 'true' ORDER BY id`, []);
  return linhas.map((l) => ciclo.linhaParaRegistro(l).item);
}

async function excecoesDoTarologo(ex, tarotId) {
  const [linhas] = await ex.execute('SELECT id, id_tarologo, data_inicio, data_fim, absence_type, today_hours, observacao, updated_at_texto, note_updated_at, note_start_date, note_end_date, command_id, roster_actor, roster_at FROM gf_horarios_excecoes WHERE id_tarologo = ? AND removida_em IS NULL ORDER BY id', [tarotId]);
  if (!linhas.length) return {};
  const [periodos] = await ex.execute(`SELECT id_excecao, ordem, inicio, fim FROM gf_horarios_periodos WHERE id_excecao IN (${linhas.map(() => '?').join(', ')})`, linhas.map((l) => l.id));
  return Object.fromEntries(horariosStore.montar(linhas, periodos).map((a) => [a.key, a.override]));
}
async function semanaDoTarologo(ex, tarotId) {
  const [linhas] = await ex.execute('SELECT weekday, hours FROM gf_escalas_semanais WHERE id_tarologo = ?', [tarotId]);
  return Object.fromEntries(linhas.map((l) => [l.weekday, l.hours]));
}

/**
 * `accounts` do front: a conta da taróloga (inativa ou bloqueada tira a taróloga da operação). As tabelas de acesso (`users`, `specialists`) ficam
 * FORA do executor da escrita (só `gf_*`), então a leitura é avulsa, em outra conexão, sem trava. Sem a fatia Contas ou sem essas tabelas, sem contas.
 */
async function contasDoTarologo(tarotId) {
  if (!ligado('GF_FATIA_CONTAS')) return [];
  try {
    const { sequelize } = require('../../../config/database');
    const { QueryTypes } = require('sequelize');
    const linhas = await sequelize.query("SELECT u.is_active, u.blocked_at FROM gf_tarologos_perfil p JOIN specialists spec ON spec.slug = p.conta_slug AND spec.deleted_at IS NULL JOIN users u ON u.id = spec.user_id AND u.deleted_at IS NULL WHERE p.tarot_id = :tarotId AND u.role = 'TAROLOGA'", { type: QueryTypes.SELECT, replacements: { tarotId } });
    return linhas.map((l) => ({ tarotId, role: 'tarologa', active: Boolean(l.is_active) && !l.blocked_at, access: 'Ativo' }));
  } catch (_e) { return []; }
}

async function restricoesDoTarologo(ex, tarotId) {
  if (!ligado('GF_FATIA_RESTRICOES')) return [];
  const [linhas] = await ex.execute('SELECT id, id_cliente, id_tarologo FROM gf_restricoes WHERE id_tarologo = ? AND ativa = true', [tarotId]);
  return linhas.map((l) => ({ id: l.id, clientId: String(l.id_cliente), tarotId: l.id_tarologo, active: true }));
}

/** `{ agenda, consultations, profiles, accounts, overrides, intakeEvents, restrictions, date, now, cadastro }` para `tarotId`. */
async function carregarEntrada(ex, { tarotId, agora }) {
  const data = hojeDe(agora);
  const [registros, consultations, cadastro, intakeEvents] = [await store.abertosTodos(ex), await consultasDoPainel(ex), await base.cadastroDe(tarotId), await adm.eventosDoDia(ex, tarotId, data)];
  const profiles = [];
  let accounts = []; let overrides = {};
  if (cadastro) {
    const semana = await semanaDoTarologo(ex, tarotId); overrides = await excecoesDoTarologo(ex, tarotId); accounts = await contasDoTarologo(tarotId);
    // Sem a fatia Presença o tarólogo é tratado como disponível; com ela, sem estado gravado ele é Offline (o front mostra assim).
    let presenca = { online: true, status: 'Disponível', shiftStatus: 'Disponível' };
    if (ligado('GF_FATIA_PRESENCA')) { const estado = await presencaStore.carregarTravado(ex, tarotId); presenca = estado ? estado.perfil : { online: false, status: 'Disponível', shiftStatus: 'Offline' }; }
    profiles.push({ id: tarotId, name: cadastro.name, registrationActive: cadastro.registrationActive, official: [], today: '', note: '', ...presenca, weeklySchedule: semana });
  }
  return { agenda: registros.map((r) => r.item), consultations, profiles, accounts, overrides, intakeEvents, restrictions: await restricoesDoTarologo(ex, tarotId), date: data, now: agora, cadastro };
}

module.exports = { carregarEntrada, consultasDoPainel };
