'use strict';

/**
 * Porte de `features/shared/real-text.ts` (suspiro/B): as palavras de uma célula que as telas reais e as
 * planilhas compartilham. Puro. Nomes e textos da B preservados.
 */

const NOT_INFORMED = 'não informado';

const countText = (value) => value.toLocaleString('pt-BR');
const plural = (value, one, many) => `${countText(value)} ${value === 1 ? one : many}`;
const dayMonth = (day) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
/** HH:mm de um texto de relógio de São Paulo (AAAA-MM-DDTHH:mm:ss). */
const hourMinute = (local) => local.slice(11, 16);
/** Valor de catálogo do legado: o rótulo, ou o código quando o catálogo não o tem. */
const catalogText = (value) => value.label ?? (value.code === null ? null : `código ${value.code}`);

module.exports = { NOT_INFORMED, countText, plural, dayMonth, hourMinute, catalogText };
