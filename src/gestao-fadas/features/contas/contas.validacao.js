'use strict';

/** Entrada das rotas de contas. Estrutura inválida: 400 INVALID_INPUT; regra do front: 422 RULE_VIOLATION com a mensagem do front. */

const c = require('../cadastros/cadastros.comum');
const dom = require('../../_comum/dominio/contas');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TODOS = ['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'];

const idConta = (v) => { if (typeof v !== 'string' || !UUID.test(v)) throw c.naoEncontrado(); return v.toLowerCase(); };
const idCatalogo = (v) => { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw c.invalido('tarotId'); return v; };
const somente = (b, permitidas) => { for (const k of Object.keys(b)) if (!permitidas.includes(k)) throw c.invalido(k); };

function legacyId(v) {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.trim().length > 64) throw c.invalido('legacyId');
  return v.trim();
}
function foto(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^(data:image\/[a-z0-9.+-]+;base64,|https?:\/\/|\/)/i.test(v)) throw c.invalido('avatar');
  if (v.length > dom.FOTO_MAX_CARACTERES) throw c.regra(dom.MSG.foto);
  return v;
}
/** Forma da senha (400). A força (422) é conferida DEPOIS da unicidade do e-mail, na ordem do front (`planAccountCommand`). */
function senhaForma(v) {
  if (typeof v !== 'string' || v.length > 200) throw c.invalido('password');
  return v;
}
function exigirSenhaForte(v) {
  if (!dom.senhaForte(v)) throw c.regra(dom.MSG.senhaFraca);
  return v;
}
const senha = (v) => exigirSenhaForte(senhaForma(v));
function emailEntrada(v) {
  if (typeof v !== 'string') throw c.invalido('email');
  const msg = dom.validarEmail(v);
  if (msg) throw c.regra(msg);
  return v.trim().toLocaleLowerCase('pt-BR');
}
function nome(v) {
  if (typeof v !== 'string') throw c.invalido('name');
  const n = dom.normalizarNome(v);
  if (!n) throw c.regra(dom.MSG.nomeEmail);
  if (n.length > 80) throw c.invalido('name');
  return n;
}

/** `POST /accounts`: equipe (`role` de equipe) ou acesso de tarólogo do catálogo (`tarotId`, `role: tarologa`). */
function corpoCriar(b) {
  if (!c.ehObjeto(b)) throw c.invalido('corpo');
  somente(b, ['operationKey', 'name', 'email', 'role', 'password', 'legacyId', 'avatar', 'tarotId']);
  if (!TODOS.includes(b.role)) throw c.invalido('role');
  const operationKey = c.chaveOperacao(b.operationKey);
  const tarologa = b.role === 'tarologa';
  // Ordem de `planAccountCommand`: nome e e-mail primeiro; só depois o vínculo com o cadastro da profissional.
  const name = nome(b.name); const email = emailEntrada(b.email);
  // `tarologa` sem `tarotId` ('O cadastro desta profissional não foi encontrado.') vem DEPOIS do e-mail em uso e da senha, na ordem do front: ver o serviço.
  if (!tarologa && b.tarotId !== undefined) throw c.invalido('tarotId');
  return {
    operationKey, role: b.role, tarotId: tarologa && b.tarotId !== undefined ? idCatalogo(b.tarotId) : undefined, name, email,
    password: senhaForma(b.password), legacyId: legacyId(b.legacyId), avatar: foto(b.avatar),
  };
}

/** `PATCH /accounts/:id`. */
function corpoEditar(b) {
  if (!c.ehObjeto(b)) throw c.invalido('corpo');
  somente(b, ['operationKey', 'expectedRevision', 'name', 'email', 'role', 'password', 'legacyId', 'avatar']);
  if (b.role !== undefined && !TODOS.includes(b.role)) throw c.invalido('role');
  return {
    operationKey: c.chaveOperacao(b.operationKey), expectedRevision: c.revisao(b.expectedRevision), role: b.role,
    name: b.name === undefined ? undefined : nome(b.name), email: b.email === undefined ? undefined : emailEntrada(b.email),
    password: b.password === undefined ? undefined : senhaForma(b.password), legacyId: legacyId(b.legacyId), avatar: foto(b.avatar),
  };
}

/** `POST /accounts/:id/password`. */
function corpoSenha(b) {
  if (!c.ehObjeto(b)) throw c.invalido('corpo');
  somente(b, ['operationKey', 'expectedRevision', 'password']);
  return { operationKey: c.chaveOperacao(b.operationKey), expectedRevision: c.revisao(b.expectedRevision), password: senha(b.password) };
}

/** `POST /accounts/:id/active`. */
function corpoAtivo(b) {
  if (!c.ehObjeto(b)) throw c.invalido('corpo');
  somente(b, ['operationKey', 'expectedRevision', 'active']);
  if (typeof b.active !== 'boolean') throw c.invalido('active');
  return { operationKey: c.chaveOperacao(b.operationKey), expectedRevision: c.revisao(b.expectedRevision), active: b.active };
}

module.exports = { exigirSenhaForte, idConta, corpoCriar, corpoEditar, corpoSenha, corpoAtivo };
