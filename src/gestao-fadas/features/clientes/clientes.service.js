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

const { Op, fn, col, where, literal } = require('sequelize');
const AppError = require('../../../utils/AppError');
const { lendo } = require('../../_comum/legado');
const { lendoNovo } = require('../../novo/leitura');
const { intervaloDoDia, intervaloDoPeriodo } = require('../../_comum/dia-operacional');
const model = require('./clientes.model');
const { readLegacyConsultation } = require('./helpers/consultas');
const { INFORMED_TABLE, CONFIRMED_TABLE, NOT_FOUND_TABLE, readLegacyPayment } = require('./helpers/recebimentos');
const { clientRolePolicy, permissionsFor } = require('./helpers/perfis');
const { emptyClientSearch, parseClientBirthDate } = require('./helpers/busca');
const { ampliarHistorico: ampliar } = require('./helpers/ampliacao');
const extensao = require('./helpers/extensao');
const {
  legacyLocalDateTime, localOperationalDateKey, normalizeSearch, shiftDateKey,
} = require('./helpers/valores');
const { erro } = require('./clientes.validacao');

/** Colunas de `usuarios` que Clientes lê (R18), como database/legacy/read-clients.sql as nomeia. Sem senha, sem login. */
const COLUNAS_CLIENTE = [
  'id', 'nivel', 'nome_id', 'nome2', 'nome', 'ddd', 'telresidencial', 'telcomercial', 'cel', 'whats', 'email', 'email2',
  'cpf', 'status_cpf_id', 'buscaNaReceita', 'datanascimento', 'horanascimento', 'cidadeNascimento', 'ufNascimento',
  'IDpaisNascimento', 'endereco', 'numero', 'complemento', 'bairro', 'cep', 'cidade', 'estado', 'idPais', 'data_cadastro',
  'saldo', 'valorAPagar', 'id_cliente_valido',
];
/** Colunas de tbl_consultas lidas para a história (CONSULTATIONS_OF_CLIENTS): sem obsConsulta, atendente nem dtManutencao. */
const COLUNAS_CONSULTA = ['idConsulta', 'idUsuario', 'idTarologo', 'iniConsulta', 'fimConsulta', 'tmpConsulta', 'valor_consulta',
  'vlDesconto', 'vlBonus', 'abatimento', 'idFormaConsulta', 'idFormaPagto'];
const COLUNAS_PAGAMENTO = ['idPagtoInformado', 'idUsuario', 'dtPagtoInformado', 'vlPagtoInformado', 'idBanco', 'idFormaPagto'];
const COLUNAS_INFORMADO = [...COLUNAS_PAGAMENTO, 'status', 'id_status_pagto', 'dt_criado'];

const LOTE = 2000;

// --- utilitários -----------------------------------------------------------------------------------------

/**
 * IDs como números para `IN`, cada um uma vez. Só entram IDs legados válidos (inteiro de 1 a 2147483647): um `idUsuario`
 * nulo ou zerado (a documentação do legado avisa que `tbl_pagtonaolocalizado` aceita NULL) nunca é um cliente e, sem
 * este filtro, virava `NaN` no SQL.
 */
const numericIds = (ids) => [...new Set(ids)].map(Number).filter((n) => Number.isSafeInteger(n) && n >= 1 && n <= 2147483647);

async function emLotes(ids, leitor) {
  const unicos = numericIds(ids);
  const saida = [];
  for (let i = 0; i < unicos.length; i += LOTE) saida.push(...await leitor(unicos.slice(i, i + LOTE)));
  return saida;
}

const maior = (a, b) => (a === null || a === undefined ? b ?? null : b === null || b === undefined ? a : a >= b ? a : b);

function agregarMaximo(mapa, linhas, campo) {
  for (const linha of linhas) {
    const em = legacyLocalDateTime(linha[campo]);
    if (em === null) continue;
    if (linha.idUsuario === null || linha.idUsuario === undefined) continue; // sem cliente: não entra no mapa
    const id = String(linha.idUsuario);
    mapa.set(id, maior(mapa.get(id), em));
  }
}

function modelosDePagamento(m) {
  return { [INFORMED_TABLE]: m.LegadoPagamentoInformado, [CONFIRMED_TABLE]: m.LegadoPagamentoConfirmado, [NOT_FOUND_TABLE]: m.LegadoPagamentoNaoLocalizado };
}

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

// --- agregados para a lista (substituem o SQL de CLIENT_CUT_PAGE e CLIENT_SEARCH_PAGE) --------------------

/** Última movimentação de cada cliente DENTRO do recorte: consulta pelo dia operacional, recebimento pela data civil. */
async function movimentosNoRecorte(m, range) {
  const mapa = new Map();
  const { inicio, fim } = intervaloDoPeriodo(range.start, range.end);
  const civil = { [Op.gte]: `${range.start} 00:00:00`, [Op.lt]: `${shiftDateKey(range.end, 1)} 00:00:00` };
  const maximo = (campo) => [[fn('MAX', col(campo)), 'em']];
  const [consultas, ...recibos] = await Promise.all([
    m.LegadoConsulta.findAll({ attributes: ['idUsuario', ...maximo('iniConsulta')], where: { iniConsulta: { [Op.gte]: inicio, [Op.lt]: fim } }, group: ['idUsuario'], raw: true }),
    ...Object.values(modelosDePagamento(m)).map((Modelo) => Modelo.findAll({ attributes: ['idUsuario', ...maximo('dtPagtoInformado')], where: { dtPagtoInformado: civil }, group: ['idUsuario'], raw: true })),
  ]);
  agregarMaximo(mapa, consultas, 'em');
  for (const linhas of recibos) agregarMaximo(mapa, linhas, 'em');
  return mapa;
}

/** Última consulta e último recebimento da história inteira dos clientes dados (latest(id) e as ordenações por data). */
async function movimentosGerais(m, ids) {
  const consultaAt = new Map();
  const recebAt = new Map();
  const maximo = (campo) => [[fn('MAX', col(campo)), 'em']];
  const unicos = numericIds(ids);
  for (let i = 0; i < unicos.length; i += LOTE) {
    const lote = unicos.slice(i, i + LOTE);
    const [consultas, ...recibos] = await Promise.all([
      m.LegadoConsulta.findAll({ attributes: ['idUsuario', ...maximo('iniConsulta')], where: { idUsuario: lote }, group: ['idUsuario'], raw: true }),
      ...Object.values(modelosDePagamento(m)).map((Modelo) => Modelo.findAll({ attributes: ['idUsuario', ...maximo('dtPagtoInformado')], where: { idUsuario: lote }, group: ['idUsuario'], raw: true })),
    ]);
    agregarMaximo(consultaAt, consultas, 'em');
    for (const linhas of recibos) agregarMaximo(recebAt, linhas, 'em');
  }
  return { consultaAt, recebAt };
}

/** IDs (texto) dos clientes dados com alguma consulta no legado, de qualquer data ("nunca consultou" são os outros). */
async function clientesJaConsultados(m, ids) {
  const linhas = await emLotes(ids, (lote) => m.LegadoConsulta.findAll({ attributes: ['idUsuario'], where: { idUsuario: lote }, group: ['idUsuario'], raw: true }));
  return new Set(linhas.map((l) => String(l.idUsuario)));
}

/** Consultas iniciadas no dia operacional de hoje: base de "em consulta agora". */
async function consultasDeHoje(m, today) {
  const { inicio, fim } = intervaloDoDia(today);
  const linhas = await m.LegadoConsulta.findAll({ attributes: COLUNAS_CONSULTA, where: { iniConsulta: { [Op.gte]: inicio, [Op.lt]: fim } }, raw: true });
  return linhas.map((l) => readLegacyConsultation(l));
}

/** Contagens dos controles de data (só administradora, fora da busca): clientes com movimento em Hoje, Ontem e 7 dias. */
async function contagensDeData(m, today) {
  const ate = { start: shiftDateKey(today, -6), end: today };
  const { inicio, fim } = intervaloDoPeriodo(ate.start, ate.end);
  const civil = { [Op.gte]: `${ate.start} 00:00:00`, [Op.lt]: `${shiftDateKey(ate.end, 1)} 00:00:00` };
  const [consultas, ...recibos] = await Promise.all([
    m.LegadoConsulta.findAll({ attributes: ['idUsuario', 'iniConsulta'], where: { iniConsulta: { [Op.gte]: inicio, [Op.lt]: fim } }, raw: true }),
    ...Object.values(modelosDePagamento(m)).map((Modelo) => Modelo.findAll({ attributes: ['idUsuario', 'dtPagtoInformado'], where: { dtPagtoInformado: civil }, raw: true })),
  ]);
  const movimentos = [];
  for (const l of consultas) {
    const em = legacyLocalDateTime(l.iniConsulta);
    if (em) movimentos.push({ id: String(l.idUsuario), dia: localOperationalDateKey(em) });
  }
  for (const linhas of recibos) {
    for (const l of linhas) {
      const em = legacyLocalDateTime(l.dtPagtoInformado);
      if (em) movimentos.push({ id: String(l.idUsuario), dia: em.slice(0, 10) });
    }
  }
  const clientes = new Set((await emLotes(movimentos.map((x) => x.id), (lote) => m.LegadoUsuario.findAll({ attributes: ['id'], where: { nivel: 0, id: lote }, raw: true }))).map((l) => String(l.id)));
  const contar = (de, ateDia) => new Set(movimentos.filter((x) => clientes.has(x.id) && x.dia >= de && x.dia <= ateDia).map((x) => x.id)).size;
  return { hoje: contar(today, today), ontem: contar(shiftDateKey(today, -1), shiftDateKey(today, -1)), '7dias': contar(ate.start, ate.end) };
}

// --- a busca (pré-filtros "mais e nunca menos"; a regra da v608 decide em memória, R19) ----------------------

// usuarios é utf8 de 3 bytes: um caractere além disso não está em nenhum cadastro, então o texto não casa com nada.
const FORA_DO_UTF8_3 = /[\u{10000}-\u{10FFFF}]/u;
const textoDeBusca = (texto) => normalizeSearch(texto).trim().replace(/\s+/g, ' ');
const contendo = (texto) => (FORA_DO_UTF8_3.test(texto) ? null : `%${texto.replace(/[\\%_]/g, '\\$&')}%`);
const EXPRESSAO_EMAILS = "TRIM(REGEXP_REPLACE(CONCAT_WS(' ', email, email2), '[[:space:]]+', ' '))";
const semMarcacao = (expressao) => `REGEXP_REPLACE(${expressao}, '[^0-9]', '')`;

function filtroDeTelefone(like, id) {
  const como = (expressao) => where(literal(semMarcacao(expressao)), { [Op.like]: like });
  return {
    [Op.or]: [
      ...(id === null ? [] : [{ id: Number(id) }]),
      como('CONCAT(ddd, telresidencial)'),
      como('CONCAT(ddd, telcomercial)'),
      como('CONCAT(ddd, cel COLLATE utf8_unicode_ci)'),
      como('whats'),
    ],
  };
}

/**
 * IDs que um ID, um telefone ou um nascimento permitem: o pré-filtro traz mais e nunca menos; as funções da v608 decidem.
 * Retorna os cadastros brutos do pré-filtro (ou null quando não há o que consultar).
 */
async function preFiltro(m, tipo, valor, id = null) {
  const base = { nivel: 0 };
  if (tipo === 'id') {
    if (!/^\d+$/.test(valor)) return null;
    return m.LegadoUsuario.findAll({ attributes: COLUNAS_CLIENTE, where: { ...base, id: Number(valor) }, raw: true });
  }
  if (tipo === 'telefone') {
    const digitos = valor.replace(/\D/g, '').slice(-8);
    if (!digitos) return id === null ? null : preFiltro(m, 'id', id);
    return m.LegadoUsuario.findAll({ attributes: COLUNAS_CLIENTE, where: { [Op.and]: [base, filtroDeTelefone(`%${digitos}%`, id)] }, raw: true });
  }
  const nascimento = parseClientBirthDate(valor);
  if (!nascimento) return null;
  const condicoes = [base, where(fn('DAYOFMONTH', col('datanascimento')), nascimento.day), where(fn('MONTH', col('datanascimento')), nascimento.month)];
  if (nascimento.year !== undefined) condicoes.push(where(fn('YEAR', col('datanascimento')), nascimento.year));
  return m.LegadoUsuario.findAll({ attributes: COLUNAS_CLIENTE, where: { [Op.and]: condicoes }, raw: true });
}

/** Os cadastros que a busca do plano pode achar (pré-filtros + cláusulas de texto), ainda sem a regra final da v608. */
async function candidatosDaBusca(m, search, role) {
  const consultas = [];
  const texto = [];
  const permitir = (campo, valor, pesquisa) => {
    consultas.push(pesquisa.then((linhas) => (linhas === null ? [] : linhas.flatMap((linha) => (model.realClientMatches(linha, { ...emptyClientSearch(), [campo]: valor }, role) ? [String(linha.id)] : [])))));
  };
  const termos = (valor, nosEmails) => {
    const inteiro = textoDeBusca(valor);
    const email = nosEmails ? contendo(inteiro) : null;
    for (const termo of inteiro.split(' ')) texto.push({ term: contendo(termo), email });
  };
  const campo = (chave) => search[chave].trim();
  const consulta = campo('query');
  // A assistente busca só pelo ID exato, que a v608 lê do campo único.
  if (role === 'assistente') {
    if (consulta) permitir('query', search.query, preFiltro(m, 'id', consulta));
  } else {
    // A busca simples, como clientMatchesSearch a lê: uma data, um ID ou telefone, ou um nome ou e-mail.
    if (consulta && /[/.\-]/.test(consulta) && parseClientBirthDate(consulta)) permitir('query', search.query, preFiltro(m, 'nascimento', consulta));
    else if (consulta && /^[\d\s().+-]+$/.test(consulta)) permitir('query', search.query, preFiltro(m, 'telefone', consulta, /^\d+$/.test(consulta) ? consulta : null));
    else if (consulta) termos(consulta, true);
    if (campo('id')) permitir('id', search.id, preFiltro(m, 'id', campo('id')));
    if (campo('name')) termos(search.name, false);
    if (campo('phone')) permitir('phone', search.phone, preFiltro(m, 'telefone', search.phone));
    if (campo('email')) texto.push({ term: null, email: contendo(textoDeBusca(search.email)) });
    if (campo('birthDate')) permitir('birthDate', search.birthDate, preFiltro(m, 'nascimento', search.birthDate));
  }
  // Nada pode casar: texto além do utf8 de 3 bytes.
  if (texto.some((clausula) => clausula.term === null && clausula.email === null)) return [];
  let ids = null;
  for (const permitidos of await Promise.all(consultas)) ids = ids === null ? permitidos : ids.filter((id) => permitidos.includes(id));
  if (ids !== null && ids.length === 0) return [];

  const condicoes = [{ nivel: 0 }];
  if (ids !== null) condicoes.push({ id: numericIds(ids) });
  for (const clausula of texto) {
    condicoes.push({
      [Op.or]: [
        ...(clausula.term === null ? [] : [{ nome_id: { [Op.like]: clausula.term } }, { nome2: { [Op.like]: clausula.term } }, { nome: { [Op.like]: clausula.term } }]),
        ...(clausula.email === null ? [] : [where(literal(EXPRESSAO_EMAILS), { [Op.like]: clausula.email })]),
      ],
    });
  }
  // Com ids já decididos pelos pré-filtros e sem texto, os cadastros vêm de uma só vez.
  return m.LegadoUsuario.findAll({ attributes: COLUNAS_CLIENTE, where: { [Op.and]: condicoes }, raw: true });
}

/**
 * Busca combinada (Maturacao/36): além dos candidatos do legado, as clientes editadas na ficha (`gf_clientes_ext`) cujo cadastro EDITADO casa com a
 * busca, mesmo que o legado não case. A regra final continua a da v608 (`realClientMatches`), agora sobre o cadastro com a edição por cima.
 */
async function acrescentarEditadas(m, linhas, plano) {
  const editadas = await extensao.extensoesPorId();
  const jaTem = new Set(linhas.map((l) => String(l.id)));
  const faltam = [...editadas.keys()].filter((id) => !jaTem.has(id));
  if (!faltam.length) return linhas;
  const achadas = (await lerCadastros(m, faltam)).filter((l) => model.realClientMatches(extensao.sobrepor(l, editadas.get(String(l.id))), plano.search, plano.role));
  return [...linhas, ...achadas];
}

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
    const registros = model.recordsOf(linhas);
    const ids = [...registros.keys()];
    // A busca lê a história inteira; o recorte só precisa dela para ordenar por última consulta ou último pagamento.
    const precisaGerais = plano.searching || plano.sort === 'lastConsultation' || plano.sort === 'lastPayment';
    const { consultaAt, recebAt } = precisaGerais ? await movimentosGerais(m, ids) : { consultaAt: new Map(), recebAt: new Map() };
    const latest = (id, range, kind) => {
      if (kind === 'consultation') return consultaAt.get(id) ?? null;
      if (kind === 'receipt') return recebAt.get(id) ?? null;
      return range ? rangeAt.get(id) ?? null : maior(consultaAt.get(id), recebAt.get(id));
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
    const contagens = clientRolePolicy(plano.role).canSeeDateCounts && !plano.searching ? await contagensDeData(m, today) : undefined;

    // O cadastro e a história inteira dos clientes da página somente (R19).
    const historia = await lerHistorias(m, clientIds, { consultas: true, recebimentos: true });
    const fontes = { clients: linhas.filter((l) => clientIds.includes(String(l.id))), ...historia };
    const selecao = model.realClientListSelection(plano, { clientIds, totalItems, ...(contagens ? { dateCounts: contagens } : {}) }, fontes);
    return model.buildRealClientList(selecao, fontes);
  });
}

/** A ficha com a projeção do perfil, ou null quando o ID não é cliente (404 CLIENT_NOT_FOUND; conta da equipe é o mesmo 404). */
async function obter({ role, clientId, nowLocal }) {
  return lendo(async (m) => {
    const [linhas, historia, catalogos] = await Promise.all([
      lerCadastros(m, [clientId]), lerHistorias(m, [clientId], { consultas: true, recebimentos: true }), lerCatalogosReferencia(m),
    ]);
    const [linha] = linhas;
    return linha ? model.buildRealClientProfile({ role, nowLocal, row: linha, catalogos, ...historia }) : null;
  });
}

async function existe(m, clientId) {
  return (await m.LegadoUsuario.findAll({ attributes: ['id'], where: { nivel: 0, id: Number(clientId) }, raw: true })).length > 0;
}

/** Se o ID é de uma cliente (nivel = 0). Para a ampliação do histórico, que nomeia uma e não lê mais nada (R25). */
function clienteExiste(clientId) {
  return lendo((m) => existe(m, clientId));
}

/** Histórico de consultas da cliente no alcance do perfil; null se o ID não é cliente. */
async function historicoDeConsultas({ role, expanded, clientId, nowLocal, query }) {
  return lendo(async (m) => {
    if (!await existe(m, clientId)) return null;
    const historia = await lerHistorias(m, [clientId], { consultas: true, recebimentos: false });
    return model.buildRealClientConsultationHistory({ role, expanded, nowLocal, clientId, rows: historia.consultations, query });
  });
}

/** Histórico de recebimentos da cliente (gêmeos conciliados pelo ID, R20); null se o ID não é cliente. */
async function historicoDeRecebimentos({ role, expanded, clientId, query }) {
  return lendo(async (m) => {
    if (!await existe(m, clientId)) return null;
    const historia = await lerHistorias(m, [clientId], { consultas: false, recebimentos: true });
    return model.buildRealClientReceiptHistory({ role, expanded, clientId, sources: historia.receipts, query });
  });
}

/**
 * O alcance pedido ao histórico: sem `grant`, o do perfil (false); com ele, o completo (true) se a linha lida pelo `id` em
 * gf_auditoria é uma ampliação desta cliente pela mesma conta, função e sessão de agora (R25). Qualquer outra, de sessão
 * encerrada ou mandada por outro perfil inclusive, é null, e a rota recusa com o motivo `scope` (403).
 * Só LÊ gf_auditoria. `contexto` = { clientId, actor: { accountId, role }, sessionId }.
 */
async function ampliacaoValida(contexto, grant) {
  if (grant === undefined) return false;
  // Sem identificador de sessão não há como provar que a liberação é desta sessão: recusa (ver decisões pendentes).
  if (!contexto.sessionId) return null;
  return lendoNovo(async (m) => {
    const linha = await m.GfAuditoria.findOne({ where: { id: grant }, raw: true });
    if (!linha) return null;
    let depois = null;
    // MySQL guarda texto; o Postgres (jsonb) já devolve o objeto.
    try { depois = typeof linha.depois === 'string' ? JSON.parse(linha.depois) : (linha.depois ?? null); } catch { depois = null; }
    const entrada = {
      id: linha.id, action: linha.acao, entity: linha.entidade, entityId: linha.entidade_id,
      actorUserId: linha.ator_conta_id, actorRole: linha.ator_funcao, after: depois, reason: linha.motivo,
    };
    return model.isRealClientHistoryGrantFor(entrada, contexto) ? true : null;
  });
}

/** Ampliação do histórico (R25): a regra e a gravação ficam em helpers/ampliacao.js; aqui entra só a leitura da existência. */
const ampliarHistorico = (contexto, corpo, dependencias = {}) => ampliar(contexto, corpo, { clienteExiste, ...dependencias });

module.exports = {
  COLUNAS_CLIENTE,
  ampliacaoValida,
  ampliarHistorico,
  clienteExiste,
  historicoDeConsultas,
  historicoDeRecebimentos,
  listar,
  obter,
};
