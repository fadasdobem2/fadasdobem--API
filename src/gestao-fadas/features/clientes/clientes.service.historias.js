'use strict';

/** Cadastro e histórias (consultas e recebimentos) dos clientes dados (fatia de clientes.service.js; leitura SOMENTE LEITURA do legado). */

const { readLegacyConsultation } = require('./helpers/consultas');
const { INFORMED_TABLE, CONFIRMED_TABLE, NOT_FOUND_TABLE, readLegacyPayment } = require('./helpers/recebimentos');
const { COLUNAS_CLIENTE, COLUNAS_CONSULTA, COLUNAS_PAGAMENTO, COLUNAS_INFORMADO, emLotes, modelosDePagamento, numericIds } = require('./clientes.service.comum');
const { lerCatalogosRotulos } = require('./clientes.service.catalogos');

// --- cadastro e histórias --------------------------------------------------------------------------------

/** Linhas de cadastro (lista branca R18) de clientes nivel = 0. */
function lerCadastros(m, ids) {
  return emLotes(ids, (lote) => m.LegadoUsuario.findAll({ attributes: COLUNAS_CLIENTE, where: { nivel: 0, id: lote }, raw: true }));
}

/**
 * Toda consulta e todo recebimento dos clientes dados, pelos leitores de Consultas e Pagamentos (R20), com os gêmeos do
 * outro lado pelo ID, de outra cliente inclusive: a conciliação R5 de uma cliente vê os mesmos pares das leituras por período.
 * `partes` = { consultas, recebimentos }.
 */
async function lerHistorias(m, ids, partes) {
  const vazio = { consultations: [], receipts: { informed: [], confirmed: [], notFound: [] } };
  const unicos = numericIds(ids);
  if (!unicos.length) return vazio;
  const rotulos = await lerCatalogosRotulos(m);
  const modelos = modelosDePagamento(m);
  const incluirCliente = [{ model: m.LegadoUsuario, as: 'cliente', attributes: ['nome_id'], required: false }];
  const plano = (linha) => (linha.get ? linha.get({ plain: true }) : linha);

  const consultas = async () => {
    const linhas = await emLotes(unicos, (lote) => m.LegadoConsulta.findAll({
      attributes: COLUNAS_CONSULTA,
      where: { idUsuario: lote },
      include: [...incluirCliente, { model: m.LegadoTarologo, as: 'tarologo', attributes: ['nmuTarologo'], required: false }],
    }));
    return linhas.map(plano).map((l) => readLegacyConsultation({ ...l, nome_id: l.cliente?.nome_id ?? null, nmuTarologo: l.tarologo?.nmuTarologo ?? null }, rotulos));
  };

  const doModelo = (Modelo, colunas, filtro) => Modelo.findAll({ attributes: colunas, where: filtro, include: incluirCliente });
  const recebimentos = async () => {
    const proprios = {
      informed: await emLotes(unicos, (lote) => doModelo(modelos[INFORMED_TABLE], COLUNAS_INFORMADO, { idUsuario: lote })),
      confirmed: await emLotes(unicos, (lote) => doModelo(modelos[CONFIRMED_TABLE], COLUNAS_PAGAMENTO, { idUsuario: lote })),
      notFound: await emLotes(unicos, (lote) => doModelo(modelos[NOT_FOUND_TABLE], COLUNAS_PAGAMENTO, { idUsuario: lote })),
    };
    const idsInformados = proprios.informed.map((l) => l.idPagtoInformado);
    const idsConfirmados = proprios.confirmed.map((l) => l.idPagtoInformado);
    // Os gêmeos: informado com par confirmado da cliente e confirmado com par informado da cliente (R5, R20).
    const gemeosInformados = await emLotes(idsConfirmados, (lote) => doModelo(modelos[INFORMED_TABLE], COLUNAS_INFORMADO, { idPagtoInformado: lote }));
    const gemeosConfirmados = await emLotes(idsInformados, (lote) => doModelo(modelos[CONFIRMED_TABLE], COLUNAS_PAGAMENTO, { idPagtoInformado: lote }));
    const unico = (linhas) => [...new Map(linhas.map((l) => [String(l.idPagtoInformado), l])).values()];
    const leitura = (tabela) => (l) => {
      const p = plano(l);
      return readLegacyPayment({ ...p, nome_id: p.cliente?.nome_id ?? null }, tabela, rotulos);
    };
    return {
      informed: unico([...proprios.informed, ...gemeosInformados]).map(leitura(INFORMED_TABLE)),
      confirmed: unico([...proprios.confirmed, ...gemeosConfirmados]).map(leitura(CONFIRMED_TABLE)),
      notFound: proprios.notFound.map(leitura(NOT_FOUND_TABLE)),
    };
  };

  const [consultations, receipts] = await Promise.all([
    partes.consultas ? consultas() : Promise.resolve([]),
    partes.recebimentos ? recebimentos() : Promise.resolve(vazio.receipts),
  ]);
  return { consultations, receipts };
}

module.exports = {
  lerCadastros,
  lerHistorias,
};
