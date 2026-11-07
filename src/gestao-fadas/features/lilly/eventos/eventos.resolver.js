'use strict';

/**
 * `POST /lilly/events/resolve` (Maturacao/59, 2.2 e 4). Valida a forma, resolve pelo provider ('umbler' ou 'fadas'), CONFERE e só então
 * devolve `{ verified:true, event }`, gravando o evento resolvido em `gf_lilly_eventos` (a prova). Reentrega do mesmo evento devolve o
 * MESMO evento guardado (o primeiro vence). Devolve `{ status, corpo }`.
 */

const { EventoRecusadoError } = require('./eventos.erros');
const { resolverUmbler } = require('./eventos.umbler');
const { resolverSite } = require('./eventos.site');
const { gravarEvento, buscarEvento } = require('../dados/eventos.repo');
const { avulso, emTransacao } = require('../dados/executor');

const objeto = (v) => v && typeof v === 'object' && !Array.isArray(v);
const falha = (e) => ({ status: e.status, corpo: { error: { code: e.code, message: e.message } } });

/**
 * @param {{ provider: string, event: object }} corpo
 * @param {{ leitor?: object, verificarSite?: Function, executor?: object, agora?: Date }} [deps]
 */
async function resolverEvento({ provider, event }, deps = {}) {
  if (!['umbler', 'fadas'].includes(provider) || !objeto(event)) return falha(new EventoRecusadoError('INVALID_INPUT', 'Informe o provedor e o evento.', 400));
  const leitura = deps.executor || avulso;
  try {
    const normalizado = provider === 'umbler'
      ? await resolverUmbler(event, { leitor: deps.leitor, executor: leitura })
      : await resolverSite(event, { executor: leitura, verificarSite: deps.verificarSite, agora: deps.agora });
    const guardado = await (deps.executor ? gravarEvento(deps.executor, normalizado) : emTransacao((ex) => gravarEvento(ex, normalizado)));
    return { status: 200, corpo: { verified: true, event: guardado.evento } };
  } catch (e) {
    if (e instanceof EventoRecusadoError) return falha(e);
    throw e;
  }
}

module.exports = { resolverEvento, buscarEvento };
