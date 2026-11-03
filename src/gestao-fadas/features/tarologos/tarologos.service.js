'use strict';

const AppError = require('../../../utils/AppError');
const { lendo } = require('../../_comum/legado');
const { idLegado } = require('../../_comum/validacao');
const { COLUNAS, paraDto, paraExtensao } = require('./tarologos.model');
const { novosDadosNoPostgres } = require('../../novo/modo');
const { modelosNovos } = require('../../novo/leitura');
const { ehPerfilDeSistema } = require('../../_comum/dominio/catalogo-tarologos');

/**
 * Tarólogos = `tbl_tarologos` (legado, somente leitura). Equivale a `GET /api/operations/tarologists` da B:
 * `[{ id, name, active }]`, INATIVOS INCLUÍDOS, ordenado por `nmuTarologo, idTarologo` (lista de filtro).
 *
 * Extensão da A (não existe na B): com `incluir=extensao` cada item ganha o campo `extensao`
 * (`gf_tarologos_ext`), separado do DTO. Sem o parâmetro o DTO é exatamente o da B.
 *
 * Onda 2 (E1.1): perfis de SISTEMA (hoje o 347 "AFila", `PERFIS_DE_SISTEMA`) ficam fora da lista, como no catálogo; inativos continuam (A pagar precisa deles).
 */
const querComExtensao = (query) => `${(query && query.incluir) || ''}`.split(',').map((s) => s.trim()).includes('extensao');

/** Banco novo: a extensão vive no Postgres e o tarólogo no MySQL (não há JOIN entre bancos): leitura à parte, ligada por `id_tarologo`. */
async function extensoesDoBancoNovo(ids) {
  if (!ids.length) return new Map();
  const { Op } = require('sequelize');
  const linhas = await modelosNovos().GfTarologosExt.findAll({ where: { id_tarologo: { [Op.in]: ids } }, raw: true });
  return new Map(linhas.map((l) => [Number(l.id_tarologo), l]));
}

function montar(linha, comExtensao, extensoes = null) {
  const plano = linha.get({ plain: true });
  if (extensoes) plano.extensao = extensoes.get(Number(plano.idTarologo)) || null;
  const dto = paraDto(plano);
  return comExtensao ? { ...dto, extensao: paraExtensao(plano.extensao) } : dto;
}

async function listar(query = {}) {
  const comExtensao = querComExtensao(query);
  return lendo(async (m) => {
    const linhas = await m.LegadoTarologo.findAll({
      attributes: COLUNAS,
      include: comExtensao && !novosDadosNoPostgres() ? [{ model: m.GfTarologosExt, as: 'extensao', required: false }] : [],
      order: [['nmuTarologo', 'ASC'], ['idTarologo', 'ASC']],
    });
    const extensoes = comExtensao && novosDadosNoPostgres() ? await extensoesDoBancoNovo(linhas.map((l) => Number(l.idTarologo))) : null;
    return linhas.filter((l) => !ehPerfilDeSistema(l)).map((l) => montar(l, comExtensao, extensoes));
  });
}

async function obter(idTexto, query = {}) {
  const id = idLegado(idTexto, 'id');
  const comExtensao = querComExtensao(query);
  return lendo(async (m) => {
    const l = await m.LegadoTarologo.findOne({
      attributes: COLUNAS,
      where: { idTarologo: id },
      include: comExtensao && !novosDadosNoPostgres() ? [{ model: m.GfTarologosExt, as: 'extensao', required: false }] : [],
    });
    if (!l) throw new AppError('Tarólogo não encontrado.', 404, { codigo: 'TAROLOGO_NAO_ENCONTRADO' });
    const extensoes = comExtensao && novosDadosNoPostgres() ? await extensoesDoBancoNovo([Number(l.idTarologo)]) : null;
    return montar(l, comExtensao, extensoes);
  });
}

module.exports = { listar, obter };
