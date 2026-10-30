'use strict';

/**
 * SQL das gravações de repasse (porte literal de `db/finance-store.ts`). Só `gf_*`; cada instrução passa por
 * `motivoDeRecusa` (models/legado/escrita.js) antes de ir ao servidor. As leituras sempre filtram por `tarot_id`.
 */

const INSERT_COMMISSION = `INSERT INTO gf_repasse_percentuais (id, tarot_id, percentual, vigente_desde, motivo, registrado_por, registrado_em, operation_key)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
const INSERT_SCHEDULE = `INSERT INTO gf_repasse_calendarios (id, tarot_id, tipo, dia_semana, dias_mes, politica_fim_semana, vigente_desde, motivo, registrado_por, registrado_em, operation_key)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const INSERT_OPENING = `INSERT INTO gf_repasse_aberturas (id, tarot_id, revisao, situacao, corrige_revisao, motivo_correcao, ultimo_pagamento_data, ultimo_pagamento_valor,
    planilha_referencia, quitado_ate, saldo_remanescente, saldo_composicao, corte_migracao, percentual_conferido, lancado_por, lancado_em, confirmado_por, confirmado_em, operation_key)
  VALUES (?, ?, ?, 'rascunho', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`;
const INSERT_DIFFERENCE = 'INSERT INTO gf_repasse_abertura_pendencias (id, abertura_id, descricao, valor, resolvida_em, resolvida_por) VALUES (?, ?, ?, ?, NULL, NULL)';
const INSERT_DEBT = `INSERT INTO gf_repasse_dividas (id, tarot_id, tipo, origem, abertura_id, valor, entrega_original, entregue_em, referencia_data, situacao, corrige_id,
    motivo_correcao, planilha_referencia, observacao, registrado_por, registrado_em, operation_key)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'valido', ?, ?, ?, ?, ?, ?, ?)`;
const INSERT_INSTALLMENT = 'INSERT INTO gf_repasse_divida_parcelas (divida_id, sequencia, data, valor) VALUES (?, ?, ?, ?)';
const INSTALLMENT_TOTAL = `SELECT d.valor, (SELECT COALESCE(SUM(p.valor), 0.00) FROM gf_repasse_divida_parcelas AS p WHERE p.divida_id = d.id) AS soma
  FROM gf_repasse_dividas AS d WHERE d.id = ?`;
const INSERT_ADJUSTMENT = `INSERT INTO gf_repasse_ajustes (id, tarot_id, tipo, valor, descricao, data, periodo_inicio, periodo_fim, abertura_id, situacao, corrige_id,
    motivo_correcao, registrado_por, registrado_em, operation_key)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'valido', ?, ?, ?, ?, ?)`;

const TAROT_OPENINGS = 'SELECT revisao, situacao FROM gf_repasse_aberturas WHERE tarot_id = ? FOR UPDATE';
const OPENING_STATE = 'SELECT tarot_id, revisao, situacao, quitado_ate, corte_migracao FROM gf_repasse_aberturas WHERE id = ? FOR UPDATE';
const CONFIRM_OPENING = "UPDATE gf_repasse_aberturas SET situacao = 'confirmada', confirmado_por = ?, confirmado_em = ? WHERE id = ?";
const DISCARD_OPENING = "UPDATE gf_repasse_aberturas SET situacao = 'descartada' WHERE id = ?";
const DEBT_STATE = 'SELECT tarot_id, situacao FROM gf_repasse_dividas WHERE id = ? FOR UPDATE';
const REPLACE_DEBT = "UPDATE gf_repasse_dividas SET situacao = 'substituido' WHERE id = ?";
// Confirmada a correção, as dívidas da migração que ainda valiam por outra revisão saem: as da N+1 herdam os descontos
// delas pela corrige_id.
const REPLACE_OLDER_MIGRATED_DEBTS = `UPDATE gf_repasse_dividas SET situacao = 'substituido'
  WHERE tarot_id = ? AND origem = 'migracao' AND situacao = 'valido' AND abertura_id <> ?`;

const COMMISSION_RATES = `SELECT id, tarot_id, percentual, vigente_desde, motivo, registrado_por, registrado_em, operation_key
  FROM gf_repasse_percentuais WHERE tarot_id = ? ORDER BY vigente_desde, id`;
const PAYMENT_SCHEDULES = `SELECT id, tarot_id, tipo, dia_semana, dias_mes, politica_fim_semana, vigente_desde, motivo, registrado_por, registrado_em, operation_key
  FROM gf_repasse_calendarios WHERE tarot_id = ? ORDER BY vigente_desde, id`;
const DEBTS = `SELECT id, tarot_id, tipo, origem, abertura_id, valor, entrega_original, entregue_em, referencia_data, situacao, corrige_id, motivo_correcao,
    planilha_referencia, observacao, registrado_por, registrado_em, operation_key
  FROM gf_repasse_dividas WHERE tarot_id = ? ORDER BY registrado_em, id`;
const INSTALLMENTS = `SELECT p.divida_id, p.sequencia, p.data, p.valor FROM gf_repasse_divida_parcelas AS p
  JOIN gf_repasse_dividas AS d ON d.id = p.divida_id WHERE d.tarot_id = ? ORDER BY p.divida_id, p.sequencia`;
const ADJUSTMENTS = `SELECT id, tarot_id, tipo, valor, descricao, data, periodo_inicio, periodo_fim, abertura_id, situacao, corrige_id, motivo_correcao,
    registrado_por, registrado_em, operation_key
  FROM gf_repasse_ajustes WHERE tarot_id = ? ORDER BY registrado_em, id`;
// A revisão corrigida volta também pelo id, que é o que a correção recebe.
const OPENINGS = `SELECT a.id, a.tarot_id, a.revisao, a.situacao, a.corrige_revisao, n.id AS corrige_id, a.motivo_correcao, a.ultimo_pagamento_data,
    a.ultimo_pagamento_valor, a.planilha_referencia, a.quitado_ate, a.saldo_remanescente, a.saldo_composicao, a.corte_migracao,
    a.percentual_conferido, a.lancado_por, a.lancado_em, a.confirmado_por, a.confirmado_em, a.operation_key
  FROM gf_repasse_aberturas AS a
  LEFT JOIN gf_repasse_aberturas AS n ON n.tarot_id = a.tarot_id AND n.revisao = a.corrige_revisao
  WHERE a.tarot_id = ? ORDER BY a.tarot_id, a.revisao`;
const DIFFERENCES = `SELECT p.id, p.abertura_id, p.descricao, p.valor, p.resolvida_em, p.resolvida_por FROM gf_repasse_abertura_pendencias AS p
  JOIN gf_repasse_aberturas AS a ON a.id = p.abertura_id WHERE a.tarot_id = ? ORDER BY p.abertura_id, p.id`;

const REPLAY = 'SELECT acao, entidade, ator_conta_id, depois FROM gf_auditoria WHERE operation_key = ?';
const ACCOUNT_EXISTS = 'SELECT id FROM gf_auth_accounts WHERE id = ?';

module.exports = {
  INSERT_COMMISSION, INSERT_SCHEDULE, INSERT_OPENING, INSERT_DIFFERENCE, INSERT_DEBT, INSERT_INSTALLMENT, INSTALLMENT_TOTAL, INSERT_ADJUSTMENT,
  TAROT_OPENINGS, OPENING_STATE, CONFIRM_OPENING, DISCARD_OPENING, DEBT_STATE, REPLACE_DEBT, REPLACE_OLDER_MIGRATED_DEBTS,
  COMMISSION_RATES, PAYMENT_SCHEDULES, DEBTS, INSTALLMENTS, ADJUSTMENTS, OPENINGS, DIFFERENCES, REPLAY, ACCOUNT_EXISTS,
};
