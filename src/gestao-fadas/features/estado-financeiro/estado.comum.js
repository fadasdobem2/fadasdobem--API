'use strict';

/**
 * Peças comuns da fatia Estado financeiro (Maturacao/43): quem age, tradução dos erros de domínio para o gate (422 com a frase do front, 409 para
 * versão) e o relógio (data civil de São Paulo, a mesma que o front usa nos Adicionais; os testes trocam o relógio).
 */

const f = require('../financeiro-cliente/fin.comum');
const { MotivoInvalidoError } = require('../../_comum/dominio/motivos-financeiros');
const { AdicionalInvalidoError } = require('../../_comum/dominio/adicionais');
const { LogInvalidoError } = require('../../_comum/dominio/log-operacional');

/** Domínio -> gate: 409 `VERSION_CHANGED` (com a frase do front) para conflito, 422 `RULE_VIOLATION` para regra, 400 para forma. */
function traduzir(e) {
  if (e instanceof MotivoInvalidoError || e instanceof AdicionalInvalidoError) return e.tipo === 'conflito' ? f.conflitoVersao(e.message) : e.tipo === 'forma' ? f.invalido('record') : f.regra(e.message);
  if (e instanceof LogInvalidoError) return f.invalido('events');
  return e;
}

/** Relógio: `{ agora(): ISO, hoje(): 'AAAA-MM-DD' de São Paulo }`. */
let relogio = {
  agora: () => new Date().toISOString(),
  hoje: () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; },
};
const definirRelogio = (r) => { relogio = r; };
const relogioAtual = () => relogio;

/** Equipe (os quatro perfis). A taróloga não tem estas telas. */
const atorEquipe = (req, escrita = false) => f.ator(req, { permissao: 'canViewConsultations', escrita });

/** Corpo comum das gravações: `{ operationKey, expectedVersion, record }`. */
function corpoDeGravacao(req) {
  const b = req.body;
  if (!f.ehObjeto(b)) throw f.invalido('corpo');
  if (!f.ehObjeto(b.record)) throw f.invalido('record');
  return { operationKey: f.chaveOperacao(b.operationKey), expectedVersion: f.revisao(b.expectedVersion), record: b.record };
}

module.exports = { f, traduzir, definirRelogio, relogioAtual, atorEquipe, corpoDeGravacao };
