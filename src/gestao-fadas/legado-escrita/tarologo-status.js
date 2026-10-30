'use strict';

/**
 * `tbl_tarologos.status` (Maturacao/47 Q11): 2 = em consulta, 1 = disponível, SÓ esses valores. Diferente do ASP, roda DEPOIS de a consulta ser gravada no legado
 * (nunca antes de validar) e só no tarólogo da consulta. Fecha para 1 apenas se ele não tem OUTRA consulta aberta no legado. MyISAM: idempotente, sem rollback.
 */

const sql = require('./sql.financeiro');

async function marcar(ex, idTarologo, idConsultaLegado, aberta) {
  let valor = 2;
  if (!aberta) {
    const [[o]] = await ex.execute(sql.SELECT_ABERTAS_TAROLOGO, [Number(idTarologo), Number(idConsultaLegado) || 0]);
    valor = Number(o.n) > 0 ? 2 : 1;
  }
  await ex.execute(sql.UPDATE_STATUS_TAROLOGO, [valor, Number(idTarologo)]);
  return valor;
}

module.exports = { marcar };
