'use strict';

/**
 * Peças comuns da fatia Valores, Pagamentos e Restrições (Maturacao/29 seção 10): quem age, erros do gate e a gravação idempotente
 * (efeito + auditoria + `gf_operacoes` na MESMA transação), a mesma de Horários/Agenda/Consulta/Cadastros (reaproveitada de
 * `cadastros.comum.js`). Pagamentos e preços são da EQUIPE; a taróloga só entra em Restrições, no próprio `tarotId`.
 */

const c = require('../cadastros/cadastros.comum');
const AppError = require('../../../utils/AppError');
const { PrecoInvalidoError } = require('../../_comum/dominio/precos');
const { RestricaoInvalidaError } = require('../../_comum/dominio/restricoes');
const { PagamentoInvalidoError, PagamentoNegadoError } = require('../../_comum/dominio/pagamentos-regras');

const EQUIPE = new Set(['administradora', 'assistente', 'supervisora', 'atendente']);
const regra = (mensagem) => new AppError(mensagem, 422, { codigo: 'RULE_VIOLATION' }, true);
/** 409 com o texto da tela (o gate só repassa a mensagem com `usarMensagem`). */
const conflitoVersao = (mensagem) => new AppError(mensagem || 'Os dados mudaram desde que você abriu a tela. Atualize e tente novamente.', 409, { codigo: 'VERSION_CHANGED', usarMensagem: true }, true);

/** Quem age. `permissao`: capacidade de `permissoesDoPerfil` exigida (a equipe); a taróloga só passa com `aceitaTarologa`. */
function ator(req, { permissao, escrita = false, aceitaTarologa = false } = {}) {
  const q = c.quem(req);
  if (!q.perfil) throw c.negado(escrita);
  const tarologa = q.perfil === 'tarologa';
  if (tarologa && !aceitaTarologa) throw c.negado(escrita);
  if (!tarologa && !EQUIPE.has(q.perfil)) throw c.negado(escrita);
  if (!tarologa && permissao && !q.p[permissao]) throw c.negado(escrita);
  if (tarologa && !q.proprio) throw c.negado(escrita);
  return { ...q, tarologa, equipe: !tarologa };
}

/** Erros de domínio viram 422 com a mensagem do front. */
const traduzir = (e) => {
  if (e instanceof PagamentoNegadoError) return c.negado(true);
  if (e instanceof PagamentoInvalidoError) return e.tipo === 'forma' ? c.invalido(e.message.replace('Dados inválidos: ', '')) : regra(e.message);
  return e instanceof PrecoInvalidoError || e instanceof RestricaoInvalidaError ? regra(e.message) : c.traduzir(e);
};

/** `gravar` do cadastros com a tradução dos erros de domínio desta fatia. */
async function gravar(req, opcoes) {
  try { return await c.gravar(req, opcoes); } catch (e) { throw traduzir(e); }
}

const cobrir = (v, campo) => { if (v === undefined) throw c.invalido(campo); return v; };
const idRegistro = (v, campo = 'id') => { if (typeof v !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(v)) throw c.invalido(campo); return v; };
const idCliente = (v, campo = 'clientId') => { if (typeof v !== 'string' || !/^[1-9]\d{0,9}$/.test(v) || Number(v) > 2147483647) throw c.invalido(campo); return v; };
const instante = (v, campo) => { if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) throw c.invalido(campo); return v; };
/** Texto estável (chaves em ordem): o jsonb do Postgres não guarda a ordem das chaves, então comparar registros é por valor. */
function estavel(v) {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${estavel(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
const igual = (a, b) => estavel(a) === estavel(b);
const textoDe = (linha) => (typeof linha.item === 'string' ? JSON.parse(linha.item) : linha.item);

module.exports = { ...c, regra, conflitoVersao, ator, traduzir, gravar, cobrir, idRegistro, idCliente, instante, textoDe, estavel, igual };
