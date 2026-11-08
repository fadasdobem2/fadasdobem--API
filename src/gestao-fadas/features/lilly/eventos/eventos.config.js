'use strict';

/** Ambiente do `events/resolve`, lido na hora da chamada: organização da Umbler, equipe autorizada, contas da Lilly. Nunca vem do texto nem do webhook. */

const lista = (valor) => new Set(`${valor || ''}`.split(',').map((s) => s.trim()).filter(Boolean));

/** `UMBLER_ORGANIZATION_ID`: a organização esperada. Vazia = não dá para verificar (falha fechada). */
const organizacaoEsperada = (env = process.env) => `${env.UMBLER_ORGANIZATION_ID || ''}`.trim();
/** `LILLY_STAFF_AUTORIZADA`: ids de membro (Umbler) das atendentes que podem comandar a Lilly, separados por vírgula. */
const equipeAutorizada = (env = process.env) => lista(env.LILLY_STAFF_AUTORIZADA);
/** `LILLY_UMBLER_MEMBER_IDS` (opcional): ids de membro que são a própria conta da Lilly. */
const contasDaLilly = (env = process.env) => lista(env.LILLY_UMBLER_MEMBER_IDS);

/**
 * `LILLY_STAFF_TODOS_AUTORIZAM`: DECISÃO DA NICE (v708) = TODOS os atendentes (membros nativos, online) podem autorizar comandos da Lilly. Padrão `true`.
 * Com `false` volta a valer só a lista `LILLY_STAFF_AUTORIZADA`.
 */
const todosAutorizam = (env = process.env) => `${env.LILLY_STAFF_TODOS_AUTORIZAM || ''}`.trim().toLowerCase() !== 'false';

module.exports = { organizacaoEsperada, equipeAutorizada, contasDaLilly, todosAutorizam };
