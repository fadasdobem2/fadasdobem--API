'use strict';

/**
 * Valores/Preços (Maturacao/29 seção 10): o histórico de versões da tabela de valores. Só acrescenta (nunca altera uma versão antiga);
 * a vigente é a do `effectiveAt` (`precoVigente`), e a VAL-001 do front é a base implícita, nunca gravada.
 *   - leitura: toda a equipe (`canViewConsultations`: o lançamento da consulta precifica com a vigente); a taróloga não lê;
 *   - gravação: `canManageFinancialValues` (administradora e assistente); o servidor RECALCULA a versão (base vigente na data de vigência +
 *     campos alterados), carimba autor e instante, valida com as mensagens do front e confere a revisão (`expectedRevision` = quantas
 *     versões o navegador viu; 409 `VERSION_CHANGED` se mudou), idempotência por `operationKey`, auditoria na mesma transação.
 */

const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const precos = require('../../_comum/dominio/precos');
const f = require('./fin.comum');

const COPIA_REVISAO = 'Não foi possível salvar esta configuração. Recarregue os valores e tente novamente.'; // texto do front (financial-settings.ts)
const ordenar = (versoes) => [...versoes].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
const item = (l) => f.textoDe(l);

async function ler(req) {
  f.ator(req, { permissao: 'canViewConsultations' });
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const linhas = await lendoNovo((m) => m.GfPrecosVersoes.findAll({ order: [['criado_em', 'ASC'], ['id', 'ASC']] }));
  return { readAt: new Date().toISOString(), history: ordenar(linhas.map(item)), revision: linhas.length };
}

/** `POST /pricing/versions`: `{ operationKey, expectedRevision, version }`. */
async function criarVersao(req) {
  const a = f.ator(req, { permissao: 'canManageFinancialValues', escrita: true });
  const b = req.body;
  if (!f.ehObjeto(b) || !f.ehObjeto(b.version)) throw f.invalido('corpo');
  const operationKey = f.chaveOperacao(b.operationKey);
  const expectedRevision = f.revisao(b.expectedRevision);
  const v = b.version;
  if (typeof v.id !== 'string' || !/^VAL-[A-Za-z0-9-]{4,60}$/.test(v.id) || v.id === 'VAL-001') throw f.invalido('version.id');
  f.instante(v.effectiveAt, 'version.effectiveAt');
  return f.gravar(req, {
    escopo: 'precos.versao', operationKey, corpo: { expectedRevision, version: v }, entidade: 'preco', entidadeId: v.id, acao: 'precos.versao',
    producao: async (ex) => {
      await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', ['gf_precos_versoes']);
      const [linhas] = await ex.execute('SELECT id, item FROM gf_precos_versoes ORDER BY criado_em, id');
      if (linhas.length !== expectedRevision) throw f.conflitoVersao(COPIA_REVISAO);
      const historico = linhas.map(item);
      const agora = new Date().toISOString();
      const nova = precos.criarVersao({ historico, versao: v, ator: a.nome, agora });
      await ex.execute('INSERT INTO gf_precos_versoes (id, vigente_desde, item, criado_em, criado_por, operation_key) VALUES (?, ?, ?, ?, ?, ?)', [nova.id, nova.effectiveAt, JSON.stringify(nova), agora, a.nome, operationKey]);
      const todas = ordenar([...historico, nova]);
      return { antes: { revision: linhas.length }, depois: { revision: linhas.length + 1, id: nova.id, changedFields: nova.changedFields }, resposta: { readAt: agora, history: todas, revision: linhas.length + 1 } };
    },
  });
}

/** Tabela vigente agora, para o Painel (`GET /panel/sources`): `{ history, current }`. */
async function paraOPainel() {
  const linhas = await lendoNovo((m) => m.GfPrecosVersoes.findAll({ order: [['criado_em', 'ASC'], ['id', 'ASC']] }));
  const historico = linhas.map(item);
  return { history: ordenar(historico), revision: linhas.length, current: precos.precoVigente(historico, new Date().toISOString()) };
}

module.exports = { ler, criarVersao, paraOPainel };
