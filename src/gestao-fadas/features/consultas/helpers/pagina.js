'use strict';

/** Porte de `features/shared/real-page.ts` (B). A página de consultas tem 500 itens. */

const TAMANHO_PAGINA_REAL = 500;

/** Lançado para página além da última; a rota responde 400 INVALID_INPUT. */
class PaginaForaDoIntervalo extends Error {
  constructor(pagina, totalPaginas) {
    super(`Página ${pagina} fora do intervalo; há ${totalPaginas} página(s).`);
    this.name = 'PageOutOfRange';
  }
}

/** Quantas páginas a lista tem (pelo menos uma) e as posições, a partir de 1, dos `exibidos` itens desta página. */
function intervaloDaPagina(info, exibidos) {
  const paginas = Math.max(1, Math.ceil(info.totalItems / info.size));
  const de = (info.number - 1) * info.size + 1;
  return { pages: paginas, from: de, to: de + exibidos - 1 };
}

/** Os números de uma página de `totalItems`, ou PaginaForaDoIntervalo além da última. A página 1 é sempre válida, mesmo vazia. */
function infoDaPagina(pagina, tamanho, totalItems) {
  const info = { number: pagina, size: tamanho, totalItems };
  const { pages } = intervaloDaPagina(info, 0);
  if (!Number.isInteger(pagina) || pagina < 1 || pagina > pages) throw new PaginaForaDoIntervalo(pagina, pages);
  return info;
}

/** Uma página dos itens, como `infoDaPagina` confere. */
function paginar(itens, pagina, tamanho = TAMANHO_PAGINA_REAL) {
  const info = infoDaPagina(pagina, tamanho, itens.length);
  const de = (pagina - 1) * tamanho;
  return { items: itens.slice(de, de + tamanho), page: info };
}

module.exports = { TAMANHO_PAGINA_REAL, PaginaForaDoIntervalo, intervaloDaPagina, infoDaPagina, paginar };
