'use strict';

/**
 * Leitura de CLIENTES no legado (SOMENTE LEITURA), fiel à B. Porta da parte de clientes de
 * features/integration/legacy-operations.server.ts (lista, ficha, histórico de consultas e de recebimentos da cliente) e de
 * database/legacy/read-clients.sql / read-consultation-history.sql, reimplementada com Sequelize sobre os models da A.
 *
 * A regra (recorte por perfil, projeção, alcance do histórico, ordenação, busca) está em clientes.model.js; aqui só se
 * lê o banco e se monta a entrada dessa regra. Cliente = `usuarios.nivel = 0` em TODA leitura. Colunas de `usuarios` só
 * as da lista branca R18 (COLUNAS_CLIENTE): o model da A nem tem login/senha. Dinheiro é texto; datas voltam como texto;
 * IDs viajam como texto.
 *
 * Diferença deliberada de implementação (não de regra): a B filtra, ordena e pagina no SQL (statements CLIENT_CUT_PAGE e
 * CLIENT_SEARCH_PAGE, com JSON_TABLE). Aqui o banco só entrega os CANDIDATOS e agregados (MAX por cliente, por Sequelize) e
 * o filtro, a ordenação e a página rodam em memória pela MESMA regra (filterAndSortClients), que na B é a referência
 * contra a qual o SQL foi testado (T096). A história inteira só é lida para os clientes da página (R19).
 *
 * Única gravação: a ampliação do histórico (POST .../history-access) grava em gf_auditoria pela conexão de escrita
 * (models/legado/escrita.js, só gf_*). Ver ampliarHistorico().
 */

const { COLUNAS_CLIENTE } = require('./clientes.service.comum');
const lista = require('./clientes.service.lista');
const historico = require('./clientes.service.historico');

module.exports = {
  COLUNAS_CLIENTE,
  ampliacaoValida: historico.ampliacaoValida,
  ampliarHistorico: historico.ampliarHistorico,
  clienteExiste: historico.clienteExiste,
  historicoDeConsultas: historico.historicoDeConsultas,
  historicoDeRecebimentos: historico.historicoDeRecebimentos,
  listar: lista.listar,
  obter: lista.obter,
};
