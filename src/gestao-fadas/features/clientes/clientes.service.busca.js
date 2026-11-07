'use strict';

/** A busca (pré-filtros "mais e nunca menos"; a regra da v608 decide em memória, R19) (fatia de clientes.service.js; leitura SOMENTE LEITURA do legado). */

const { Op, fn, col, where, literal } = require('sequelize');
const model = require('./clientes.model');
const { emptyClientSearch, parseClientBirthDate } = require('./helpers/busca');
const extensao = require('./helpers/extensao');
const { normalizeSearch } = require('./helpers/valores');
const { COLUNAS_CLIENTE, numericIds } = require('./clientes.service.comum');
const { lerCadastros } = require('./clientes.service.historias');

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

module.exports = {
  acrescentarEditadas,
  candidatosDaBusca,
};
