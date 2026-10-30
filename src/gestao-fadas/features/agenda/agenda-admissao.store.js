'use strict';

/**
 * Acesso ao banco novo da admissão do turno (`gf_agenda_admissoes`, só acrescenta) e das solicitações "cliente quer consulta"
 * (`gf_agenda_solicitacoes`). Escrita: SQL no executor; leitura da tela: models (funciona com a escrita desligada).
 */

const paraItem = (l) => ({ ...(typeof l.item === 'string' ? JSON.parse(l.item) : l.item), id: l.id });
const registroDe = (l) => ({ item: paraItem(l), version: Number(l.version ?? 1) });

/** Eventos de admissão de um dia (ou todos os desde `desde`), em ordem de gravação: o vigente é o último do tarólogo. */
async function eventosDoDia(ex, tarotId, data) {
  const [linhas] = await ex.execute('SELECT id, item FROM gf_agenda_admissoes WHERE id_tarologo = ? AND data_operacional = ? ORDER BY ocorrido_em, id', [tarotId, data]);
  return linhas.map(paraItem);
}
async function inserirEvento(ex, evento, ator, operationKey) {
  const { id, ...resto } = evento;
  await ex.execute('INSERT INTO gf_agenda_admissoes (id, id_tarologo, data_operacional, modo, ocorrido_em, item, criado_por, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, evento.tarotId, evento.date, evento.mode, evento.at, JSON.stringify(resto), ator, operationKey]);
}
async function eventoExiste(ex, id) {
  const [linhas] = await ex.execute('SELECT id FROM gf_agenda_admissoes WHERE id = ?', [id]);
  return Boolean(linhas[0]);
}

async function lerEventos(modelos, { desde }) {
  const { Op } = require('sequelize');
  const linhas = await modelos.GfAgendaAdmissoes.findAll({ where: desde ? { data_operacional: { [Op.gte]: desde } } : {}, order: [['ocorrido_em', 'ASC'], ['id', 'ASC']] });
  return linhas.map((l) => paraItem(l));
}

async function solicitacaoTravada(ex, id) {
  const [linhas] = await ex.execute('SELECT id, item, version FROM gf_agenda_solicitacoes WHERE id = ? FOR UPDATE', [id]);
  return linhas[0] ? registroDe(linhas[0]) : null;
}
async function solicitacaoAberta(ex, tarotId, clientId) {
  const [linhas] = await ex.execute('SELECT id, item, version FROM gf_agenda_solicitacoes WHERE id_tarologo = ? AND id_cliente = ?', [tarotId, clientId]);
  return linhas.map(registroDe);
}
async function inserirSolicitacao(ex, s, ator, operationKey) {
  const { id, ...resto } = s;
  await ex.execute('INSERT INTO gf_agenda_solicitacoes (id, id_tarologo, id_cliente, data_operacional, item, version, criado_por, operation_key) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
    [id, s.tarotId, s.clientId, s.date, JSON.stringify(resto), ator, operationKey]);
}
async function atualizarSolicitacao(ex, s, versao) {
  const { id, ...resto } = s;
  await ex.execute('UPDATE gf_agenda_solicitacoes SET item = ?, version = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(resto), versao, id]);
}
async function lerSolicitacoes(modelos, { desde, tarotId }) {
  const { Op } = require('sequelize');
  const onde = { ...(desde ? { data_operacional: { [Op.gte]: desde } } : {}), ...(tarotId ? { id_tarologo: tarotId } : {}) };
  const linhas = await modelos.GfAgendaSolicitacoes.findAll({ where: onde, order: [['criado_em', 'ASC'], ['id', 'ASC']] });
  return linhas.map(registroDe);
}

module.exports = { eventosDoDia, inserirEvento, eventoExiste, lerEventos, solicitacaoTravada, solicitacaoAberta, inserirSolicitacao, atualizarSolicitacao, lerSolicitacoes, paraItem };
