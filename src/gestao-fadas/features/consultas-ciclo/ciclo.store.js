'use strict';

/**
 * Acesso ao banco novo da fatia Consulta. Escrita: SQL no executor (`novo/escritor.js`: só INSERT/UPDATE/SELECT em gf_*, sem DELETE).
 * Leitura da tela: models (`novo/leitura.js`), que funciona com a escrita desligada. O `item` jsonb volta do executor como TEXTO
 * e do model como OBJETO; `paraItem` aceita os dois. O item é a `OperationalConsultation` do front menos o `id` (que vive na coluna).
 */

const { randomUUID } = require('crypto');

const COLUNAS = 'id, id_consulta_legado, legado_estado, id_tarologo, id_cliente, status, item, version';
const paraItem = (l) => ({ ...(typeof l.item === 'string' ? JSON.parse(l.item) : l.item), id: l.id });
const linhaParaRegistro = (l) => ({ item: paraItem(l), version: Number(l.version), legadoId: l.id_consulta_legado || null, legadoEstado: l.legado_estado });

/** Uma consulta dentro da transação, travada (`FOR UPDATE`). */
async function travar(ex, id) {
  const [linhas] = await ex.execute(`SELECT ${COLUNAS} FROM gf_consultas_ext WHERE id = ? FOR UPDATE`, [id]);
  return linhas[0] ? linhaParaRegistro(linhas[0]) : null;
}

/** Serializa os lançamentos e inícios de um tarólogo e de uma cliente (a ocupação é conferida sob estes travas, em ordem estável). */
async function travarOcupacao(ex, tarotId, clienteId) {
  for (const chave of [`gf_consultas:tarologo:${tarotId}`, `gf_consultas:cliente:${clienteId}`].sort()) await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [chave]);
}

/** As consultas abertas do tarólogo OU da cliente (ocupação). */
async function abertasDe(ex, tarotId, clienteId) {
  const [linhas] = await ex.execute(`SELECT ${COLUNAS} FROM gf_consultas_ext WHERE status = 'Em curso' AND (id_tarologo = ? OR id_cliente = ?) ORDER BY id`, [tarotId, clienteId]);
  return linhas.map(linhaParaRegistro);
}

/** Percentual de comissão vigente do tarólogo (Repasse), se existir; o contrato é capturar UMA vez no lançamento. */
async function percentualVigente(ex, tarotId) {
  const [linhas] = await ex.execute('SELECT percentual FROM gf_repasse_percentuais WHERE tarot_id = ? ORDER BY vigente_desde DESC LIMIT 1', [tarotId]);
  return linhas[0] ? Number(linhas[0].percentual) : undefined;
}

function colunasDoItem(i) {
  const { id: _id, ...resto } = i;
  const origem = (i.continuation && i.continuation.sourceConsultationId) || null;
  return [
    i.tarotId, i.clientId, i.agendaItemId || null, origem, i.status, i.paymentProfile || null, i.channel || null, i.commissionRate, i.awaitingTarologistStart !== false,
    i.startedAt, i.endedAt || null, i.tarologistStartedAt || null, Math.max(0, Math.round(i.durationSeconds || 0)), JSON.stringify(resto),
  ];
}

async function inserir(ex, item, criadoPor, operationKey) {
  await ex.execute(
    'INSERT INTO gf_consultas_ext (id, id_tarologo, id_cliente, id_agenda, consulta_origem_id, status, perfil_pagamento, canal, comissao_percentual, aguardando_inicio, iniciada_em, encerrada_em, tarologo_iniciou_em, duracao_segundos, item, version, criado_por, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
    [item.id, ...colunasDoItem(item), criadoPor, operationKey],
  );
}

/** Grava o item novo e sobe a versão (a conferência de versão é do service, com a linha travada). */
async function atualizar(ex, item, versaoNova) {
  await ex.execute(
    'UPDATE gf_consultas_ext SET id_tarologo = ?, id_cliente = ?, id_agenda = ?, consulta_origem_id = ?, status = ?, perfil_pagamento = ?, canal = ?, comissao_percentual = ?, aguardando_inicio = ?, iniciada_em = ?, encerrada_em = ?, tarologo_iniciou_em = ?, duracao_segundos = ?, item = ?, version = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?',
    [...colunasDoItem(item), versaoNova, item.id],
  );
}

async function inserirEvento(ex, { idConsulta, tipo, ref, a, dados, versao, operationKey }) {
  await ex.execute(
    'INSERT INTO gf_consultas_eventos (id, id_consulta, tipo, evento_ref, ator_id, ator_nome, ator_perfil, dados, versao, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), idConsulta, tipo, ref ?? null, a.id, a.nome, a.perfil, JSON.stringify(dados ?? {}), versao, operationKey],
  );
}

/** Estado do espelho no legado (vínculo e situação), sem mexer na versão da consulta. */
async function marcarLegado(ex, id, { legadoId, estado, detalhe }) {
  await ex.execute(
    'UPDATE gf_consultas_ext SET id_consulta_legado = COALESCE(?, id_consulta_legado), legado_estado = ?, legado_detalhe = ?, legado_atualizado_em = CURRENT_TIMESTAMP WHERE id = ?',
    [legadoId ?? null, estado, detalhe ? String(detalhe).slice(0, 300) : null, id],
  );
}

/** Leitura da tela (models do banco novo): abertas de qualquer data, mais as do dia (e as encerradas desde `desde`). */
async function lerRegistros(modelos, { desde, tarotId, clientId, incluirEncerradas }) {
  const { Op } = require('sequelize');
  const ouAberta = [{ status: 'Em curso' }, { status: 'Finalizada pelo tarólogo' }];
  const onde = {
    [Op.or]: incluirEncerradas === false ? ouAberta : [...ouAberta, { iniciada_em: { [Op.gte]: desde } }, { atualizado_em: { [Op.gte]: desde } }],
    ...(tarotId ? { id_tarologo: tarotId } : {}), ...(clientId ? { id_cliente: clientId } : {}),
  };
  const linhas = await modelos.GfConsultasExt.findAll({ where: onde, order: [['iniciada_em', 'ASC'], ['id', 'ASC']] });
  return linhas.map(linhaParaRegistro);
}

/** Tudo de um tarólogo para a Presença: `{ emAndamento, terminos }` (gancho `consultasDe`, Maturacao/29 seção 6.4). */
async function resumoParaPresenca(ex, tarotId) {
  const [linhas] = await ex.execute(`SELECT ${COLUNAS} FROM gf_consultas_ext WHERE id_tarologo = ? AND (status = 'Em curso' OR encerrada_em > CURRENT_TIMESTAMP - INTERVAL '1 day')`, [tarotId]);
  const regs = linhas.map(linhaParaRegistro);
  return regs.map((r) => r.item);
}

module.exports = { travar, travarOcupacao, abertasDe, percentualVigente, inserir, atualizar, inserirEvento, marcarLegado, lerRegistros, resumoParaPresenca, paraItem, linhaParaRegistro };
