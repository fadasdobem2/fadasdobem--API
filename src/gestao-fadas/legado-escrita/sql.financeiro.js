'use strict';

/**
 * ALLOWLIST dos espelhos de pagamento informado (`tbl_pagtoinformado`), nota da ficha (`obs_liberacao_consulta`) e status do tarólogo (`tbl_tarologos.status`),
 * Maturacao/45 e 47. Só INSERT/UPDATE de colunas EXPLÍCITAS e SELECTs de conferência, texto fixo com `?`. NUNCA DELETE, DDL, `usuarios.saldo`/`valorAPagar`,
 * `tbl_pagtoconfirmado`, `tbl_pagtonaolocalizado`, `contacorrente`, `tbl_bonus`.
 */

const COLUNAS_PAGTO = Object.freeze(['idUsuario', 'dtPagtoInformado', 'vlPagtoInformado', 'idBanco', 'autPagtoInformado', 'idFormaPagto', 'obsPagtoInformado', 'nmuAtendente', 'id_status_pagto']);
const INSERT_PAGTO = `INSERT INTO tbl_pagtoinformado (${COLUNAS_PAGTO.join(', ')}) VALUES (${COLUNAS_PAGTO.map(() => '?').join(', ')})`;
// Confirmar = só `id_status_pagto` -> 2 na própria linha (o que o ASP vivo faz). A cliente é conferida no WHERE; nunca toca outra coluna.
const UPDATE_PAGTO_CONFIRMA = 'UPDATE tbl_pagtoinformado SET id_status_pagto = ? WHERE idPagtoInformado = ? AND idUsuario = ? AND id_status_pagto <> ?';
const SELECT_PAGTO = `SELECT idPagtoInformado, ${COLUNAS_PAGTO.join(', ')} FROM tbl_pagtoinformado WHERE idPagtoInformado = ?`;
const SELECT_BANCO = 'SELECT idBanco FROM tbl_bancos WHERE idBanco = ?';
const SELECT_STATUS_PAGTO = 'SELECT id_status_pagto FROM status_pagamento WHERE id_status_pagto = ?';

const INSERT_OBS = 'INSERT INTO obs_liberacao_consulta (id_usuario, `desc`, id_atendente) VALUES (?, ?, ?)';
const SELECT_OBS = 'SELECT id, id_usuario, `desc`, id_atendente FROM obs_liberacao_consulta WHERE id = ?';
const SELECT_EQUIPE = 'SELECT id FROM usuarios WHERE id = ? AND nivel IN (2, 99)';

const UPDATE_STATUS_TAROLOGO = 'UPDATE tbl_tarologos SET status = ? WHERE idTarologo = ?';
const SELECT_ABERTAS_TAROLOGO = "SELECT COUNT(*) AS n FROM tbl_consultas WHERE idTarologo = ? AND fimConsulta = '0000-00-00 00:00:00' AND idConsulta <> ?";

const PERMITIDAS = new Set([INSERT_PAGTO, UPDATE_PAGTO_CONFIRMA, SELECT_PAGTO, SELECT_BANCO, SELECT_STATUS_PAGTO, INSERT_OBS, SELECT_OBS, SELECT_EQUIPE, UPDATE_STATUS_TAROLOGO, SELECT_ABERTAS_TAROLOGO]);

module.exports = { COLUNAS_PAGTO, INSERT_PAGTO, UPDATE_PAGTO_CONFIRMA, SELECT_PAGTO, SELECT_BANCO, SELECT_STATUS_PAGTO, INSERT_OBS, SELECT_OBS, SELECT_EQUIPE, UPDATE_STATUS_TAROLOGO, SELECT_ABERTAS_TAROLOGO, PERMITIDAS };
