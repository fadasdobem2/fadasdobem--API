'use strict';

/** As operações públicas de lista e ficha (fatia de clientes.service.js; leitura SOMENTE LEITURA do legado). */

const { lendo } = require('../../_comum/legado');
const model = require('./clientes.model');
const { clientRolePolicy } = require('./helpers/perfis');
const extensao = require('./helpers/extensao');
const { maior } = require('./clientes.service.comum');
const { lerCatalogosReferencia } = require('./clientes.service.catalogos');
const { lerCadastros, lerHistorias } = require('./clientes.service.historias');
const { clientesJaConsultados, consultasDeHoje, contagensDeData, movimentosGerais, movimentosNoRecorte } = require('./clientes.service.agregados');
const { acrescentarEditadas, candidatosDaBusca } = require('./clientes.service.busca');
const novas = require('./cliente-novo.leitura');
const { shiftDateKey } = require('./helpers/valores');
const { ehIdDaFaixaNova } = require('../../_comum/dominio/cliente-faixa-nova');

// --- operações públicas ----------------------------------------------------------------------------------

/**
 * A lista de um plano que o perfil pode pedir (planRealClientList). `plano` vem do model; página além da última é
 * PageOutOfRange (400), antes de ler qualquer história.
 */
async function listar(plano) {
  return lendo(async (m) => {
    const { today } = plano;
    let linhas;
    let rangeAt = new Map();
    if (plano.searching) {
      linhas = await candidatosDaBusca(m, plano.search, plano.role);
    } else {
      rangeAt = await movimentosNoRecorte(m, plano.range);
      linhas = await lerCadastros(m, [...rangeAt.keys()]);
    }
    // Ficha editada (Maturacao/36, só com GF_FATIA_FICHA): a busca também acha o nome editado e a lista mostra o cadastro como a ficha o mostra.
    if (extensao.ativa()) {
      if (plano.searching) linhas = await acrescentarEditadas(m, linhas, plano);
      linhas = await extensao.sobreporTodas(linhas);
    }
    // Clientes criadas pela Lilly no banco novo: somadas ao que veio do legado, pela mesma regra (a edição da ficha já está por cima delas).
    let somadas = { criadoAt: new Map(), novas: [] };
    if (novas.ativa()) { somadas = await novas.somarNovas(linhas, plano, rangeAt); linhas = somadas.linhas; }
    const registros = model.recordsOf(linhas);
    const ids = [...registros.keys()];
    // A busca lê a história inteira; o recorte só precisa dela para ordenar por última consulta ou último pagamento.
    const precisaGerais = plano.searching || plano.sort === 'lastConsultation' || plano.sort === 'lastPayment';
    const { consultaAt, recebAt } = precisaGerais ? await movimentosGerais(m, ids) : { consultaAt: new Map(), recebAt: new Map() };
    const latest = (id, range, kind) => {
      if (kind === 'consultation') return consultaAt.get(id) ?? null;
      if (kind === 'receipt') return recebAt.get(id) ?? null;
      return range ? rangeAt.get(id) ?? null : maior(maior(consultaAt.get(id), recebAt.get(id)), somadas.criadoAt.get(id));
    };
    const precisaAgora = (!plano.searching && plano.scope === 'live') || plano.situation === 'consulta';
    const agora = precisaAgora ? model.consultingNow(await consultasDeHoje(m, today), plano.nowLocal) : new Set();
    const consultados = plano.situation === 'nunca' ? await clientesJaConsultados(m, ids) : new Set();

    const listados = model.filterAndSortClients(plano, registros, latest, agora, consultados);
    const totalItems = listados.length;
    // Antes de ler qualquer história: página além da última é 400 (PageOutOfRange).
    model.realClientListPageInfo(plano, totalItems);
    const inicio = (plano.page - 1) * plano.pageSize;
    const clientIds = listados.slice(inicio, inicio + plano.pageSize).map((item) => item.record.id);
    const contagensLegado = clientRolePolicy(plano.role).canSeeDateCounts && !plano.searching ? await contagensDeData(m, today) : undefined;
    const contagens = contagensLegado && somadas.novas.length ? novas.somarContagens(contagensLegado, somadas.novas, today, shiftDateKey) : contagensLegado;

    // O cadastro e a história inteira dos clientes da página somente (R19).
    const historia = await lerHistorias(m, clientIds, { consultas: true, recebimentos: true });
    const fontes = { clients: linhas.filter((l) => clientIds.includes(String(l.id))), ...historia };
    const selecao = model.realClientListSelection(plano, { clientIds, totalItems, ...(contagens ? { dateCounts: contagens } : {}) }, fontes);
    const resultado = model.buildRealClientList(selecao, fontes);
    if (!somadas.novas.length) return resultado;
    const porId = new Map(linhas.map((l) => [String(l.id), l]));
    return { ...resultado, clients: resultado.clients.map((item) => novas.marcar(item, porId.get(item.id), somadas.criadoAt)) };
  });
}

/** A ficha com a projeção do perfil, ou null quando o ID não é cliente (404 CLIENT_NOT_FOUND; conta da equipe é o mesmo 404). */
async function obter({ role, clientId, nowLocal }) {
  // Cliente da faixa nova: só existe no banco novo; o legado nem é consultado (sem histórico antigo, sem catálogos de código).
  if (ehIdDaFaixaNova(`${clientId}`) && novas.ativa()) {
    const [linha] = await novas.lerNovas([clientId]);
    if (!linha) return null;
    const ficha = model.buildRealClientProfile({ role, nowLocal, row: linha, catalogos: model.CATALOGOS_VAZIOS, consultations: [], receipts: { informed: [], confirmed: [], notFound: [] } });
    return ficha ? { ...ficha, client: novas.marcar(ficha.client, linha) } : null;
  }
  return lendo(async (m) => {
    const [linhas, historia, catalogos] = await Promise.all([
      lerCadastros(m, [clientId]), lerHistorias(m, [clientId], { consultas: true, recebimentos: true }), lerCatalogosReferencia(m),
    ]);
    // Com a ficha ligada (GF_FATIA_FICHA), o complemento do banco novo (e-mail, CPF, nome completo, endereço) vence o legado onde está preenchido.
    const [linha] = extensao.ativa() ? await extensao.sobreporTodas(linhas) : linhas;
    return linha ? model.buildRealClientProfile({ role, nowLocal, row: linha, catalogos, ...historia }) : null;
  });
}

module.exports = {
  listar,
  obter,
};
