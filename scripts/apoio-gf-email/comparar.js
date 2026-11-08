'use strict';

/** Apoio do verificador de e-mails: repete na API as entradas do ouro e devolve o que ela respondeu, no mesmo formato. */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const C = require('./cenarios');

const RAIZ = path.join(__dirname, '..', '..');
const FEATURE = 'src/gestao-fadas/features/email';
const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'ouro.json'), 'utf8'));

/** Um arquivo com uma troca de texto (mutante), sem tocar o disco. `de` nulo = cópia fresca; `de` pode ser uma lista de pares [de, para]. */
function carregarMutante(rel, de, para) {
  const arquivo = path.join(RAIZ, rel); let fonte = fs.readFileSync(arquivo, 'utf8');
  const trocas = de === null ? [] : Array.isArray(de) ? de : [[de, para]];
  for (const [a, b] of trocas) { if (!fonte.includes(a)) throw new Error(`mutante sem alvo em ${rel}: ${a}`); fonte = fonte.replace(a, b); }
  const m = new Module(arquivo, module); m.filename = arquivo; m.paths = Module._nodeModulePaths(path.dirname(arquivo)); m._compile(fonte, arquivo);
  return m.exports;
}
const modulo = (rel) => require(path.join(RAIZ, rel));

/** Tenta uma função e devolve `{ok}` ou `{erro}` como o gerador. */
const tentar = (fn) => { try { const v = fn(); return { ok: JSON.parse(JSON.stringify(v === undefined ? null : v)) }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };

/** Repete a sequência de pedidos no serviço da API. `servico`/`modelo` podem ser mutantes. */
async function rodarPedidos({ servico, EmailErro, envioLigado = true, pedidos = C.PEDIDOS }) {
  const repo = C.repoFalso(); const enviados = []; const convites = C.convitesFalsos(EmailErro);
  const atores = { admin: { id: 'admin', role: 'administradora' }, staff: { id: 'staff', role: 'atendente' } };
  const deps = { repo, enviar: C.envioFalso(enviados), convites, env: { armazenamento: true, chave: C.MESTRA, chaveOk: true, envioLigado, origem: C.ORIGEM }, agora: () => C.AGORA, uuid: () => require('crypto').randomUUID() };
  const saida = [];
  for (const p of pedidos) {
    const antes = enviados.length;
    const r = await servico.tratar(deps, { recurso: p.resource, metodo: p.method, corpo: p.body, ator: p.actor ? atores[p.actor] : null });
    saida.push({ ...p, saida: C.normalizar(JSON.parse(JSON.stringify({ status: r.status, corpo: r.corpo, enviado: enviados.slice(antes) }))) });
  }
  return { saida, repo, enviados };
}

module.exports = { RAIZ, FEATURE, ouro, carregarMutante, modulo, tentar, rodarPedidos };
