'use strict';

/**
 * Cenários das regras do store (item 3 do teste diferencial): as MESMAS entradas rodam na loja da B (gerador do ouro) e na
 * da A (verificador), sobre o banco falso de `banco-falso.js`. Cada passo chama uma operação do store e guarda a saída
 * (registro ou código da recusa); o traço de SQL, as saídas e o estado final das tabelas são comparados com o ouro.
 */

const path = require('node:path');

const raizA = path.join(__dirname, '..', '..', 'src', 'gestao-fadas', 'features', 'repasse');
const validacao = require(path.join(raizA, 'repasse.validacao'));
const { entradaDaAbertura } = require(path.join(raizA, 'escrita', 'entrada'));

const ator = { accountId: 'conta-1', role: 'administradora' };
const outro = { accountId: 'conta-2', role: 'administradora' };

const corpoBase = (extra = {}) => ({
  tarotId: '7', lastPayment: { paidOn: '2026-10-01', amount: '100.00', sheetRef: 'L12' }, settledThrough: '2026-10-02T06:00:00',
  remainingBalance: '50.00', migrationCut: '2026-10-05T06:00:00', rate: '30',
  openAdjustments: [{ kind: 'bonus', amount: '10.00', description: 'bônus', date: '2026-10-03' }, { kind: 'desconto', amount: '-3.50', description: 'taxa', date: '2026-10-04' }],
  debts: [
    { kind: 'loan', remaining: '100.00', sheetRef: 'E5', installments: [{ date: '2026-10-10', amount: '60.00' }, { date: '2026-11-10', amount: '40.00' }] },
    { kind: 'advance', remaining: '20.00', originalDeliveryOn: '2026-09-20', sheetRef: 'E6', installments: [{ date: '2026-10-15', amount: '20.00' }] },
  ],
  differences: [{ description: 'diferença A' }, { description: 'diferença B', amount: '1.25' }], operationKey: 'abre-1', ...extra,
});
const abertura = (extra, quem = ator) => entradaDaAbertura(validacao.corpoAbertura(corpoBase(extra)), quem);
const correcao = (id, extra, quem = ator) => ({ ...entradaDaAbertura(validacao.corpoCorrecao({ ...corpoBase(extra), reason: 'corrigindo' }), quem), openingId: id, reason: extra && extra.reason ? extra.reason : 'corrigindo' });
const comissao = (extra = {}) => ({ operationKey: 'com-1', actor: ator, tarotId: '7', rate: '35.00', reason: 'ajuste', effectiveFrom: '2026-10-29 10:00:00', ...extra });
const calendario = (extra = {}) => ({ operationKey: 'cal-1', actor: ator, tarotId: '7', schedule: { kind: 'monthdays', days: [5, 20], weekendPolicy: 'next-business-day' }, reason: null, effectiveFrom: '2026-10-29 10:00:00', ...extra });
const confirmar = (id, key = 'conf-1', quem = ator) => ({ operationKey: key, actor: quem, openingId: id });

const P = (op, entrada, extra = {}) => ({ op, entrada, ...extra });
/** O id da abertura criada no passo `i` (as ids são contadores do banco falso, iguais nos dois lados). */
const idDe = (i) => (saidas) => saidas[i].ok.id;

const CENARIOS = [
  { nome: 'acordo: percentual e calendario, repetir, conflitos', passos: [
    P('setCommissionRate', comissao()), P('setCommissionRate', comissao()),
    P('setCommissionRate', comissao({ rate: '36.00' })), P('setCommissionRate', comissao({ reason: 'outro' })), P('setCommissionRate', comissao({ reason: null })),
    P('setCommissionRate', comissao({ actor: outro })), P('setPaymentSchedule', calendario({ operationKey: 'com-1' })),
    P('setCommissionRate', comissao({ operationKey: 'com-2', rate: '40.00', effectiveFrom: '2026-10-30 10:00:00', reason: null })),
    P('setPaymentSchedule', calendario()), P('setPaymentSchedule', calendario({ schedule: { kind: 'monthdays', days: [20, 5], weekendPolicy: 'next-business-day' } })),
    P('setPaymentSchedule', calendario({ operationKey: 'cal-2', schedule: { kind: 'weekday', weekday: 'sexta' }, reason: 'x', effectiveFrom: '2026-10-30 10:00:00' })),
    P('setPaymentSchedule', calendario({ operationKey: 'cal-3', schedule: { kind: 'none' }, effectiveFrom: '2026-10-31 10:00:00' })),
  ] },
  { nome: 'acordo: tarologo ausente do legado, conta ausente, corrida da mesma chave', opcoes: { tarologos: ['7'], contas: ['conta-1', 'conta-2'] }, passos: [
    P('setCommissionRate', comissao({ tarotId: '8' })), P('setCommissionRate', comissao()),
    P('setCommissionRate', comissao(), { antes: (n) => { n.esconderReplayUmaVez = true; } }),
    P('setCommissionRate', comissao({ rate: '41.00' }), { antes: (n) => { n.esconderReplayUmaVez = true; } }),
    P('setCommissionRate', comissao({ operationKey: 'com-9' }), { antes: (n) => { n.falharNaAuditoria = true; }, depois: (n) => { n.falharNaAuditoria = false; } }),
    P('setCommissionRate', comissao({ operationKey: 'com-9' })),
  ] },
  { nome: 'abertura: rascunho, repetir, segundo rascunho, confirmar, outra abertura', passos: [
    P('draftOpening', abertura()), P('draftOpening', abertura()), P('draftOpening', abertura({ operationKey: 'abre-2' })),
    P('draftOpening', abertura({ rate: '31' })),
    P('confirmOpening', (s) => confirmar(s[0].ok.id)), P('confirmOpening', (s) => confirmar(s[0].ok.id)),
    P('confirmOpening', (s) => confirmar(s[0].ok.id, 'conf-2')), P('confirmOpening', confirmar('nao-existe', 'conf-3')),
    P('draftOpening', abertura({ operationKey: 'abre-3' })),
  ] },
  { nome: 'abertura: corrigir rascunho (descarta), corrigir confirmada, confirmar N+1 substitui dividas', passos: [
    P('draftOpening', abertura()),
    P('correctOpening', (s) => correcao(s[0].ok.id, { operationKey: 'corr-1', remainingBalance: '60.00' })),
    P('correctOpening', (s) => correcao(s[0].ok.id, { operationKey: 'corr-2' })),
    P('confirmOpening', (s) => confirmar(s[1].ok.id)),
    P('correctOpening', (s) => correcao(s[1].ok.id, { operationKey: 'corr-3', debts: [{ kind: 'loan', remaining: '70.00', sheetRef: 'N1', installments: [{ date: '2026-10-20', amount: '70.00' }] }], rate: '33.5' })),
    P('correctOpening', (s) => correcao(s[1].ok.id, { operationKey: 'corr-4' })),
    P('correctOpening', (s) => correcao(s[1].ok.id, { operationKey: 'corr-3', debts: [{ kind: 'loan', remaining: '70.00', sheetRef: 'N1', installments: [{ date: '2026-10-20', amount: '70.00' }] }], rate: '33.5' })),
    P('confirmOpening', (s) => confirmar(s[4].ok.id, 'conf-4')),
    P('correctOpening', (s) => correcao(s[4].ok.id, { operationKey: 'corr-5', debts: [] })),
    P('correctOpening', (s) => correcao(s[1].ok.id, { operationKey: 'corr-6' })),
  ] },
  { nome: 'abertura: correcao de outro tarologo, id inexistente, tarologo ausente', opcoes: { tarologos: ['7', '9'], contas: ['conta-1'] }, passos: [
    P('draftOpening', abertura()), P('draftOpening', abertura({ tarotId: '9', operationKey: 'abre-9' })),
    P('correctOpening', (s) => correcao(s[0].ok.id, { tarotId: '9', operationKey: 'corr-x' })),
    P('correctOpening', correcao('nao-existe', { operationKey: 'corr-y' })),
    P('draftOpening', abertura({ tarotId: '8', operationKey: 'abre-8' })),
  ] },
  { nome: 'abertura: reversao (auditoria falha), quitado depois do corte, parcelas que nao somam', passos: [
    P('draftOpening', abertura(), { antes: (n) => { n.falharNaAuditoria = true; }, depois: (n) => { n.falharNaAuditoria = false; } }),
    P('draftOpening', { ...abertura(), settledThrough: '2026-10-06 06:00:00' }),
    P('draftOpening', (() => { const e = abertura({ operationKey: 'abre-m' }); e.debts[0].installments[1].amount = '30.00'; return e; })()),
    P('draftOpening', abertura()),
  ] },
];

module.exports = { CENARIOS, comissao, abertura };
