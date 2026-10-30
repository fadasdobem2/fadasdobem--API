'use strict';

/**
 * Motivos financeiros no servidor (Maturacao/43). Porte do CÓDIGO do front `features/finance/financial-reasons-model.ts`
 * (`createFinancialReasonStore`, `addFinancialReason`, `reviseFinancialReason`, `validFinancialReasonStore`, `normalizeFinancialReasonStore`):
 * o catálogo de motivos do extrato (cliente e tarólogo), em VERSÕES que só crescem. Cada lançamento congela o motivo que usou, então uma versão
 * antiga nunca é reescrita. Sem relógio (`at` entra de fora), sem banco, sem Intl (a comparação de nomes usa NFD + minúsculas, igual ao
 * `toLocaleLowerCase('pt-BR')` do front para letras do português). Ouro: `scripts/gerar-ouro-gf-estado-financeiro.js`.
 */

class MotivoInvalidoError extends Error {
  constructor(mensagem, tipo = 'regra') { super(mensagem); this.name = 'MotivoInvalidoError'; this.tipo = tipo; }
}
const recusa = (m) => { throw new MotivoInvalidoError(m); };
const conflito = (m) => { throw new MotivoInvalidoError(m, 'conflito'); };

const NATUREZAS = {
  payment: ['client', 'Pagamento', 'Pagamento informado acrescenta crédito à cliente. Divergências encontradas depois são registradas no pagamento de origem.', 'Pagamento de {data}'],
  refund: ['client', 'Devolução pelo Fadas', 'Registra a saída do dinheiro e a decisão separada sobre a cobrança.', 'Devolução pelo Fadas'],
  'client-refund': ['client', 'Estorno iniciado pela cliente', 'Identifica a iniciativa da cliente e a concordância do Fadas.', 'Estorno iniciado pela cliente'],
  'dispute-pix': ['client', 'Contestação Pix', 'Abertura, retirada, resultado e retorno pertencem à mesma contestação.', 'Contestação Pix'],
  'dispute-card': ['client', 'Contestação cartão', 'Preserva a diferença entre valor bancário, taxas e crédito da cliente.', 'Contestação cartão'],
  'scheduled-unpaid': ['client', 'Agendamento não compensado', 'Corrige crédito lançado para um pagamento que não se efetivou.', 'Pagamento de {data} não compensado'],
  'payment-missing': ['client', 'Pagamento não localizado', 'Registra a entrada não encontrada e sua apuração, sem inventar devolução bancária.', 'Pagamento de {data} não compensado'],
  'money-return': ['client', 'Retorno do dinheiro', 'Vincula o retorno à retirada anterior e evita crédito duplicado.', 'Retorno do dinheiro'],
  charge: ['client', 'Cobrança de consulta', 'Identifica a cobrança reconhecida pelo atendimento realizado.', 'Consulta realizada'],
  'charge-waiver': ['client', 'Dispensa de cobrança', 'Reduz o valor devido por decisão registrada; não representa pagamento.', 'Dispensa de cobrança'],
  payout: ['tarologist', 'Pagamento ao tarólogo', 'Pagamento realizado à profissional, conforme o fechamento.', 'Pagamento ao tarólogo'],
  advance: ['tarologist', 'Adiantamento', 'Valor adiantado, com descontos conforme o plano registrado.', 'Adiantamento'],
  loan: ['tarologist', 'Empréstimo', 'Empréstimo e parcelas seguem o plano aprovado para a profissional.', 'Empréstimo'],
  'payout-bonus': ['tarologist', 'Bônus', 'Valor integral de bônus, sem aplicação da comissão da consulta.', 'Bônus'],
  'payout-addition': ['tarologist', 'Adicional', 'Serviço ou combinado por valor fixo ou por unidade, único ou recorrente.', 'Adicional'],
  'payout-credit': ['tarologist', 'Ajuste a favor', 'Ajuste positivo identificado, sem alterar consultas já registradas.', 'Ajuste a favor'],
  'payout-debit': ['tarologist', 'Desconto / ajuste a descontar', 'Desconto explícito com motivo, sem criar desconto automático por estorno de cliente.', 'Desconto / ajuste a descontar'],
};
const ENTRADAS = ['payment', 'money-return', 'charge-waiver', 'payout-bonus', 'payout-addition', 'payout-credit'];
const SEMENTE_EM = '2026-10-21T00:00:00-03:00';
const PAPEIS_QUE_GERENCIAM = ['administradora', 'assistente', 'supervisora'];

const natureza = (n) => (Object.prototype.hasOwnProperty.call(NATUREZAS, n) ? NATUREZAS[n] : undefined);
const podeGerenciar = (papel) => PAPEIS_QUE_GERENCIAM.includes(papel);
const direcao = (n) => (ENTRADAS.includes(n) ? 'in' : 'out');
const textoPadrao = (n) => NATUREZAS[n][3];
const normalizar = (nome) => nome.trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const instanteValido = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));

/** `createFinancialReasonStore`: as versões 1 de cada tipo de movimento. */
function sementes() {
  return Object.entries(NATUREZAS).map(([n, [escopo, nome, descricao, texto]]) => ({ id: `financial-reason-${n}`, version: 1, scope: escopo, nature: n, name: nome, description: descricao, statementText: texto, active: true, createdAt: SEMENTE_EM, createdBy: 'Configuração inicial' }));
}

/** `statementTextError`. */
function erroDoTexto(v) {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > 180) return 'Informe o texto do extrato com até 180 caracteres.';
  if (/[{}]/.test(v.split('{data}').join(''))) return 'Use apenas a data do pagamento como campo variável no texto do extrato.';
  return null;
}
function textoValido(v) { const e = erroDoTexto(v); if (e) recusa(e); return v.trim(); }

/** Última versão de cada id (`currentFinancialReasons` sem ordenar). */
function atuais(loja, escopo, natureza2) {
  const ultimo = new Map();
  for (const r of loja.reasons) if ((ultimo.get(r.id) ? ultimo.get(r.id).version : 0) < r.version) ultimo.set(r.id, r);
  return [...ultimo.values()].filter((r) => (!escopo || r.scope === escopo) && (!natureza2 || r.nature === natureza2));
}

function validarNatureza(escopo, n) { if (!natureza(n) || natureza(n)[0] !== escopo) recusa('Escolha um tipo de movimento válido para esta conta.'); }
function validarNome(nome) {
  const v = nome.trim().replace(/\s+/g, ' ');
  if (!v || v.length > 60) recusa('Informe um nome curto, com até 60 caracteres.');
  if (normalizar(v) === 'outros') recusa('Outros já está disponível para descrever um caso avulso.');
  return v;
}
function validarAutor(ator, at, papel) {
  if (!podeGerenciar(papel)) recusa('O cadastro de motivos está disponível para supervisora, assistente e administradora.');
  if (!ator.trim() || !instanteValido(at)) recusa('Não foi possível identificar o responsável e a data.');
}

/** `addFinancialReason`. `input`: `{ id, scope, nature, name, description?, statementText? }`. Devolve `{ loja, motivo }`. */
function adicionar(loja, input, ator, at, papel) {
  validarAutor(ator, at, papel); validarNatureza(input.scope, input.nature);
  const nome = validarNome(input.name); const descricao = (input.description || '').trim();
  if (!input.id || input.id === 'other' || loja.reasons.some((r) => r.id === input.id)) conflito('Este motivo já foi salvo. Atualize a lista.');
  if (descricao.length > 300) recusa('Use até 300 caracteres na explicação do motivo.');
  if (atuais(loja, input.scope, input.nature).some((r) => normalizar(r.name) === normalizar(nome))) recusa('Este motivo já existe neste tipo de movimento. Confira também os inativos.');
  const texto = textoValido(input.statementText ?? textoPadrao(input.nature));
  const motivo = { id: input.id, version: 1, scope: input.scope, nature: input.nature, name: nome, description: descricao, statementText: texto, active: true, createdAt: at, createdBy: ator.trim() };
  return { loja: { ...loja, reasons: [...loja.reasons, motivo] }, motivo };
}

/** `reviseFinancialReason`. Devolve a loja (a mesma, se nada mudou). */
function revisar(loja, id, versaoEsperada, input, ator, at, papel) {
  validarAutor(ator, at, papel);
  const atual = atuais(loja).find((r) => r.id === id);
  if (!atual || atual.version !== versaoEsperada) conflito('Este motivo foi atualizado. Abra a edição novamente.');
  const nome = input.name === undefined ? atual.name : validarNome(input.name);
  const descricao = input.description === undefined ? atual.description : input.description.trim();
  const ativo = input.active ?? atual.active;
  if (descricao.length > 300) recusa('Use até 300 caracteres na explicação do motivo.');
  if (atuais(loja, atual.scope, atual.nature).some((r) => r.id !== id && normalizar(r.name) === normalizar(nome))) recusa('Este motivo já existe neste tipo de movimento. Confira também os inativos.');
  const texto = input.statementText === undefined ? atual.statementText : textoValido(input.statementText);
  if (nome === atual.name && descricao === atual.description && ativo === atual.active && texto === atual.statementText) return loja;
  return { ...loja, reasons: [...loja.reasons, { ...atual, version: atual.version + 1, name: nome, description: descricao, active: ativo, ...(texto === undefined ? {} : { statementText: texto }), createdAt: at, createdBy: ator.trim() }] };
}

/** `validFinancialReasonStore`. */
function lojaValida(valor) {
  if (!valor || typeof valor !== 'object' || valor.version !== 1 || !Array.isArray(valor.reasons)) return false;
  const vistos = new Map();
  for (const r of valor.reasons) {
    if (!r || typeof r.id !== 'string' || !r.id || r.id === 'other' || !natureza(r.nature) || natureza(r.nature)[0] !== r.scope || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 60
      || normalizar(r.name) === 'outros' || typeof r.description !== 'string' || r.description.length > 300 || typeof r.active !== 'boolean' || typeof r.createdBy !== 'string' || !r.createdBy.trim()
      || !instanteValido(r.createdAt) || !Number.isSafeInteger(r.version) || r.version < 1) return false;
    if (r.statementText !== undefined && erroDoTexto(r.statementText)) return false;
    const antes = vistos.get(r.id);
    if (r.version !== (antes ? antes.version : 0) + 1 || (antes && (r.nature !== antes.nature || r.scope !== antes.scope))) return false;
    vistos.set(r.id, r);
  }
  const nomes = new Set();
  for (const r of vistos.values()) { const k = `${r.scope}:${r.nature}:${normalizar(r.name)}`; if (nomes.has(k)) return false; nomes.add(k); }
  return true;
}

/** `normalizeFinancialReasonStore`: loja do servidor = as sementes que ainda não têm linha mais as versões gravadas. */
function normalizarLoja(valor) {
  if (!lojaValida(valor)) return { version: 1, reasons: sementes() };
  const faltam = sementes().filter((s) => !valor.reasons.some((r) => r.id === s.id || (r.scope === s.scope && r.nature === s.nature && normalizar(r.name) === normalizar(s.name))));
  return faltam.length ? { ...valor, reasons: [...valor.reasons, ...faltam] } : valor;
}

/** Agrupa as versões por motivo (o registro que viaja pelo HTTP): `[{ id, versions: [...] }]`, na ordem de primeira aparição. */
function registros(loja) {
  const por = new Map();
  for (const r of loja.reasons) por.set(r.id, [...(por.get(r.id) || []), r]);
  return [...por.entries()].map(([id, versions]) => ({ id, versions: versions.sort((a, b) => a.version - b.version) }));
}

module.exports = { MotivoInvalidoError, NATUREZAS, sementes, adicionar, revisar, lojaValida, normalizarLoja, registros, atuais, normalizar, podeGerenciar, direcao, textoPadrao, erroDoTexto, SEMENTE_EM };
