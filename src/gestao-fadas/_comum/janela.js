'use strict';

/**
 * Janela opcional das listas (Maturacao/35): `?limit=<1..1000>` e `?after=<id da última linha já recebida>`. SEM `limit` nada muda (a lista
 * inteira, como o front atual consome, e sem `nextCursor`). COM `limit` a lista vem na mesma ordem, cortada, e `nextCursor` traz o `id` a
 * mandar em `after` (ou `null` no fim). `after` que não existe mais volta ao começo da janela seguinte pela ordem (id desconhecido = 400).
 */

const AppError = require('../../utils/AppError');

const MAXIMO = 1000;
const invalido = (campo) => new AppError(`Parâmetro inválido: ${campo}.`, 400, { codigo: 'INVALID_INPUT' }, true);

/** Lê `limit` e `after` da query. `null` quando não há janela pedida. */
function ler(query = {}) {
  if (query.limit === undefined && query.after === undefined) return null;
  const limite = query.limit === undefined ? MAXIMO : Number(query.limit);
  if (typeof query.limit === 'string' && !/^[1-9]\d{0,3}$/.test(query.limit)) throw invalido('limit');
  if (query.limit !== undefined && (!Number.isInteger(limite) || limite < 1 || limite > MAXIMO)) throw invalido('limit');
  if (query.after !== undefined && (typeof query.after !== 'string' || !query.after || query.after.length > 300)) throw invalido('after');
  return { limite, depois: query.after };
}

/** Corta `itens` (já na ordem da resposta). `chave(item)` é o id da linha. Devolve `{ itens, nextCursor? }`. */
function fatiar(itens, janela, chave = (x) => x.id) {
  if (!janela) return { itens };
  let inicio = 0;
  if (janela.depois !== undefined) {
    const i = itens.findIndex((x) => chave(x) === janela.depois);
    if (i < 0) throw invalido('after');
    inicio = i + 1;
  }
  const pagina = itens.slice(inicio, inicio + janela.limite);
  const maisAlem = inicio + janela.limite < itens.length;
  return { itens: pagina, nextCursor: maisAlem && pagina.length ? chave(pagina[pagina.length - 1]) : null };
}

module.exports = { ler, fatiar, MAXIMO };
