'use strict';

/**
 * Acesso ao banco novo dos contatos da Agenda (`gf_agenda_contatos`, v706 da Nice) e aos agendamentos de um contato (`gf_agenda.id_contato`).
 * Escrita: SQL no executor; leitura da tela: models (funciona com a escrita desligada).
 */

const paraItem = (l) => ({ ...(typeof l.item === 'string' ? JSON.parse(l.item) : l.item), id: l.id });
const registroDe = (l) => ({ item: { ...paraItem(l), ...(l.codigo ? { displayCode: l.codigo } : {}) }, version: Number(l.version ?? 1) });

async function contatoTravado(ex, id) {
  const [linhas] = await ex.execute('SELECT id, codigo, item, version FROM gf_agenda_contatos WHERE id = ? FOR UPDATE', [id]);
  return linhas[0] ? registroDe(linhas[0]) : null;
}
/** Todos os contatos (inclui arquivados: o código continua reservado). Serializa a criação com um lock consultivo. */
async function todos(ex) {
  const [linhas] = await ex.execute('SELECT id, codigo, item, version FROM gf_agenda_contatos ORDER BY criado_em, id', []);
  return linhas.map(registroDe);
}
const travarCodigos = (ex) => ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', ['gf_agenda_contatos:codigo']);

async function inserir(ex, c, ator, operationKey) {
  const { id, displayCode, ...resto } = c;
  await ex.execute('INSERT INTO gf_agenda_contatos (id, codigo, item, version, criado_por, operation_key) VALUES (?, ?, ?, 1, ?, ?)', [id, displayCode || null, JSON.stringify(resto), ator, operationKey]);
}
async function atualizar(ex, c, versao) {
  const { id, displayCode, ...resto } = c;
  await ex.execute('UPDATE gf_agenda_contatos SET codigo = ?, item = ?, version = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?', [displayCode || null, JSON.stringify(resto), versao, id]);
}
async function ler(modelos) {
  const linhas = await modelos.GfAgendaContatos.findAll({ order: [['criado_em', 'ASC'], ['id', 'ASC']] });
  return linhas.map(registroDe);
}
/** Os agendamentos (abertos ou não) ligados ao contato, travados, para vincular ou desfazer a identificação de forma atômica. */
async function agendamentosDoContato(ex, idContato) {
  const [linhas] = await ex.execute('SELECT id, numero_publico, item, version FROM gf_agenda WHERE id_contato = ? OR item->>\'sourceLeadId\' = ? ORDER BY numero_publico FOR UPDATE', [idContato, idContato]);
  return linhas.map((l) => ({ item: { ...paraItem(l), publicNumber: Number(l.numero_publico) }, version: Number(l.version) }));
}
/** Os pedidos do contato (para arquivar o contato e desagendá-los na mesma transação). */
async function pedidosDoContato(ex, idContato) {
  const [linhas] = await ex.execute('SELECT id, item, version FROM gf_agenda_solicitacoes WHERE id_contato = ? FOR UPDATE', [idContato]);
  return linhas.map((l) => ({ item: paraItem(l), version: Number(l.version) }));
}
async function clienteJaVinculada(ex, clientId, exceto) {
  const [linhas] = await ex.execute('SELECT id, item FROM gf_agenda_contatos WHERE id <> ? AND item->>\'clientId\' = ?', [exceto, clientId]);
  return linhas.map(paraItem).some((c) => !c.archived);
}

module.exports = { contatoTravado, todos, travarCodigos, inserir, atualizar, ler, agendamentosDoContato, pedidosDoContato, clienteJaVinculada, paraItem };
