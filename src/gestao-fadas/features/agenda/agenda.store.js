'use strict';

/**
 * Acesso ao banco novo da fatia Agenda. Escrita: SQL no executor (`novo/escritor.js`: só INSERT/UPDATE/SELECT em gf_*, sem DELETE).
 * Leitura da tela: models (`novo/leitura.js`), que funciona com a escrita desligada. O `item` jsonb volta do executor como TEXTO
 * e do model como OBJETO; `paraItem` aceita os dois.
 */

const { randomUUID } = require('crypto');

const COLUNAS = 'id, numero_publico, id_tarologo, id_cliente, data_operacional, posicao, agenda_outcome, item, version';
const paraItem = (l) => ({ ...(typeof l.item === 'string' ? JSON.parse(l.item) : l.item), id: l.id, publicNumber: Number(l.numero_publico) });
const linhaParaRegistro = (l) => ({ item: paraItem(l), version: Number(l.version) });

/** Um agendamento dentro da transação, travado (`FOR UPDATE`). */
async function travar(ex, id) {
  const [linhas] = await ex.execute(`SELECT ${COLUNAS} FROM gf_agenda WHERE id = ? FOR UPDATE`, [id]);
  return linhas[0] ? linhaParaRegistro(linhas[0]) : null;
}

/** Os agendamentos ABERTOS de um tarólogo (a fila), dentro da transação. */
async function filaAberta(ex, tarotId, travando = true) {
  const [linhas] = await ex.execute(`SELECT ${COLUNAS} FROM gf_agenda WHERE id_tarologo = ? AND agenda_outcome IS NULL ORDER BY id${travando ? ' FOR UPDATE' : ''}`, [tarotId]);
  return linhas.map(linhaParaRegistro);
}

/** Todos os agendamentos ABERTOS (reservas da fila geral cruzam filas), dentro da transação, sem travar. */
async function abertosTodos(ex) {
  const [linhas] = await ex.execute(`SELECT ${COLUNAS} FROM gf_agenda WHERE agenda_outcome IS NULL ORDER BY numero_publico`, []);
  return linhas.map(linhaParaRegistro);
}

/** Próximo número público (nunca é posição). Serializado por lock consultivo; só cresce. */
async function proximoNumero(ex) {
  await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', ['gf_agenda:numero']);
  const [linhas] = await ex.execute('SELECT COALESCE(MAX(numero_publico), 0) + 1 AS n FROM gf_agenda', []);
  return Number(linhas[0].n);
}

/** Itens abertos de todos os tarólogos de um conjunto, para a posição nova e a revisão (dentro da transação). */
async function abertosDe(ex, tarotIds) {
  const todos = [];
  for (const t of tarotIds) todos.push(...(await filaAberta(ex, t, false)).map((r) => r.item));
  return todos;
}

/** Uma gravação por fila de cada vez (posição nova, ordem e saída serializadas), mesmo sem nenhuma linha ainda. */
const travarFila = (ex, tarotId) => ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_agenda:fila:${tarotId}`]);

function colunasDoItem(item) {
  return [item.tarotId, item.clientId, item.date || item.standbyDate || null, item.position, item.agendaOutcome || null, JSON.stringify(semReservados(item))];
}
/** `id` e `publicNumber` vivem em colunas; o resto do item vai inteiro no jsonb. */
function semReservados(item) {
  const { id: _id, publicNumber: _n, ...resto } = item;
  return resto;
}

async function inserir(ex, item, numero, criadoPor, operationKey) {
  const c = colunasDoItem(item);
  await ex.execute(
    'INSERT INTO gf_agenda (id, numero_publico, id_tarologo, id_cliente, data_operacional, posicao, agenda_outcome, item, version, criado_por, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
    [item.id, numero, c[0], c[1], c[2], c[3], c[4], c[5], criadoPor, operationKey],
  );
}

/** Grava o item novo e sobe a versão em 1 (a conferência de versão é do service, com a linha travada). */
async function atualizar(ex, item, versaoNova) {
  const c = colunasDoItem(item);
  await ex.execute(
    'UPDATE gf_agenda SET id_tarologo = ?, id_cliente = ?, data_operacional = ?, posicao = ?, agenda_outcome = ?, item = ?, version = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?',
    [c[0], c[1], c[2], c[3], c[4], c[5], versaoNova, item.id],
  );
}

async function inserirEvento(ex, { idAgenda, tipo, ref, a, dados, versao, operationKey }) {
  await ex.execute(
    'INSERT INTO gf_agenda_eventos (id, id_agenda, tipo, evento_ref, ator_id, ator_nome, ator_perfil, dados, versao, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), idAgenda, tipo, ref, a.id, a.nome, a.perfil, JSON.stringify(dados), versao, operationKey],
  );
}

async function inserirComandoDeOrdem(ex, c) {
  await ex.execute(
    'INSERT INTO gf_agenda_ordem_comandos (id, fila, base_revision, revisao_resultante, status, motivo, ator_id, ator_nome, ator_papel, moved_id, before_ids, after_ids, lineage, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [c.id, c.fila, c.baseRevision, c.revisaoResultante ?? null, c.status, c.motivo ?? null, c.a.id, c.a.nome, c.a.perfil, c.movedId ?? null,
      JSON.stringify(c.beforeIds), JSON.stringify(c.afterIds), c.lineage ? JSON.stringify(c.lineage) : null, c.operationKey],
  );
}
const marcarComandoSubstituido = (ex, id) => ex.execute("UPDATE gf_agenda_ordem_comandos SET status = 'superseded' WHERE id = ? AND status = 'applied'", [id]);

/** Leitura da tela (models do banco novo): abertos de qualquer data mais os encerrados a partir de `desde`. */
async function lerItens(modelos, { desde, ate, tarotId, incluirEncerrados }) {
  const { Op } = require('sequelize');
  const filtroDia = { ...(desde ? { [Op.gte]: desde } : {}), ...(ate ? { [Op.lte]: ate } : {}) };
  const ouAberto = incluirEncerrados ? [{ agenda_outcome: null }, { data_operacional: filtroDia }] : [{ agenda_outcome: null }];
  const onde = { [Op.or]: ouAberto, ...(tarotId ? { id_tarologo: tarotId } : {}) };
  const linhas = await modelos.GfAgenda.findAll({ where: onde, order: [['numero_publico', 'ASC']] });
  return linhas.map(linhaParaRegistro);
}

module.exports = { abertosTodos, travarFila, travar, filaAberta, proximoNumero, abertosDe, inserir, atualizar, inserirEvento, inserirComandoDeOrdem, marcarComandoSubstituido, lerItens, paraItem, linhaParaRegistro };
