'use strict';

/** Fila vigente de UM tarólogo (ids em ordem, revisão `queue-v1`, itens do domínio e consultas abertas). Mesma conta no contexto e na execução. */

const fila = require('./fila');
const leituras = require('../dados/leituras.v710');

async function ordemDoTarologo(tarotId, { agora, hoje }, f = {}) {
  const linhas = await (f.filaAbertaDe || leituras.filaAbertaDe)(tarotId);
  const itens = fila.itensAbertos(linhas);
  const consultas = await (f.consultasAbertasDoTarologo || ((t) => leituras.consultasAbertas({ tarotId: t })))(tarotId);
  const ordem = fila.ordemVigente(itens, consultas, { agora, hoje });
  return { ordem, revisao: fila.revisaoDaFilaDe(itens, tarotId), itens, consultas };
}

module.exports = { ordemDoTarologo };
