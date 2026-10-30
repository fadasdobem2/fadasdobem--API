'use strict';

/**
 * Porte de `features/shared/real-page.ts` (suspiro/B). Diferente de `validacao.paginacao` (que corrige a página e o
 * limite em silêncio), aqui uma página FORA do intervalo é erro: 400 INVALID_INPUT, como na B.
 * Nomes e constantes da B preservados.
 */

const AppError = require('../../utils/AppError');

const REAL_PAGE_SIZE = 500;
const PAGE_RE = /^[1-9]\d*$/;

/** Página além da última (PageOutOfRange da B): o controller responde 400 INVALID_INPUT. */
class PageOutOfRange extends AppError {
  constructor(page, totalPages) {
    super(`Página ${page} fora do intervalo; há ${totalPages} página(s).`, 400, { codigo: 'INVALID_INPUT' }, true);
    this.name = 'PageOutOfRange';
  }
}

/** Quantas páginas uma lista tem (pelo menos uma) e as posições, a partir de 1, dos `shown` itens desta página. */
function pageSpan(info, shown) {
  const pages = Math.max(1, Math.ceil(info.totalItems / info.size));
  const from = (info.number - 1) * info.size + 1;
  return { pages, from, to: from + shown - 1 };
}

/** Os números de uma página de `totalItems`, ou PageOutOfRange além da última. A página 1 é sempre válida, mesmo com zero itens. */
function pageInfo(page, size, totalItems) {
  const info = { number: page, size, totalItems };
  const { pages } = pageSpan(info, 0);
  if (!Number.isInteger(page) || page < 1 || page > pages) throw new PageOutOfRange(page, pages);
  return info;
}

/** Uma página dos itens, como `pageInfo` a confere. */
function paginate(items, page, size = REAL_PAGE_SIZE) {
  const info = pageInfo(page, size, items.length);
  const from = (page - 1) * size;
  return { items: items.slice(from, from + size), page: info };
}

/**
 * Parâmetro `page` (PAGE da B): só dígitos, a partir de 1, inteiro seguro; ausente = 1. Inválido: null (a B trata
 * query inválida como INVALID_INPUT); quem chama decide lançar `erroOperacao('INVALID_INPUT')`.
 */
function parsePage(valor) {
  if (valor === undefined) return 1;
  if (typeof valor !== 'string' || !PAGE_RE.test(valor)) return null;
  const n = Number(valor);
  return Number.isSafeInteger(n) ? n : null;
}

module.exports = { REAL_PAGE_SIZE, PageOutOfRange, pageSpan, pageInfo, paginate, parsePage };
