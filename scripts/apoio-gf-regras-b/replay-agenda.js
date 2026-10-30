'use strict';

/** Reprodução, no servidor, dos comandos que o front real manda (Maturacao/44): aplica cada comando com `aplicarDelta` na ordem. Sem banco. */

const { aplicarDelta } = require('../../src/gestao-fadas/_comum/dominio/agenda-delta');
const { limpar } = require('../../src/gestao-fadas/_comum/dominio/agenda-contato');
const crypto = require('crypto');

const GRUPO_DA_ROTA = { '/contact': 'contato', '/observations': 'observacoes', '/requested-wait': 'prazo', '/departures': 'saidas', '/resolution': 'resolucao', '': 'agendamento' };
const ATOR = { nome: 'Clara' };

/** Forma canônica (sem undefined, chaves em ordem) e seu hash curto. */
const forma = (v) => JSON.stringify(limpar(v));
const resumo = (v) => crypto.createHash('sha1').update(forma(v)).digest('hex').slice(0, 16);

/** Aplica os comandos de tipo "item" ao `antes`. Devolve `{ item }` ou `{ erro }` (mensagem de regra). `posicao`: ignora `position` quando o servidor a recalcula. */
function reproduzir(antes, comandos, at) {
  let item = antes;
  try {
    for (const c of comandos) {
      if (c.kind !== 'item') continue;
      item = aplicarDelta(item, c.delta, GRUPO_DA_ROTA[c.route], ATOR, new Date(at)).item;
    }
    return { item };
  } catch (e) { return { erro: e.message }; }
}

module.exports = { reproduzir, resumo, forma, GRUPO_DA_ROTA, ATOR };
