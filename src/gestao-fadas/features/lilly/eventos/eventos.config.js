'use strict';

/** Ambiente do `events/resolve`, lido na hora da chamada: organização da Umbler, equipe autorizada, contas da Lilly. Nunca vem do texto nem do webhook. */

const lista = (valor) => new Set(`${valor || ''}`.split(',').map((s) => s.trim()).filter(Boolean));

/** `UMBLER_ORGANIZATION_ID`: a organização esperada. Vazia = não dá para verificar (falha fechada). */
const organizacaoEsperada = (env = process.env) => `${env.UMBLER_ORGANIZATION_ID || ''}`.trim();
/** `LILLY_STAFF_AUTORIZADA`: ids de membro (Umbler) das atendentes que podem comandar a Lilly, separados por vírgula. */
const equipeAutorizada = (env = process.env) => lista(env.LILLY_STAFF_AUTORIZADA);
/** `LILLY_UMBLER_MEMBER_IDS` (opcional): ids de membro que são a própria conta da Lilly. */
const contasDaLilly = (env = process.env) => lista(env.LILLY_UMBLER_MEMBER_IDS);

module.exports = { organizacaoEsperada, equipeAutorizada, contasDaLilly };
