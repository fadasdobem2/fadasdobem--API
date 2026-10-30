'use strict';

/**
 * Porte de features/shared/real-page.ts (suspiro): páginas de 500 itens fatiadas em memória (os totais cobrem o
 * recorte inteiro, por isso a página é fatia do resultado já conciliado).
 */

const REAL_PAGE_SIZE = 500;

/** Lançada para página além da última; a rota responde 400 INVALID_INPUT. */
class PageOutOfRange extends Error {
  constructor(page, totalPages) {
    super(`Página ${page} fora do intervalo; há ${totalPages} página(s).`);
    this.name = 'PageOutOfRange';
  }
}

function pageSpan(info, shown) {
  const pages = Math.max(1, Math.ceil(info.totalItems / info.size));
  const from = (info.number - 1) * info.size + 1;
  return { pages, from, to: from + shown - 1 };
}

/** Números de uma página de `totalItems`, ou PageOutOfRange além da última. A página 1 vale sempre, mesmo com zero itens. */
function pageInfo(page, size, totalItems) {
  const info = { number: page, size, totalItems };
  const { pages } = pageSpan(info, 0);
  if (!Number.isInteger(page) || page < 1 || page > pages) throw new PageOutOfRange(page, pages);
  return info;
}

function paginate(items, page, size = REAL_PAGE_SIZE) {
  const info = pageInfo(page, size, items.length);
  const from = (page - 1) * size;
  return { items: items.slice(from, from + size), page: info };
}

module.exports = { REAL_PAGE_SIZE, PageOutOfRange, pageSpan, pageInfo, paginate };
