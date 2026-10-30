'use strict';

/**
 * Fonte da pendência `addition:` (Maturacao/43): o armazém de Adicionais guardado e os nomes das profissionais (o front mostra o nome do perfil, senão o id).
 * Só existe com `GF_FATIA_ESTADO_FINANCEIRO=true` (o front só deriva `addition:` do armazém que o servidor entrega). Sem o catálogo de tarólogos
 * (legado fora do ar) não há nome fiel e a derivação não roda: vale só a conferência de forma e de filas.
 */

const adicionais = require('./adicionais.service');
const loja = require('./adicionais.store');

const ligada = (env = process.env) => `${env.GF_FATIA_ESTADO_FINANCEIRO || ''}`.trim().toLowerCase() === 'true';

/** `m`: models do banco novo. Devolve `{ loja, nomes }` ou `undefined` (fatia desligada ou sem catálogo). */
async function lerParaPendencias(m) {
  if (!ligada()) return undefined;
  let tarologos;
  try { tarologos = await adicionais.tarologos(); } catch (_e) { return undefined; }
  const linhas = await m.GfAdicionaisItens.findAll({ order: [['criado_em', 'ASC'], ['chave', 'ASC']] });
  return { loja: loja.montar(linhas).loja, nomes: new Map(tarologos.map((t) => [t.id, t.name])) };
}

module.exports = { lerParaPendencias, ligada };
