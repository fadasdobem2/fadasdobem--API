'use strict';

/**
 * Validação do `PaymentRecord` que o front monta (Maturacao/29 seção 10). FORMA e invariantes, nunca o saldo: o servidor não aceita dinheiro
 * em fração de centavo, status/forma desconhecidos, nem apaga história (auditoria e movimentos só crescem, nada de reativar cancelado).
 * Quem lança, quando e por quem são do servidor (`informedBy`, `informedAt`, `updatedAt`, autor e instante dos eventos novos).
 * Mensagens de regra (422) são as do front (`domain/pricing.ts` `validatePurchase`, `client-minute-benefits.ts` `createMinuteBenefit`).
 */

const f = require('./fin.comum');
const regras = require('../../_comum/dominio/pagamentos-regras');

const METODOS = ['PIX', 'Cartão de crédito', 'Transferência', 'Depósito', 'Dinheiro'];
const BANCOS = ['Mercado Pago', 'Itaú Jurídica', 'Itaú', 'Santander', 'BB', 'Caixa'];
const STATUS = ['Informado', 'Corrigido', 'Em conferência', 'Cancelado'];
const MOVIMENTOS = ['balance-transfer', 'refund', 'dispute', 'dispute-debit', 'dispute-rejected', 'dispute-accepted', 'dispute-return', 'payment-missing', 'scheduled-unpaid', 'payment-reconciled'];
const LIMITE_BYTES = 180000;

const centavosExatos = (v) => Number.isFinite(v) && Math.abs(v * 100 - Math.round(v * 100)) <= 0.000001;
const texto = (v, campo, max, obrigatorio = true) => {
  if (v === undefined && !obrigatorio) return undefined;
  if (typeof v !== 'string' || (obrigatorio && !v.trim()) || v.length > max) throw f.invalido(campo);
  return v;
};
const numero = (v, campo, { min = -1e9, max = 1e9, centavos = true } = {}) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (centavos && !centavosExatos(v))) throw f.invalido(campo);
  return v;
};
const dataOuInstante = (v, campo) => {
  if (typeof v !== 'string' || !(/^\d{4}-\d{2}-\d{2}$/.test(v) ? Number.isFinite(Date.parse(`${v}T12:00:00Z`)) : Number.isFinite(Date.parse(v)))) throw f.invalido(campo);
  return v;
};

/** Forma do registro. Devolve o próprio registro (nada é reescrito aqui). */
function forma(r) {
  if (!f.ehObjeto(r)) throw f.invalido('record');
  if (Buffer.byteLength(JSON.stringify(r)) > LIMITE_BYTES) throw f.invalido('record');
  f.idRegistro(r.id, 'record.id'); f.idCliente(r.clientId, 'record.clientId'); texto(r.client, 'record.client', 200);
  numero(r.amount, 'record.amount', { min: 0.01, max: 10000000 });
  if (!METODOS.includes(r.method)) throw f.invalido('record.method');
  if (r.bank !== undefined && !BANCOS.includes(r.bank)) throw f.invalido('record.bank');
  if (!STATUS.includes(r.status)) throw f.invalido('record.status');
  if (r.confirmation !== undefined && !['Confirmado', 'A confirmar'].includes(r.confirmation)) throw f.invalido('record.confirmation');
  if (r.paidAt !== undefined) dataOuInstante(r.paidAt, 'record.paidAt');
  for (const campo of ['grossAmount', 'actualFee']) if (r[campo] !== undefined) numero(r[campo], `record.${campo}`, { min: 0, max: 10000000 });
  if (r.cashUnitValue !== undefined) numero(r.cashUnitValue, 'record.cashUnitValue', { min: 0.01, max: 100000, centavos: false });
  if (r.linkedConsultationId !== undefined) f.idRegistro(r.linkedConsultationId, 'record.linkedConsultationId');
  // Limites de texto do front (observação 4.000, nome 200, autorização 100) e a frase da tela ficam em `pagamentos-regras.js`; aqui só o teto de segurança.
  if (r.note !== undefined) texto(r.note, 'record.note', 20000, false);
  if (r.payerName !== undefined) texto(r.payerName, 'record.payerName', 2000, false);
  if (r.authorization !== undefined) texto(r.authorization, 'record.authorization', 2000, false);
  if (r.purchase !== undefined) {
    const p = r.purchase;
    if (!f.ehObjeto(p) || !Number.isSafeInteger(p.minutes) || p.minutes < 1 || !['first', 'regular', 'custom'].includes(p.table) || !Number.isFinite(p.amount) || Math.round(p.amount * 100) !== Math.round(r.amount * 100)) {
      throw f.regra('Confira os minutos comprados e o valor da compra.'); // validatePurchase (pricing.ts)
    }
  }
  if (r.movements !== undefined) {
    if (!Array.isArray(r.movements) || r.movements.length > 500) throw f.invalido('record.movements');
    for (const m of r.movements) {
      if (!f.ehObjeto(m)) throw f.invalido('record.movements');
      f.idRegistro(m.id, 'record.movements.id');
      if (!MOVIMENTOS.includes(m.kind)) throw f.invalido('record.movements.kind');
      numero(m.amount, 'record.movements.amount'); numero(m.bankEffect, 'record.movements.bankEffect'); numero(m.creditEffect, 'record.movements.creditEffect');
      f.instante(m.occurredAt, 'record.movements.occurredAt'); texto(m.actor, 'record.movements.actor', 200); texto(m.note, 'record.movements.note', 2000, false);
    }
  }
  if (r.audit !== undefined) {
    if (!Array.isArray(r.audit) || r.audit.length > 1000) throw f.invalido('record.audit');
    for (const e of r.audit) { if (!f.ehObjeto(e)) throw f.invalido('record.audit'); texto(e.id, 'record.audit.id', 120); texto(e.action, 'record.audit.action', 80); texto(e.actor, 'record.audit.actor', 200); }
  }
  return r;
}

const igual = f.igual;
const idsDe = (lista) => (lista || []).map((x) => x.id);

/**
 * Lançamento novo: o servidor carimba autor e instantes. Devolve o registro que vai ao banco.
 * (`informedAt` é do servidor; `paidAt` fica como a equipe informou: sem data conhecida, nada é inventado.)
 */
function carimbarNovo(r, ator, agora) {
  const audit = (r.audit || []).map((e) => ({ ...e, actor: ator.nome, createdAt: agora }));
  const movimentos = r.movements ? r.movements.map((m) => ({ ...m, actor: ator.nome, recordedAt: agora })) : undefined;
  return { ...r, informedAt: agora, informedBy: ator.nome, updatedAt: agora, updatedBy: ator.nome, audit, ...(movimentos ? { movements: movimentos } : {}) };
}

/**
 * Revisão de um recebimento existente: o que não pode mudar (id, quem informou e quando, história que só cresce, cancelado fica cancelado) e
 * quem pode (movimentos de saída, estorno, contestação e transferência são do Financeiro: administradora e assistente, como `canManageFinancial`).
 * Devolve o registro com autor e instante dos eventos novos carimbados pelo servidor.
 */
function carimbarRevisao(antes, depois, ator, agora) {
  if (depois.id !== antes.id) throw f.invalido('record.id');
  if (depois.informedAt !== antes.informedAt || depois.informedBy !== antes.informedBy) throw f.regra('Não foi possível identificar esta alteração.');
  if (antes.status === 'Cancelado' && depois.status !== 'Cancelado') throw f.regra('Este pagamento está cancelado e não pode ser reaberto.');
  const antigosAudit = antes.audit || []; const novosAudit = depois.audit || [];
  if (novosAudit.length < antigosAudit.length || !igual(idsDe(novosAudit.slice(0, antigosAudit.length)), idsDe(antigosAudit))) throw f.regra('O histórico do pagamento não pode ser apagado.');
  const antigosMov = antes.movements || []; const novosMov = depois.movements || [];
  if (novosMov.length < antigosMov.length || !igual(novosMov.slice(0, antigosMov.length), antigosMov)) throw f.regra('Os movimentos do pagamento não podem ser alterados nem apagados.');
  if (novosMov.length > antigosMov.length && !ator.p.canViewAllPayments) throw f.negado(true);
  regras.conferirRevisao(antes, depois, ator.p);
  const audit = [...novosAudit.slice(0, antigosAudit.length), ...novosAudit.slice(antigosAudit.length).map((e) => ({ ...e, actor: ator.nome, createdAt: agora }))];
  const movements = [...novosMov.slice(0, antigosMov.length), ...novosMov.slice(antigosMov.length).map((m) => ({ ...m, actor: ator.nome, recordedAt: agora }))];
  return { ...depois, updatedAt: agora, updatedBy: ator.nome, audit, ...(novosMov.length ? { movements } : {}) };
}

/** Que tipo de evento a revisão representa (para a trilha): olha o que mudou. */
function classificar(antes, depois) {
  if ((depois.movements || []).length > (antes.movements || []).length) return 'movimento';
  if (antes.status !== 'Cancelado' && depois.status === 'Cancelado') return 'cancelamento';
  if (antes.confirmation !== depois.confirmation && depois.confirmation === 'Confirmado') return 'confirmacao';
  if (antes.linkedConsultationId !== depois.linkedConsultationId) return 'vinculo';
  if (antes.amount !== depois.amount || antes.method !== depois.method || antes.paidAt !== depois.paidAt) return 'correcao';
  return 'revisao';
}

/** Colunas do banco a partir do registro. */
function colunas(r) {
  const { id: _id, ...resto } = r;
  return [r.clientId, r.status, r.confirmation ?? null, Math.round(r.amount * 100), r.method, r.linkedConsultationId ?? null, r.informedAt, JSON.stringify(resto)];
}

/** Benefício (Bônus/Cortesia): as regras de `createMinuteBenefit` (client-minute-benefits.ts). */
function beneficio(b) {
  if (!f.ehObjeto(b)) throw f.invalido('benefit');
  f.idRegistro(b.id, 'benefit.id'); f.idCliente(b.clientId, 'benefit.clientId');
  if (!['Bônus', 'Cortesia'].includes(b.kind) || !Number.isSafeInteger(b.minutes) || b.minutes < 1 || b.minutes > 1440) throw f.regra('Informe de 1 a 1440 minutos inteiros.');
  if (typeof b.reason !== 'string' || !b.reason.trim()) throw f.regra('Informe o motivo do bônus ou da cortesia.');
  if (b.reason.length > 1000) throw f.invalido('benefit.reason');
  if (!Number.isFinite(b.unitValue) || b.unitValue <= 0 || b.unitValue > 100000) throw f.regra('Confira a referência do minuto.');
  if (b.sourceConsultationId !== undefined) f.idRegistro(b.sourceConsultationId, 'benefit.sourceConsultationId');
  return b;
}

module.exports = { forma, carimbarNovo, carimbarRevisao, classificar, colunas, beneficio, METODOS };
