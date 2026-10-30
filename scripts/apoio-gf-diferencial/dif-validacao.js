'use strict';

/**
 * Item 1 do teste diferencial: a bateria de entradas do ouro (gerado pela B) contra a validação e a montagem da entrada
 * do store da A (`criarServicoEscrita`) e contra `ampliarHistorico`. Aceito/recusado, status, código e texto do erro e a
 * entrada entregue ao store têm de ser iguais. `b503` marca o achado da B (503 em vez de 400): a A recusa com 400.
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const { criarExecutorDeAuditoria } = require('./auditoria-falsa');

const raiz = path.join(__dirname, '..', '..', 'src', 'gestao-fadas');
const { criarServicoEscrita } = require(path.join(raiz, 'features', 'repasse', 'escrita', 'escrita.service'));
const { ampliarHistorico } = require(path.join(raiz, 'features', 'clientes', 'helpers', 'ampliacao'));
const { idDaCliente, erro: erroCliente } = require(path.join(raiz, 'features', 'clientes', 'clientes.validacao'));
const { criarAuditoria } = require(path.join(raiz, '_comum', 'auditoria'));

const ATOR = { accountId: 'conta-1', role: 'administradora' };
const AGORA = new Date('2026-10-29T15:00:00Z'); // 12:00 em São Paulo: o mesmo VIGENCIA_FIXA do gerador
const limpo = (v) => JSON.parse(JSON.stringify(v));
const resumo = (e) => ({ status: e.statusCode, code: e.dados && e.dados.codigo, message: e.message });

const METODO = { commission: 'percentual', schedule: 'calendario', openings: 'rascunho', confirm: 'confirmar', correct: 'corrigir' };
const GRAVACAO = { commission: 'setCommissionRate', schedule: 'setPaymentSchedule', openings: 'draftOpening', confirm: 'confirmOpening', correct: 'correctOpening' };

/** Roda um caso do ouro na A. Devolve `{ aceito: true, entrada }` ou `{ aceito: false, status, code, message }`. */
async function rodarNaA(caso) {
  let capturada = null;
  const store = Object.fromEntries(Object.values(GRAVACAO).map((nome) => [nome, async (entrada) => { capturada = entrada; return { id: 'r-1' }; }]));
  const svc = criarServicoEscrita({ store, ator: () => ATOR, acordoLido: async () => ({}), comNomes: async (r) => r, agora: () => AGORA });
  try {
    await svc[METODO[caso.rota]]({ params: caso.params, body: JSON.parse(caso.corpoJson) });
  } catch (e) {
    if (!e || typeof e.statusCode !== 'number') throw e;
    return { aceito: false, ...resumo(e) };
  }
  const { actor, ...entrada } = capturada;
  assert.deepEqual(actor, ATOR);
  return { aceito: true, entrada: limpo(entrada) };
}

/** Compara a saída da A com a esperada pela B. Devolve null (igual), 'conhecida' (b503) ou o texto da divergência. */
function comparar(esperado, obtido) {
  if (esperado.b503) {
    return !obtido.aceito && obtido.status === 400 && obtido.code === 'INVALID_INPUT' ? 'conhecida' : `B quebra (503) e a A devia recusar com 400, deu ${JSON.stringify(obtido)}`;
  }
  try {
    assert.deepEqual(obtido, esperado);
    return null;
  } catch {
    return `B: ${JSON.stringify(esperado).slice(0, 260)}\n      A: ${JSON.stringify(obtido).slice(0, 260)}`;
  }
}

async function verificarGravacoes(casos) {
  const r = { total: 0, iguais: 0, aceitos: 0, conhecidas: 0, divergencias: [] };
  for (const caso of casos) {
    r.total += 1;
    let obtido;
    try {
      obtido = await rodarNaA(caso);
    } catch (e) {
      r.divergencias.push(`${caso.rota} ${JSON.stringify(caso.params)} ${caso.corpoJson.slice(0, 160)}\n      A lançou ${e && e.message}`);
      continue;
    }
    const d = comparar(caso.esperado, obtido);
    if (d === null) { r.iguais += 1; if (caso.esperado.aceito) r.aceitos += 1; } else if (d === 'conhecida') r.conhecidas += 1;
    else r.divergencias.push(`${caso.rota} ${JSON.stringify(caso.params)} ${caso.corpoJson.slice(0, 160)}\n      ${d}`);
  }
  return r;
}

// ---- history-access ----

function relogio() {
  let t = 1_790_000_000_000;
  let n = 0;
  return { agora: () => (t += 1000), novoId: () => `aud-${++n}` };
}

/** `POST /clientes/:id/history-access` da A como o controller o compõe: id da rota, depois `ampliarHistorico`. */
async function pedidoNaA(p, executor, rel) {
  const clientId = idDaCliente(p.id);
  try {
    if (clientId === null) throw erroCliente('INVALID_INPUT', true);
    const auditoria = criarAuditoria(executor, { agora: rel.agora, novoId: rel.novoId });
    const contexto = { clientId, actor: { accountId: p.conta || 'conta-1', role: p.papel }, sessionId: p.sessao };
    const r = await ampliarHistorico(contexto, JSON.parse(p.corpoJson), { clienteExiste: async () => p.existe, gravar: (fato, chave) => auditoria.adicionarUmaVez(fato, chave) });
    return { status: 201, grant: r.grant };
  } catch (e) {
    if (!e || typeof e.statusCode !== 'number') throw e;
    return resumo(e);
  }
}

async function verificarAmpliacao(ouro) {
  const r = { total: 0, iguais: 0, aceitos: 0, conhecidas: 0, divergencias: [] };
  const confere = (rotulo, esperado, obtido, extra = '') => {
    r.total += 1;
    try {
      assert.deepEqual(obtido, esperado);
      r.iguais += 1;
      if (esperado.status === 201) r.aceitos += 1;
    } catch {
      r.divergencias.push(`history ${rotulo} ${extra}\n      B: ${JSON.stringify(esperado).slice(0, 220)}\n      A: ${JSON.stringify(obtido).slice(0, 220)}`);
    }
  };
  for (const u of ouro.unicos) {
    const executor = criarExecutorDeAuditoria();
    const obtido = await pedidoNaA(u.pedido, executor, relogio());
    confere(JSON.stringify(u.pedido.id), u.esperado, obtido, u.pedido.corpoJson.slice(0, 120));
    r.total += 1;
    try { assert.deepEqual(executor.linhas, u.linhas); r.iguais += 1; } catch { r.divergencias.push(`history linha de auditoria diferente: ${u.pedido.corpoJson.slice(0, 100)}`); }
  }
  for (const s of ouro.sequencias) {
    const executor = criarExecutorDeAuditoria();
    const rel = relogio();
    for (const [i, passo] of s.passos.entries()) confere(`${s.nome} passo ${i}`, s.esperado[i], await pedidoNaA(passo, executor, rel));
    r.total += 1;
    try { assert.deepEqual(executor.linhas, s.linhas); r.iguais += 1; } catch { r.divergencias.push(`history sequência "${s.nome}": linhas de auditoria diferentes`); }
  }
  return r;
}

module.exports = { verificarGravacoes, verificarAmpliacao, rodarNaA };
