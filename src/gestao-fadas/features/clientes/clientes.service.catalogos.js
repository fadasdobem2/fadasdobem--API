'use strict';

/** Catálogos de referência e rótulos (fatia de clientes.service.js; leitura SOMENTE LEITURA do legado). */


// --- catálogos -------------------------------------------------------------------------------------------

/**
 * Rótulos dos catálogos de referência (R21): cpf_status e paises vêm de um RETRATO versionado
 * (`src/gestao-fadas/fontes/reference-catalogs.json`, copiado do repositório do suspiro), não do banco, como na API B
 * (features/integration/legacy-reference-catalogs.ts). Assim a leitura não depende dessas tabelas existirem no ambiente.
 */
let catalogosRetrato = null;
async function lerCatalogosReferencia() {
  if (!catalogosRetrato) {
    const t = require('../../fontes/reference-catalogs.json').tables;
    catalogosRetrato = {
      cpf_status: Object.fromEntries(t.cpf_status.map((l) => [String(l.idStatus), l.nomeStatus])),
      paises: Object.fromEntries(t.paises.map((l) => [String(l.ID), l.Paises])),
    };
  }
  return catalogosRetrato;
}

/** Rótulos de canal, opção de pagamento e banco (CHANNELS, PAYMENT_OPTIONS, BANKS). */
async function lerCatalogosRotulos(m) {
  const [canais, opcoes, bancos] = await Promise.all([
    m.LegadoFormaConsulta.findAll({ attributes: ['idFormaConsulta', 'tpFormaConsulta'], raw: true }),
    m.LegadoOpcaoPagamento.findAll({ attributes: ['idOpcaoPagto', 'tpOpcaoPagto'], raw: true }),
    m.LegadoBanco.findAll({ attributes: ['idBanco', 'nmBanco'], raw: true }),
  ]);
  return {
    channels: Object.fromEntries(canais.map((l) => [String(l.idFormaConsulta), l.tpFormaConsulta])),
    paymentOptions: Object.fromEntries(opcoes.map((l) => [String(l.idOpcaoPagto), l.tpOpcaoPagto])),
    banks: Object.fromEntries(bancos.map((l) => [String(l.idBanco), l.nmBanco])),
  };
}

module.exports = {
  lerCatalogosReferencia,
  lerCatalogosRotulos,
};
