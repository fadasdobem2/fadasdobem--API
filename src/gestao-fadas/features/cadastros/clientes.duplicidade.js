'use strict';

/** Conferência do cadastro manual: CPF impede outro ID; telefone/e-mail/nome pedem decisão explícita. */
const { createHash } = require('crypto');
const { Op, where, fn, col, literal } = require('sequelize');
const AppError = require('../../../utils/AppError');
const { lendo } = require('../../_comum/legado');
const { contaDaRequisicao } = require('../../_comum/conta');
const { hashDoCorpo } = require('../../novo/operacoes');
const { linhaDeCadastro } = require('../clientes/cliente-novo.leitura');
const { sobrepor } = require('../clientes/helpers/extensao');
const { dadosEfetivosDoCliente } = require('../../legado-escrita/fusao');
const { fichaDeLinha } = require('../../_comum/dominio/cliente-ficha-efetivo');
const { cpfValido } = require('../../_comum/dominio/cliente-ficha-validacao');
const { normalizarObservado, telefonesDoCadastro } = require('../lilly/contexto/contexto.telefone');

const nome = (v) => `${v || ''}`.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
const email = (v) => `${v || ''}`.trim().toLocaleLowerCase('pt-BR');
const digitos = (v) => `${v || ''}`.replace(/\D/g, '');
const json = (v) => typeof v === 'string' ? JSON.parse(v) : v;
const COLUNAS = ['id', 'nivel', 'nome', 'nome_id', 'nome2', 'cpf', 'email', 'email2', 'ddi', 'ddd', 'ddd_real', 'telresidencial', 'telcomercial', 'cel', 'cel2', 'whats', 'datanascimento'];

function motivos(linha, ficha, pedido) {
  const r = [];
  if (pedido.cpf && cpfValido(pedido.cpf) === cpfValido(linha.cpf)) r.push('cpf');
  const atuais = ficha.phones?.length ? ficha.phones : telefonesDoCadastro(linha).telefones;
  const fones = atuais.map(normalizarObservado).filter(Boolean);
  if (pedido.phones.some((p) => fones.includes(normalizarObservado(p)))) r.push('whatsapp');
  if (pedido.email && email(pedido.email) === email(linha.email)) r.push('email');
  const completo = nome(linha.nome);
  if (nome(pedido.fullName).includes(' ') && nome(pedido.fullName) === (completo || nome(linha.nome_id))) {
    const nasc = pedido.birthDate?.split('/').reverse().join('-');
    r.push(completo && nasc && nasc === `${linha.datanascimento || ''}`.slice(0, 10) ? 'nameBirth' : 'name');
  }
  return r;
}

async function conferirDuplicidade(ex, pedido, req, confirmado) {
  // Extensões incluem telefones adicionais/CPF editados, mesmo quando a fonte-base não corresponde ao pré-filtro.
  const [exts] = await ex.execute('SELECT * FROM gf_clientes_ext', []);
  const extensoes = new Map(exts.map((e) => [String(e.id_cliente), e]));
  const [novas] = await ex.execute('SELECT * FROM gf_clientes_novos', []);
  const condicoes = [];
  if (pedido.cpf) condicoes.push(where(literal("REGEXP_REPLACE(COALESCE(cpf, ''), '[^0-9]', '')"), cpfValido(pedido.cpf)));
  if (pedido.email) condicoes.push(where(fn('LOWER', fn('TRIM', col('email'))), email(pedido.email)));
  const primeiro = pedido.fullName.trim().split(/\s+/)[0].replace(/[\\%_]/g, '\\$&');
  condicoes.push({ nome: { [Op.like]: `%${primeiro}%` } }, { nome_id: { [Op.like]: `%${primeiro}%` } });
  for (const p of pedido.phones) {
    const like = `%${digitos(p).slice(-8)}%`;
    for (const campo of ['telresidencial', 'telcomercial', 'cel', 'cel2', 'whats']) condicoes.push(where(literal(`REGEXP_REPLACE(COALESCE(${campo}, ''), '[^0-9]', '')`), { [Op.like]: like }));
  }
  const antigosEditados = [...extensoes.keys()].filter((id) => Number(id) < 1000000000);
  const legadas = await lendo(async (m) => {
    const resultado = await m.LegadoUsuario.findAll({ attributes: COLUNAS, where: { nivel: 0, [Op.or]: condicoes }, raw: true });
    for (let i = 0; i < antigosEditados.length; i += 1000) resultado.push(...await m.LegadoUsuario.findAll({ attributes: COLUNAS, where: { nivel: 0, id: antigosEditados.slice(i, i + 1000).map(Number) }, raw: true }));
    return resultado;
  });
  const todas = new Map([...legadas, ...novas.map(linhaDeCadastro)].map((l) => [String(l.id), l]));
  const candidatos = [];
  const versoes = [];
  for (const [id, original] of todas) {
    const ext = extensoes.get(id);
    const ficha = ext ? fichaDeLinha(ext) : {};
    const linha = ext ? sobrepor(original, { ...dadosEfetivosDoCliente({ ...ext, dados: json(ext.dados) }), ...ficha }) : original;
    const reasons = motivos(linha, ficha, pedido);
    if (!reasons.length) continue;
    candidatos.push({ clientId: id, name: `${linha.nome_id || linha.nome || ''}`.trim(), reasons });
    versoes.push({ id, linha, ficha, revision: ext?.revisao ?? 0 });
  }
  candidatos.sort((a, b) => Number(b.reasons.includes('cpf')) - Number(a.reasons.includes('cpf')) || Number(a.clientId) - Number(b.clientId));
  if (!candidatos.length) return;
  versoes.sort((a, b) => Number(a.id) - Number(b.id));
  const token = createHash('sha256').update(hashDoCorpo({ pedido, usuario: contaDaRequisicao(req), versoes })).digest('hex');
  const blockedByCpf = candidatos.some((x) => x.reasons.includes('cpf'));
  if (!blockedByCpf && confirmado === token) return;
  const duplicateReview = { token, blockedByCpf, candidates: candidatos };
  throw new AppError(blockedByCpf ? 'O CPF já pertence a um cadastro. Confira a cliente antes de continuar.' : 'Há cadastros parecidos. Confira antes de cadastrar outra cliente.', 409, { codigo: 'CLIENT_DUPLICATE_REVIEW', duplicateReview }, true);
}

module.exports = { conferirDuplicidade, motivos };
