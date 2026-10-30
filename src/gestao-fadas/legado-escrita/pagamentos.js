'use strict';

/**
 * Pagamento informado no legado (`tbl_pagtoinformado`), PROVISÓRIO até a Nice confirmar (Maturacao/45, 47, 50). Só DEV por ora.
 *   INSERT ao lançar (9 colunas; `status` de texto, `dt_criado`, bandeira e parcelas ficam no padrão do banco) e UPDATE `id_status_pagto` -> 2 ao confirmar.
 *   Nunca DELETE (o cancelamento fica só no PostgreSQL), nunca `usuarios.saldo`/`valorAPagar`/`emailCobranca`, nunca `tbl_pagtoconfirmado`.
 * Canais sem id próprio (PIX, Dinheiro, Mercado Pago, Itaú Jurídica, Caixa) usam ids EXISTENTES (`provisorio.js#canalDePagamento`, provisório, pendente da Nice).
 * Cartão exige bandeira e parcelas, que o lançamento do sistema novo não coleta: recusado. Os ids são validados contra os catálogos ANTES de gravar (id fora do
 * catálogo faria a linha SUMIR das telas do ASP, INNER JOIN). Nunca toca pagamento do fluxo automático (nmuAtendente vazio): só atualiza linha criada por nós.
 */

const sql = require('./sql.financeiro');
const { MapeamentoError, dataDoLegado, textoUtf8Basico } = require('./mapeamento');
const { STATUS_PAGTO_NOVO, STATUS_PAGTO_CONFIRMADO, canalDePagamento } = require('./provisorio');

function canal(item) {
  const c = canalDePagamento(item.method, item.bank);
  if (c === null) throw new MapeamentoError('Cartão de crédito exige bandeira e parcelas no sistema antigo, que este lançamento não informa: o pagamento não foi espelhado (fica só no sistema novo).');
  if (c === undefined) throw new MapeamentoError(`A forma de pagamento "${item.method}" não tem mapeamento para o sistema antigo: o pagamento não foi espelhado.`);
  return c;
}
const dia = (v, rotulo) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v} 00:00:00` : `${dataDoLegado(v, rotulo).slice(0, 10)} 00:00:00`);
function limpar(v, max, rotulo) {
  const t = String(v ?? '');
  // eslint-disable-next-line no-control-regex
  if (/[\u{10000}-\u{10FFFF}]/u.test(t) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(t)) throw new MapeamentoError(`${rotulo}: caractere que a coluna do sistema antigo não aceita (emoji ou controle).`);
  if (Array.from(t).length > max) throw new MapeamentoError(`${rotulo}: acima de ${max} caracteres (não é cortado).`);
  return t;
}

/** `item` = `PaymentRecord` do front (já refeito pelo servidor); `ator` = nome de quem lança. Devolve as colunas do INSERT. */
function linhaDoPagamento(item, ator) {
  const idUsuario = Number(item.clientId);
  if (!Number.isInteger(idUsuario) || idUsuario < 1 || idUsuario > 2147483647) throw new MapeamentoError('Cliente fora do intervalo do legado.');
  if (item.status === 'Cancelado') throw new MapeamentoError('Pagamento cancelado não é espelhado (o sistema antigo não tem cancelamento; o espelho nunca apaga).');
  const { idFormaPagto, idBanco } = canal(item);
  if (!Number.isFinite(item.amount) || item.amount <= 0 || item.amount > 1e9) throw new MapeamentoError('Valor fora do intervalo aceito.');
  return {
    idUsuario, dtPagtoInformado: dia(item.paidAt || item.informedAt, 'dtPagtoInformado'), vlPagtoInformado: (Math.round(item.amount * 100) / 100).toFixed(2), idBanco,
    autPagtoInformado: limpar(item.authorization, 100, 'autorização'), idFormaPagto,
    obsPagtoInformado: limpar([item.payerName ? `Pagador: ${item.payerName}` : '', item.note || ''].filter(Boolean).join('\n'), 60000, 'observação'),
    nmuAtendente: textoUtf8Basico(ator || '', 25), id_status_pagto: item.confirmation === 'Confirmado' ? STATUS_PAGTO_CONFIRMADO : STATUS_PAGTO_NOVO,
  };
}

/** Catálogos primeiro (id fora deles = linha invisível no ASP). */
async function exigirCatalogos(ex, c) {
  const [p] = await ex.execute(require('./sql').SELECT_FORMA_PAGTO, [c.idFormaPagto]);
  if (!p.length) throw new MapeamentoError(`idFormaPagto ${c.idFormaPagto} não existe em tbl_opcaopagto do legado.`);
  { const [b] = await ex.execute(sql.SELECT_BANCO, [c.idBanco]); if (!b.length) throw new MapeamentoError(`idBanco ${c.idBanco} não existe em tbl_bancos do legado.`); }
  const [s] = await ex.execute(sql.SELECT_STATUS_PAGTO, [c.id_status_pagto]);
  if (!s.length) throw new MapeamentoError(`id_status_pagto ${c.id_status_pagto} não existe em status_pagamento do legado.`);
}

async function inserir(ex, colunas) {
  await exigirCatalogos(ex, colunas);
  const [r] = await ex.execute(sql.INSERT_PAGTO, sql.COLUNAS_PAGTO.map((c) => colunas[c]));
  if (r && r.insertId) return String(r.insertId);
  throw new Error('o legado não devolveu o id do pagamento');
}

/** Confirma (`id_status_pagto` = 2) na linha da cliente. Devolve as linhas mudadas (0 = já confirmada ou não é desta cliente). */
async function confirmar(ex, idLegado, idUsuario) {
  const [r] = await ex.execute(sql.UPDATE_PAGTO_CONFIRMA, [STATUS_PAGTO_CONFIRMADO, Number(idLegado), Number(idUsuario), STATUS_PAGTO_CONFIRMADO]);
  return Number(r && r.affectedRows) || 0;
}
async function ler(ex, idLegado) { const [l] = await ex.execute(sql.SELECT_PAGTO, [Number(idLegado)]); return l[0] || null; }

module.exports = { linhaDoPagamento, inserir, confirmar, ler };
