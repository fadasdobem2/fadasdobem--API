'use strict';

/**
 * Migração por planilha (Maturacao/55). Porte do código do front, SEM mudar regra:
 *   - `features/migration/client-migration-history-model.ts`: `validClientMigrationHistory`, `migrationOpeningCents`, `migrationEventAfterCutoff`,
 *     `migrationOpeningOffset`, `appendClientMigrationHistories` (idempotência por `sourceKey`, conflito, "superada");
 *   - `features/migration/migration-model.ts#parseMigrationDate` (chave de calendário de São Paulo, não instante absoluto);
 *   - `features/finance/client-postpaid-credit.ts#validClientPostpaidCredit`;
 *   - `features/finance/account-story.ts#clientAccountStory` SÓ os pares (instante, valor) de cada linha da conta, que é o que o corte precisa.
 * A planilha MANDA no saldo de abertura (decisão da Nice, 31/10/2026): saldo = crédito importado - (cobrar ? débito importado : 0); débito "não cobrar"
 * fica visível na ficha, mas não entra na conta operacional. Movimento depois do corte individual entra na conta; antes do corte fica no histórico.
 * Função pura: nenhum banco, nenhum relógio.
 */

const b = require('./financeiro-base');
const c = require('./financeiro-cobranca');
const s = require('./financeiro-saldo');

class MigracaoInvalidaError extends Error {
  constructor(mensagem, tipo = 'regra') { super(mensagem); this.name = 'MigracaoInvalidaError'; this.tipo = tipo; }
}
const MENSAGEM_INVALIDA = 'Confira a composição, o corte e os dados da abertura antes de aplicar à ficha.';
const MENSAGEM_OUTROS_DADOS = 'Esta conferência já foi aplicada com outros dados. Revise o lote antes de aplicar novamente.';
const MENSAGEM_SUPERADA = 'Esta conferência foi superada por uma abertura mais recente. Faça uma nova revisão antes de aplicar à ficha.';

const naoVazio = (v) => typeof v === 'string' && v.trim().length > 0;
const centavos = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const EM_SP = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** `parseMigrationDate`: chave de calendário (parede de São Paulo) comparável; null se a data não existe. */
function parseMigrationDate(valor) {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(limpo);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(limpo);
  if (!br && !iso) return null;
  const ano = Number((br && br[3]) ?? (iso && iso[1])); const mes = Number((br && br[2]) ?? (iso && iso[2])); const dia = Number((br && br[1]) ?? (iso && iso[3]));
  const hora = Number((br && br[4]) ?? (iso && iso[4]) ?? 0); const minuto = Number((br && br[5]) ?? (iso && iso[5]) ?? 0); const segundo = Number((br && br[6]) ?? (iso && iso[6]) ?? 0);
  if (ano < 1000 || mes < 1 || mes > 12 || dia < 1 || hora > 23 || minuto > 59 || segundo > 59) return null;
  const carimbo = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo);
  const conferido = new Date(carimbo);
  if (conferido.getUTCFullYear() !== ano || conferido.getUTCMonth() !== mes - 1 || conferido.getUTCDate() !== dia) return null;
  if (iso && iso[7]) {
    const lido = Date.parse(limpo);
    if (!Number.isFinite(lido)) return null;
    const p = Object.fromEntries(EM_SP.formatToParts(lido).map((x) => [x.type, x.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  }
  return carimbo;
}

/** `validClientPostpaidCredit` (client-postpaid-credit.ts). */
function creditoPosPagoValido(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (!Object.keys(v).every((k) => k === 'limit' || k === 'paymentTermDays')) return false;
  const limiteOk = v.limit === undefined || (typeof v.limit === 'number' && Number.isFinite(v.limit) && v.limit >= 0 && Number.isSafeInteger(Math.round(v.limit * 100)) && Math.abs(v.limit * 100 - Math.round(v.limit * 100)) < 1e-6);
  const prazoOk = v.paymentTermDays === undefined || (typeof v.paymentTermDays === 'number' && Number.isSafeInteger(v.paymentTermDays) && v.paymentTermDays >= 0 && v.paymentTermDays <= 3650);
  return limiteOk && prazoOk;
}

/** `validClientMigrationHistory` (client-migration-history-model.ts), campo a campo. */
function historicoValido(h) {
  if (!h || typeof h !== 'object') return false;
  if (h.version !== 1 || !naoVazio(h.clientId) || !naoVazio(h.clientName) || !naoVazio(h.cutoffAt) || parseMigrationDate(h.cutoffAt) === null || !naoVazio(h.batchId) || !naoVazio(h.sourceKey) || !naoVazio(h.approvedBy) || !naoVazio(h.approvedAt) || !Number.isFinite(Date.parse(h.approvedAt)) || !naoVazio(h.note) || !centavos(h.rateCents) || h.rateCents === 0 || !centavos(h.importedDebitCents) || !centavos(h.importedCreditCents) || typeof h.collectDebt !== 'boolean' || typeof h.postpaid !== 'boolean' || !Array.isArray(h.items)) return false;
  if ([h.sourceDate, h.dateMeaning, h.sourceNote].some((v) => v !== undefined && typeof v !== 'string')) return false;
  if (h.postpaidCredit !== undefined && !creditoPosPagoValido(h.postpaidCredit)) return false;
  const corte = parseMigrationDate(h.cutoffAt);
  const ids = new Set(); let alocado = 0;
  for (const item of h.items) {
    if (!item || typeof item !== 'object') return false;
    if (!naoVazio(item.id) || ids.has(item.id) || !naoVazio(item.date) || parseMigrationDate(item.date) === null || !naoVazio(item.tarot) || !Number.isFinite(item.minutes) || item.minutes <= 0 || !centavos(item.valueTodayCents) || !centavos(item.allocatedCents) || item.allocatedCents > item.valueTodayCents || typeof item.partial !== 'boolean' || item.partial !== (item.allocatedCents < item.valueTodayCents) || (item.originalCents !== undefined && !centavos(item.originalCents))) return false;
    if (parseMigrationDate(item.date) > corte) return false;
    ids.add(item.id); alocado += item.allocatedCents;
  }
  if (h.previousConsultations !== undefined && (!Array.isArray(h.previousConsultations) || !h.previousConsultations.every((i) => i && naoVazio(i.id) && naoVazio(i.tarot) && parseMigrationDate(i.date) !== null && parseMigrationDate(i.date) <= corte && Number.isFinite(i.minutes) && i.minutes >= 0 && (i.originalCents === undefined || centavos(i.originalCents))))) return false;
  return Number.isSafeInteger(alocado) && (h.collectDebt ? alocado === h.importedDebitCents : alocado <= h.importedDebitCents);
}

/** Abertura da planilha em centavos: crédito - (cobrar ? débito : 0). Débito "não cobrar" não entra na conta. */
const aberturaEmCentavos = (h) => h.importedCreditCents - (h.collectDebt ? h.importedDebitCents : 0);

/** `migrationEventAfterCutoff`: o corte usa o instante ORIGINAL da transação (`at`), nunca a data de exibição. */
function depoisDoCorte(h, evento) {
  const quando = parseMigrationDate(evento.at); const corte = parseMigrationDate(h.cutoffAt);
  return quando !== null && corte !== null && quando > corte;
}

/**
 * As linhas da conta da cliente que o corte precisa: `{ at, value }` (value em REAIS, como `AccountStoryEvent.value`).
 * Mesma seleção e mesmos valores de `clientAccountStory`: recebimento, movimentos, transferências de saldo, consulta (débito bruto) e dispensas.
 */
function linhasDaConta(clientId, pagamentos, consultas) {
  const linhas = [];
  const proprios = pagamentos.filter((p) => p.clientId === clientId);
  for (const p of proprios) {
    const confirmado = s.recebimentoConfirmado(p);
    linhas.push({ at: b.pagoEm(p), value: confirmado ? p.amount : 0 });
    for (const m of (p.movements || []).filter((x) => x.kind !== 'balance-transfer')) linhas.push({ at: m.occurredAt, value: confirmado ? m.creditEffect : 0 });
  }
  for (const p of pagamentos) {
    for (const m of p.movements || []) {
      const t = m.balanceTransfer;
      if (m.kind !== 'balance-transfer' || !t || ![t.sourceClientId, t.targetClientId].includes(clientId)) continue;
      linhas.push({ at: m.occurredAt, value: t.sourceClientId === clientId ? -m.amount : m.amount });
    }
  }
  for (const item of consultas.filter((x) => x.clientId === clientId)) {
    const acerto = c.acerto(item, pagamentos);
    if (acerto.debit === 0 && !b.contaMinutos(item.status) && !(item.billing && item.billing.chargeAdjustments && item.billing.chargeAdjustments.length)) continue;
    linhas.push({ at: item.endedAt || item.updatedAt, value: -acerto.grossDebit });
    let dispensaRestante = s.emCentavos(acerto.waivedAmount);
    for (const ajuste of (item.billing && item.billing.chargeAdjustments) || []) {
      const aplicado = Math.min(dispensaRestante, s.emCentavos(ajuste.amount)); dispensaRestante -= aplicado;
      linhas.push({ at: ajuste.at, value: aplicado / 100 });
    }
  }
  return linhas;
}

/**
 * `migrationOpeningOffset`: o "crédito" que entra na conta (`profile.credit`) para que saldo = abertura da planilha + movimentos DEPOIS do corte.
 * Usa SÓ os movimentos que o servidor guarda; o que for do corte para trás fica no histórico e é descontado do offset, uma única vez.
 */
function offsetDaAbertura(h, linhas) {
  const anteriores = linhas.filter((l) => !depoisDoCorte(h, l)).reduce((soma, l) => soma + Math.round(l.value * 100), 0);
  return (aberturaEmCentavos(h) - anteriores) / 100;
}

const igualEstavel = (a, bb) => estavel(a) === estavel(bb);
function estavel(v) {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${estavel(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/**
 * `appendClientMigrationHistories`: `existentes` é `{ clientId: [revisões...] }` (a última é a vigente). Devolve `{ novos, repetidos }`:
 * `novos` são as revisões a acrescentar (na ordem do lote), `repetidos` os `sourceKey` já aplicados com os MESMOS dados (idempotente, nada a gravar).
 * Erros iguais aos do front: inválido, mesmo `sourceKey` com outros dados, e "superada por abertura mais recente".
 */
function aplicarLote(existentes, historicos) {
  const atual = {};
  for (const [id, linhas] of Object.entries(existentes || {})) atual[id] = [...linhas];
  const novos = []; const repetidos = [];
  for (const h of historicos) {
    if (!historicoValido(h)) throw new MigracaoInvalidaError(MENSAGEM_INVALIDA, 'invalido');
    const atuais = atual[h.clientId] || [];
    const anterior = atuais.find((x) => x.sourceKey === h.sourceKey);
    if (anterior) {
      if (!igualEstavel(anterior, h)) throw new MigracaoInvalidaError(MENSAGEM_OUTROS_DADOS, 'outros-dados');
      if (anterior !== atuais[atuais.length - 1]) throw new MigracaoInvalidaError(MENSAGEM_SUPERADA, 'superada');
      repetidos.push(h.sourceKey);
      continue;
    }
    atual[h.clientId] = [...atuais, h]; novos.push(h);
  }
  return { novos, repetidos };
}

/** `latestMigrationPostpaidCredit`: uma abertura só de saldo não apaga as condições de um lote anterior. */
function ultimoCreditoPosPago(historicos, clientId) {
  const l = historicos.filter((h) => h.clientId === clientId && h.postpaidCredit !== undefined);
  return l.length ? l[l.length - 1].postpaidCredit : undefined;
}

module.exports = {
  MigracaoInvalidaError, MENSAGEM_INVALIDA, MENSAGEM_OUTROS_DADOS, MENSAGEM_SUPERADA, parseMigrationDate, creditoPosPagoValido, historicoValido,
  aberturaEmCentavos, depoisDoCorte, linhasDaConta, offsetDaAbertura, aplicarLote, ultimoCreditoPosPago, estavel,
};
