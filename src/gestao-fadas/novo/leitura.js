'use strict';

/**
 * Leitura dos models do BANCO NOVO (Postgres da A) com o mesmo formato que o leitor do legado devolvia do MySQL:
 * `timestamp` sem fuso volta como TEXTO `AAAA-MM-DD HH:MM:SS` (o driver devolveria Date). DATE, NUMERIC e BIGINT já vêm
 * como texto; jsonb vem como objeto. Só as colunas de relógio de parede abaixo são convertidas.
 * `lendoNovo(fn)` entrega `fn(m)` com os models do modo ativo: do banco novo (padrão) ou os do legado (`GF_NOVOS_DADOS=mysql`).
 */

const { novosDadosNoPostgres } = require('./modo');

const RELOGIO = new Set(['vigente_desde', 'quitado_ate', 'corte_migracao']);
const dois = (n) => String(n).padStart(2, '0');

/** O driver lê `timestamp` como hora LOCAL do processo: os getters locais devolvem exatamente o texto gravado. */
function relogioTexto(d) {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())} ${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}`;
}

function normalizar(linha) {
  const plana = linha && typeof linha.get === 'function' ? linha.get({ plain: true }) : linha;
  if (!plana) return plana;
  for (const campo of RELOGIO) if (plana[campo] instanceof Date) plana[campo] = relogioTexto(plana[campo]);
  return plana;
}

function envolver(model) {
  return {
    findAll: async (opcoes) => (await model.findAll(opcoes)).map(normalizar),
    findOne: async (opcoes) => normalizar(await model.findOne(opcoes)),
    count: (opcoes) => model.count(opcoes),
  };
}

/** `{ GfRepasseAberturas, ... }` do banco novo, com leitura em texto. */
function modelosNovos() {
  const { sequelize } = require('../../config/database');
  require('../../models'); // registra os models do módulo na conexão principal
  const saida = {};
  for (const [nome, model] of Object.entries(sequelize.models)) if (/^Gf/.test(nome)) saida[nome] = envolver(model);
  return saida;
}

/** Como `lendo` (_comum/legado.js), mas no modo postgres lê do banco novo. */
async function lendoNovo(fn) {
  if (!novosDadosNoPostgres()) return require('../_comum/legado').lendo(fn);
  try {
    return await fn(modelosNovos());
  } catch (erro) {
    throw require('../_comum/legado').traduzirErro(erro);
  }
}

module.exports = { lendoNovo, modelosNovos, normalizar, relogioTexto };
