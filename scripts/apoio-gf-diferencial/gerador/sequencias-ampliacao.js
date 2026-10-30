'use strict';

/** Sequências de pedidos de `history-access` na mesma tabela de auditoria: a repetição pela `operationKey` (item 1). */

const base = { id: '12', papel: 'supervisora', sessao: 's1', existe: true, conta: 'conta-1' };
const corpo = (extra = {}) => JSON.stringify({ reason: 'Atendimento da cliente', operationKey: 'k1', ...extra });
const P = (extra = {}, c = {}) => ({ ...base, corpoJson: corpo(c), ...extra });

const SEQUENCIAS = [
  { nome: 'mesma chave e mesmo pedido devolve a mesma liberação', passos: [P(), P(), P({}, { operationKey: 'k2' })] },
  { nome: 'mesma chave com outro motivo, sessão, conta, cliente ou espaços', passos: [
    P(), P({}, { reason: 'Outro motivo' }), P({ sessao: 's2' }), P({ conta: 'conta-2' }), P({ id: '13' }), P({}, { reason: '  Atendimento da cliente  ' }), P({ papel: 'administradora' }),
  ] },
  { nome: 'recusas não gravam nada e a chave continua livre', passos: [
    P({ existe: false }), P({}, { reason: '   ' }), P({ id: '007' }), P(), P({ existe: false }),
  ] },
];

module.exports = { SEQUENCIAS };
