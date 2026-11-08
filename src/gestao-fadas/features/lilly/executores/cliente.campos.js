'use strict';

/**
 * Campos do cadastro da Lilly v708 (docs/banco/21 §2 da Nice), validados no Gestão (a API é a autoridade das regras). Porta de
 * `registration-policy.mjs` (nome conhecido, nascimento, e-mail, campos que faltam) e de `phone-identity.mjs`. Funções puras.
 *  - nome completo (`name`/`fullName`, os dois iguais quando vierem), `identificationName`, `treatAs`: texto VAZIO enquanto desconhecido, nunca "ID 95000";
 *  - `birthDate`: `AAAA-MM-DD` civil válido ou `null` (nunca data inventada);
 *  - `email` válido ou vazio; `noEmail` só significa "não tem e-mail" quando `true` e o e-mail está vazio;
 *  - `situacao_cadastral`: `dados_pendentes` | `completo`; o Gestão a CALCULA e recusa a que não confere com os dados.
 */

const { normalizarObservado } = require('../contexto/contexto.telefone');
const { texto, ehObjeto } = require('./executores.comum');

const SITUACOES = ['dados_pendentes', 'completo'];
const NOME_PLACEHOLDER = /^(?:id\s*\d+|cadastro\s+(?:pendente|a completar)|aguardando dados(?: para cadastro)?|sem nome|nome a (?:confirmar|conferir)|cliente|lead|desconhecid[ao])(?:\s*[·|:[-].*)?$/iu;
// eslint-disable-next-line no-control-regex
const CONTROLE = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F-\\x9F\\r\\n\\t\\u2028\\u2029]', 'u');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const nomeConhecido = (v) => { const n = texto(v); return Boolean(n) && /\p{L}/u.test(n) && !NOME_PLACEHOLDER.test(n); };

function dataValida(v) {
  const d = texto(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const ms = Date.parse(`${d}T12:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === d && d >= '1900-01-01' && ms <= Date.now() + 86400000;
}

/** Texto de campo de nome: vazio é permitido (desconhecido); placeholder e caractere de controle, não. `undefined` = campo ausente. */
function campoDeNome(v, rotulo, max, { placeholder = true } = {}) {
  if (v === undefined) return { ausente: true };
  if (v === null) return { valor: '' };
  if (typeof v !== 'string') return { erro: `${rotulo}: texto inválido.` };
  const t = v.trim();
  if (CONTROLE.test(v)) return { erro: `${rotulo}: caractere inválido.` };
  if (Array.from(t).length > max) return { erro: `${rotulo}: acima de ${max} caracteres.` };
  if (t && placeholder && NOME_PLACEHOLDER.test(t)) return { erro: `${rotulo}: "${t}" não é um nome (ID e "aguardando dados" só existem na apresentação).` };
  return { valor: t };
}

/**
 * Normaliza o payload. Devolve `{ erro }` ou `{ campos }` com só o que veio (ausente = não mexer):
 * `nome`, `nomeId`, `tratarPor`, `nascimento` (string|null), `telefone`, `email`, `semEmail` (boolean), `situacao`.
 */
function normalizarCampos(payload) {
  const p = ehObjeto(payload) ? payload : {};
  const campos = {};
  const nome = campoDeNome(p.name, 'name', 120); const completo = campoDeNome(p.fullName, 'fullName', 120);
  for (const r of [nome, completo]) if (r.erro) return { erro: r.erro };
  if (!nome.ausente && !completo.ausente && nome.valor !== completo.valor) return { erro: 'name e fullName precisam ser iguais.' };
  if (!nome.ausente || !completo.ausente) campos.nome = (nome.ausente ? completo : nome).valor;
  const nomeId = campoDeNome(p.identificationName, 'identificationName', 50); if (nomeId.erro) return { erro: nomeId.erro };
  if (!nomeId.ausente) campos.nomeId = nomeId.valor;
  const tratar = campoDeNome(p.treatAs, 'treatAs', 50, { placeholder: false }); if (tratar.erro) return { erro: tratar.erro };
  if (!tratar.ausente) campos.tratarPor = tratar.valor;
  if (p.birthDate !== undefined) {
    if (p.birthDate === null || p.birthDate === '') campos.nascimento = null;
    else if (typeof p.birthDate === 'string' && dataValida(p.birthDate)) campos.nascimento = p.birthDate.trim();
    else return { erro: 'birthDate: use uma data civil válida (AAAA-MM-DD) ou null.' };
  }
  if (p.phone !== undefined && p.phone !== null && p.phone !== '') {
    const fone = normalizarObservado(p.phone);
    if (!fone) return { erro: 'phone: telefone inválido ou sem DDD.' };
    campos.telefone = fone;
  }
  if (p.email !== undefined) {
    const e = typeof p.email === 'string' ? p.email.trim() : p.email === null ? '' : null;
    if (e === null || (e && (!EMAIL.test(e) || e.length > 320))) return { erro: 'email: e-mail inválido.' };
    campos.email = e;
  }
  if (p.noEmail !== undefined) { if (typeof p.noEmail !== 'boolean') return { erro: 'noEmail: informe verdadeiro ou falso.' }; campos.semEmail = p.noEmail; }
  if (campos.semEmail === true && campos.email) return { erro: 'noEmail: não pode vir com e-mail preenchido.' };
  const sit = p.situacao_cadastral ?? p.registrationStatus;
  if (sit !== undefined && sit !== null) { if (!SITUACOES.includes(sit)) return { erro: 'situacao_cadastral: use dados_pendentes ou completo.' }; campos.situacao = sit; }
  return { campos };
}

/** O que falta para o cadastro estar completo (mesma ordem da Lilly). `d` = dados efetivos já fundidos com o que existia. */
function faltando(d) {
  const f = [];
  if (!nomeConhecido(d.nome)) f.push('nome');
  if (!d.telefone) f.push('telefone');
  if (!d.nascimento) f.push('nascimento');
  if (!(d.email && EMAIL.test(d.email)) && d.semEmail !== true) f.push('e-mail');
  return f;
}

/** Confere a situação pedida com a calculada. `{ situacao }` ou `{ erro }`. Sem pedido: a calculada. */
function situacaoConferida(pedida, efetivos) {
  const calculada = faltando(efetivos).length ? 'dados_pendentes' : 'completo';
  if (pedida && pedida !== calculada) return { erro: `situacao_cadastral "${pedida}" não confere com os dados recebidos (faltam: ${faltando(efetivos).join(', ') || 'nada'}).` };
  return { situacao: calculada };
}

module.exports = { normalizarCampos, faltando, situacaoConferida, nomeConhecido, dataValida, SITUACOES };
