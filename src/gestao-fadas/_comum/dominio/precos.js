'use strict';

/**
 * Valores/Preços (Maturacao/29 seção 10): porte das funções PURAS do front `domain/financial-settings.ts` (validar, normalizar versões
 * agendadas, criar versão) e de `domain/pricing.ts` (reconhecer compra). A tabela padrão `VAL-001` e a vigência (`precoVigente`) estão em
 * `financeiro-base.js`. As mensagens são as `throw new Error` do front (a tela as mostra). Nada aqui lê banco nem relógio.
 */

const { PRECOS_PADRAO, valorDoMinuto, precoVigente } = require('./financeiro-base');

class PrecoInvalidoError extends Error { constructor(m) { super(m); this.name = 'PrecoInvalidoError'; } }
const erro = (m) => { throw new PrecoInvalidoError(m); };

const CAMPOS = Object.freeze({
  minute: ['regularMinuteValue'], first: ['firstConsultationPrices', 'firstConsultationWindowHours'], regular: ['regularPrices', 'minimumMinutes'], pix: ['pixKey'],
  all: ['regularMinuteValue', 'firstConsultationPrices', 'firstConsultationWindowHours', 'regularPrices', 'minimumMinutes', 'pixKey'],
});

function clonar(v) {
  return { ...v, regularMinuteValue: v.regularMinuteValue ?? valorDoMinuto(v), regularPrices: v.regularPrices.map((o) => ({ ...o })), firstConsultationPrices: v.firstConsultationPrices.map((o) => ({ ...o })) };
}

/** `normalizeScheduledFinancialSettingsHistory`: a versão agendada de snapshot antigo ganha `changedFields`. */
function normalizarAgendadas(historico, agora) {
  return historico.map((v) => {
    if (v.changedFields || Date.parse(v.effectiveAt) <= Date.parse(agora)) return v;
    const antecessoras = historico.filter((p) => p.id !== v.id && Date.parse(p.createdAt) < Date.parse(v.createdAt));
    const antes = clonar(precoVigente(antecessoras, v.createdAt));
    const agendada = clonar(v);
    const changedFields = CAMPOS.all.filter((campo) => JSON.stringify(agendada[campo]) !== JSON.stringify(antes[campo]));
    return { ...agendada, changedFields };
  });
}

const duasCasas = (n) => Math.abs(n * 100 - Math.round(n * 100)) <= 0.000001;

/** `validateFinancialSettings` (financial-settings.ts). */
function validar(v) {
  if (!`${v.pixKey ?? ''}`.trim()) erro('Informe a chave PIX.');
  if (v.pixKey.trim().length > 200) erro('A chave PIX deve ter até 200 caracteres.');
  const minuto = v.regularMinuteValue;
  if (!Number.isFinite(minuto) || minuto <= 0 || !duasCasas(minuto)) erro('Informe o valor do minuto com até duas casas decimais.');
  if (!Number.isSafeInteger(v.minimumMinutes) || v.minimumMinutes < 1) erro('Informe o tempo mínimo da consulta em minutos inteiros.');
  if (!Number.isSafeInteger(v.firstConsultationWindowHours) || v.firstConsultationWindowHours < 1) erro('Informe a validade da primeira consulta em horas inteiras.');
  for (const tabela of [v.regularPrices, v.firstConsultationPrices]) {
    if (!Array.isArray(tabela) || !tabela.length) erro('Cada tabela precisa ter ao menos uma duração.');
    if (new Set(tabela.map((o) => o.minutes)).size !== tabela.length) erro('Não repita a mesma duração dentro de uma tabela.');
    if (tabela.some((o) => !Number.isSafeInteger(o.minutes) || o.minutes <= 0 || !Number.isFinite(o.price) || o.price <= 0 || !duasCasas(o.price)
      || (o.referencePrice !== undefined && o.referencePrice !== 0 && (!Number.isFinite(o.referencePrice) || o.referencePrice < o.price || !duasCasas(o.referencePrice))))) erro('Revise os minutos e os valores das tabelas. Use até duas casas decimais.');
  }
}

/**
 * Cria a versão no SERVIDOR a partir do que o front enviou (`version`: id, effectiveAt, changedFields e os valores desses campos): a base
 * é a tabela vigente na data de vigência, os campos alterados vêm da versão, o autor e o instante de criação são do servidor
 * (equivalente a `createFinancialSettingsVersion` sem a conferência local de `original`, que o servidor troca pela revisão do histórico).
 */
function criarVersao({ historico, versao, ator, agora }) {
  if (!versao || typeof versao !== 'object') erro('Nenhuma alteração para salvar.');
  if (!Number.isFinite(Date.parse(versao.effectiveAt))) erro('Informe quando a alteração entra em vigor.');
  const campos = Array.isArray(versao.changedFields) ? versao.changedFields : [];
  if (!campos.length || campos.some((c) => !CAMPOS.all.includes(c)) || new Set(campos).size !== campos.length) erro('Nenhuma alteração para salvar.');
  const base = clonar(precoVigente(normalizarAgendadas(historico, agora), versao.effectiveAt));
  const nova = { ...base, ...Object.fromEntries(campos.map((c) => [c, versao[c]])), id: versao.id, createdAt: agora, createdBy: ator, effectiveAt: new Date(versao.effectiveAt).toISOString(), changedFields: campos };
  nova.regularPrices = [...(nova.regularPrices || [])].sort((a, b) => a.minutes - b.minutes);
  nova.firstConsultationPrices = [...(nova.firstConsultationPrices || [])].sort((a, b) => a.minutes - b.minutes);
  validar(nova);
  return nova;
}

/** `recognizePurchase` (pricing.ts): o pacote que o valor pago identifica sem ambiguidade. */
function reconhecerCompra(valor, preco) {
  const opcoes = [...preco.firstConsultationPrices.map((o) => ({ ...o, table: 'first' })), ...preco.regularPrices.map((o) => ({ ...o, table: 'regular' }))];
  const centavos = Math.round(valor * 100);
  const iguais = opcoes.filter((o) => Math.round(o.price * 100) === centavos);
  if (iguais.length !== 1) return undefined;
  return { minutes: iguais[0].minutes, amount: valor, table: iguais[0].table, priceVersionId: preco.id };
}

module.exports = { PrecoInvalidoError, CAMPOS, clonar, normalizarAgendadas, validar, criarVersao, reconhecerCompra, PRECOS_PADRAO, precoVigente };
