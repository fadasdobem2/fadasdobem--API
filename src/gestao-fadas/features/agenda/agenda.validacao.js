'use strict';

/**
 * Validação das entradas da Agenda (forma do corpo e da consulta). As REGRAS de negócio (422, com a mensagem do front) ficam em
 * `_comum/dominio/agenda-regras.js`. Nada do que o cliente manda escolhe perfil, conta, versão nova, número público nem autor.
 */

const AppError = require('../../../utils/AppError');
const { ehDataCivil } = require('../../_comum/dominio/agenda-contato');
const { conferirCampo } = require('../../_comum/dominio/agenda-delta');
const { ErroDeRegra } = require('../../_comum/dominio/agenda-regras');

const invalido = (campo) => new AppError('Dados inválidos.', 400, { codigo: 'INVALID_INPUT', campo }, true);
const ehObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID_TAROLOGO = /^[A-Za-z0-9._:@-]{1,64}$/;

const chaveOperacao = (v) => { if (typeof v !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(v)) throw invalido('operationKey'); return v; };
const idItem = (v) => { if (typeof v !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(v)) throw invalido('id'); return v; };
const idTarologo = (v) => { if (typeof v !== 'string' || !ID_TAROLOGO.test(v)) throw invalido('tarotId'); return v; };
const textoCurto = (v, campo, max = 160) => { if (v !== undefined && (typeof v !== 'string' || !v || v.length > max)) throw invalido(campo); return v; };

/** Regra do front que lança na validação de campo vira 422; erro de forma vira 400. */
function campo(nome, valor) {
  try { return conferirCampo(nome, valor); } catch (e) { if (e instanceof ErroDeRegra) throw new AppError(e.message, 422, { codigo: 'RULE_VIOLATION' }, true); throw e; }
}

/** Parte comum de um comando de item e da criação: `set`, `unset`, `append`, `restoreDepartures`. */
function delta(c) {
  const set = c.set === undefined ? {} : c.set;
  const unset = c.unset === undefined ? [] : c.unset;
  const append = c.append === undefined ? {} : c.append;
  const restaura = c.restoreDepartures === undefined ? [] : c.restoreDepartures;
  if (!ehObjeto(set) || !Array.isArray(unset) || unset.length > 40 || !ehObjeto(append) || !Array.isArray(restaura) || restaura.length > 40) throw invalido('delta');
  for (const lista of Object.values(append)) if (!Array.isArray(lista) || lista.length > 50) throw invalido('append');
  if (!restaura.every((x) => typeof x === 'string' && x.length <= 160)) throw invalido('restoreDepartures');
  if (c.expectedContact !== undefined && !ehObjeto(c.expectedContact)) throw invalido('expectedContact');
  return { set, unset, append, restoreDepartures: restaura, expectedContact: c.expectedContact, expectedLatestId: textoCurto(c.expectedLatestId, 'expectedLatestId', 160) };
}

/** Corpo de um comando sobre um agendamento: `{ operationKey, expectedVersion, set?, unset?, append?, ... }`. */
function corpoComando(corpo) {
  if (!ehObjeto(corpo)) throw invalido('corpo');
  const v = corpo.expectedVersion;
  if (!Number.isInteger(v) || v < 1) throw invalido('expectedVersion');
  return { operationKey: chaveOperacao(corpo.operationKey), expectedVersion: v, ...delta(corpo) };
}

/** Corpo de `POST /agenda`: `{ operationKey, id, tarotId, clientId | leadId, client, date, set?, append? }`. */
function corpoCriacao(corpo) {
  if (!ehObjeto(corpo)) throw invalido('corpo');
  // v706: o agendamento tem cliente OU contato (`leadId`); com contato, `clientId` vai vazio e o nome (`client`) é do contato, vindo do servidor.
  const leadId = corpo.leadId === undefined ? undefined : idItem(corpo.leadId);
  if (leadId && corpo.clientId) throw invalido('clientId');
  const base = {
    id: idItem(corpo.id), tarotId: campo('tarotId', idTarologo(corpo.tarotId)), clientId: leadId ? '' : campo('clientId', corpo.clientId), ...(leadId ? { leadId } : {}),
    client: leadId && !corpo.client ? 'Contato' : campo('client', corpo.client), date: ehDataCivil(corpo.date) ? corpo.date : (() => { throw invalido('date'); })(),
  };
  return { operationKey: chaveOperacao(corpo.operationKey), ...base, ...delta(corpo) };
}

/** Corpo de `POST /agenda/queues/:tarotId/order`. `ranks` leva as sobreposições de posição novas por item (só o que mudou). */
function corpoOrdem(corpo) {
  if (!ehObjeto(corpo)) throw invalido('corpo');
  const ids = (v, nome) => { if (!Array.isArray(v) || v.length > 500 || !v.every((x) => typeof x === 'string' && x.length <= 64)) throw invalido(nome); return v; };
  const ranks = ehObjeto(corpo.ranks) ? corpo.ranks : (() => { throw invalido('ranks'); })();
  for (const [id, mapa] of Object.entries(ranks)) {
    if (id.length > 64 || !ehObjeto(mapa) || Object.keys(mapa).length > 12) throw invalido('ranks');
    for (const [k, n] of Object.entries(mapa)) if (!/^[A-Za-z0-9:_.-]{1,80}$/.test(k) || !Number.isInteger(n) || n < 1 || n > 100000) throw invalido('ranks');
  }
  const lineage = corpo.lineage === undefined ? undefined : corpo.lineage;
  if (lineage !== undefined && (!Array.isArray(lineage) || lineage.length > 20 || !lineage.every((x) => ehObjeto(x) && typeof x.id === 'string' && typeof x.baseRevision === 'string'))) throw invalido('lineage');
  return {
    operationKey: chaveOperacao(corpo.operationKey), commandId: textoCurto(corpo.commandId, 'commandId', 160) || (() => { throw invalido('commandId'); })(),
    baseRevision: textoCurto(corpo.baseRevision, 'baseRevision', 80) || (() => { throw invalido('baseRevision'); })(),
    movedId: textoCurto(corpo.movedId, 'movedId', 64), beforeIds: ids(corpo.beforeIds, 'beforeIds'), afterIds: ids(corpo.afterIds, 'afterIds'),
    ...(lineage ? { lineage: lineage.map((x) => ({ id: x.id, baseRevision: x.baseRevision })) } : {}), ranks,
  };
}

/** Consulta de `GET /agenda`: `from`, `to`, `tarotId`, `includeClosed` (padrão: sim, janela de 7 dias para trás). */
function consulta(q = {}) {
  const dia = (v, nome) => { if (v === undefined) return undefined; if (!ehDataCivil(v)) throw invalido(nome); return v; };
  const de = dia(q.from, 'from'); const ate = dia(q.to, 'to');
  if (de && ate && ate < de) throw invalido('to');
  if (de && ate && (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000 > 62) throw invalido('to');
  if (q.includeClosed !== undefined && !['true', 'false'].includes(q.includeClosed)) throw invalido('includeClosed');
  return { de, ate, tarotId: q.tarotId === undefined ? undefined : idTarologo(q.tarotId), incluirEncerrados: q.includeClosed !== 'false' };
}

module.exports = { chaveOperacao, idItem, idTarologo, corpoComando, corpoCriacao, corpoOrdem, consulta, delta };
