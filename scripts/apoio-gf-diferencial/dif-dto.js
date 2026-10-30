'use strict';

/**
 * Item 2: os DTOs de resposta. O serviço REAL da A (`repasse.service.js`, com as consultas e a montagem em `repasse.dto.js`)
 * lê de models falsos que servem as mesmas linhas de banco usadas no gerador do ouro; a saída tem de ser IGUAL, campo a
 * campo e na mesma ordem de chaves, à que a B montou (`agreementOf` e `openingView`). Linha fora do formato: os dois lados
 * têm de recusar (a B lança, a A responde 500 não operacional), nunca devolver valor presumido.
 */

const path = require('node:path');
const { Op } = require('sequelize');

const raiz = path.join(__dirname, '..', '..', 'src', 'gestao-fadas');
const caminhoLegado = require.resolve(path.join(raiz, 'novo', 'leitura')); // `lendoNovo` é o leitor do serviço
const caminhoServico = require.resolve(path.join(raiz, 'features', 'repasse', 'repasse.service'));

const NUMERICAS = new Set(['registrado_em', 'sequencia', 'revisao']);
let atual = null; // { linhas, contas } do cenário em curso

function filtrar(linhas, where = {}) {
  return linhas.filter((l) => Object.entries(where).every(([campo, cond]) => (cond && typeof cond === 'object' && Op.in in cond ? cond[Op.in].includes(l[campo]) : l[campo] === cond)));
}
function ordenar(linhas, order = []) {
  return [...linhas].sort((a, b) => {
    for (const [campo, sentido] of order) {
      const [x, y] = NUMERICAS.has(campo) ? [Number(a[campo]), Number(b[campo])] : [a[campo], b[campo]];
      if (x !== y) return (x < y ? -1 : 1) * (sentido === 'DESC' ? -1 : 1);
    }
    return 0;
  });
}
const modelo = (tabela) => ({
  findAll: async ({ where, order, limit }) => {
    const linhas = ordenar(filtrar(atual.linhas[tabela], where), order);
    return structuredClone(limit ? linhas.slice(0, limit) : linhas);
  },
});
const modelosFalsos = () => ({
  GfRepassePercentuais: modelo('percentuais'), GfRepasseCalendarios: modelo('calendarios'), GfRepasseAberturas: modelo('aberturas'),
  GfRepasseAberturaPendencias: modelo('pendencias'), GfRepasseDividas: modelo('dividas'), GfRepasseAjustes: modelo('ajustes'), GfRepasseDividaParcelas: modelo('parcelas'),
  GfAuthAccounts: { findAll: async ({ where }) => where.id[Op.in].filter((id) => atual.contas[id]).map((id) => ({ id, display_name: atual.contas[id] })) },
});

/** O serviço da A com `lendoNovo` trocado por um que usa os models falsos (só neste processo, só para esta verificação). */
function servicoComModelosFalsos() {
  const original = require(caminhoLegado);
  require.cache[caminhoLegado].exports = { ...original, lendoNovo: async (fn) => fn(modelosFalsos()) };
  delete require.cache[caminhoServico];
  const servico = require(caminhoServico);
  require.cache[caminhoLegado].exports = original;
  return servico;
}

async function verificarDto(ouro) {
  const servico = servicoComModelosFalsos();
  const r = { total: 0, iguais: 0, divergencias: [] };
  for (const [i, c] of ouro.entries()) {
    atual = c;
    const rotulo = `cenário ${i} (tarólogo ${c.tarotId}${c.defeito !== null ? `, defeito ${c.defeito}` : ''})`;
    let obtido;
    try {
      obtido = { acordo: await servico.acordo(c.tarotId), aberturas: await servico.aberturas(c.tarotId) };
    } catch (e) {
      obtido = { erro: true };
    }
    r.total += 1;
    const esperado = JSON.stringify(c.esperado);
    const recebido = JSON.stringify(obtido);
    if (esperado === recebido) { r.iguais += 1; continue; }
    // acha o primeiro ponto que difere, para o relatório
    let k = 0;
    while (k < esperado.length && esperado[k] === recebido[k]) k += 1;
    r.divergencias.push(`${rotulo}\n      B: ...${esperado.slice(Math.max(0, k - 60), k + 100)}\n      A: ...${recebido.slice(Math.max(0, k - 60), k + 100)}`);
  }
  return r;
}

module.exports = { verificarDto };
