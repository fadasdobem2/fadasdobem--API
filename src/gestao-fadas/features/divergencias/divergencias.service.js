'use strict';

/**
 * Divergências (Maturacao/31). Uma linha por divergência (`gf_divergencias`), registro do front em `item` (histórico e comentários só crescem).
 *   - leitura (`GET /divergences`): a equipe lê as que o perfil vê (financeira só com `canViewFinancialDivergences`); a taróloga só as
 *     DELA (`readerDivergences`, domínio `divergencias.js`). Mais novas primeiro (a tela não ordena a lista da equipe);
 *   - gravação (`PUT /divergences/:id`): `{ operationKey, expectedVersion (0 = nova), record }`. O servidor confere forma, a transição
 *     (quem pode o quê, como no front), os vínculos (consulta, pagamento e cliente existem e batem) e carimba autor e instante dos eventos novos;
 *   - idempotência `operationKey`, revisão `expectedVersion` (409 `VERSION_CHANGED`), auditoria e `gf_operacoes` na MESMA transação.
 */

const janela = require('../../_comum/janela');
const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const dom = require('../../_comum/dominio/divergencias');
const decisao = require('../../_comum/dominio/divergencias-decisao');
const f = require('../financeiro-cliente/fin.comum');
const AppError = require('../../../utils/AppError');

let verificarCliente = async (id) => require('../clientes/clientes.service').clienteExiste(id);
const definirVerificadorDeCliente = (fn) => { verificarCliente = fn; };
const comoItem = (l) => ({ ...f.textoDe(l), id: l.id });
const ordem = (a, b) => (Date.parse(b.createdAt) - Date.parse(a.createdAt)) || (a.id < b.id ? 1 : -1);
const CONFERIR_ANTES = 'A divergência mudou. Atualize a tela e tente novamente.';

/** Erros de domínio viram 422 com a mensagem do front. */
const traduzir = (e) => (e instanceof dom.DivergenciaInvalidaError ? f.regra(e.message) : e);
const atorDe = (req, opcoes) => f.ator(req, { permissao: 'canViewDivergences', aceitaTarologa: true, ...opcoes });

async function ler(req) {
  const a = atorDe(req);
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const linhas = await lendoNovo((m) => m.GfDivergencias.findAll({ order: [['criado_em', 'DESC'], ['id', 'DESC']] }));
  const visiveis = linhas.map((l) => ({ item: comoItem(l), versao: Number(l.version) })).filter((x) => dom.visivel(x.item, a)).sort((x, y) => ordem(x.item, y.item));
  const { itens: pagina, nextCursor } = janela.fatiar(visiveis, janela.ler(req.query), (x) => x.item.id);
  return { readAt: new Date().toISOString(), items: pagina.map((x) => x.item), versions: Object.fromEntries(pagina.map((x) => [x.item.id, x.versao])), ...(nextCursor !== undefined ? { nextCursor } : {}) };
}

async function conferirVinculos(ex, antes, pedido, a, classe) {
  if (pedido.consultationId && (!antes || antes.consultationId !== pedido.consultationId || classe === 'resolucao')) {
    const [c] = await ex.execute('SELECT id_cliente, id_tarologo FROM gf_consultas_ext WHERE id = ?', [pedido.consultationId]);
    if (!c[0]) throw f.regra('A consulta não foi localizada. Atualize a seleção.');
    if (a.tarologa && (c[0].id_tarologo !== a.proprio || (pedido.clientId && c[0].id_cliente !== pedido.clientId))) throw f.regra('Você só pode enviar divergências em seu nome.');
    if (pedido.status === 'Resolvida' && pedido.clientId && c[0].id_cliente !== pedido.clientId) throw f.regra('O vínculo da consulta não corresponde à cliente ou ao tarólogo deste relato. Confira o vínculo antes de resolver.');
  }
  if (pedido.paymentId && (!antes || antes.paymentId !== pedido.paymentId)) {
    const [p] = await ex.execute('SELECT id_cliente FROM gf_pagamentos WHERE id = ?', [pedido.paymentId]);
    if (!p[0]) throw f.regra('O pagamento vinculado não foi localizado.');
    if (pedido.clientId && p[0].id_cliente !== pedido.clientId) throw f.regra('O pagamento vinculado pertence a outra cliente. Confira o vínculo antes de resolver.');
  }
  if (pedido.clientId && (!antes || antes.clientId !== pedido.clientId) && !(await verificarCliente(pedido.clientId))) {
    throw new AppError('Cadastro de cliente não encontrado.', 404, { codigo: 'CLIENT_NOT_FOUND' }, true);
  }
}

/** Quem pode a classe de mudança, como na tela (`permissionsFor`). */
function conferirPermissao(classe, pedido, a) {
  if (a.tarologa) return;
  const p = a.p;
  if (pedido.kind === 'Financeira' && !p.canViewFinancialDivergences && classe !== 'reescrita') throw f.negado(true);
  if (classe === 'reescrita') { if (!p.canManageConsultations) throw f.negado(true); return; }
  if (dom.exigeResolver(classe) && !(pedido.kind === 'Financeira' ? p.canResolveFinancialDivergences : p.canResolveOperationalDivergences)) throw f.regra('Esta decisão pertence à equipe responsável.');
}

async function gravar(req) {
  const a = atorDe(req, { escrita: true });
  const id = f.idRegistro(req.params.id);
  const b = req.body;
  if (!f.ehObjeto(b)) throw f.invalido('corpo');
  const operationKey = f.chaveOperacao(b.operationKey);
  const expectedVersion = f.revisao(b.expectedVersion);
  let pedido;
  try { pedido = dom.forma(b.record); } catch (e) { throw traduzir(e); }
  if (pedido.id !== id) throw f.invalido('record.id');
  return f.gravar(req, {
    escopo: 'divergencias.gravar', operationKey, corpo: { id, expectedVersion, record: pedido }, entidade: 'divergencia', entidadeId: id, acao: 'divergencias.gravar',
    producao: async (ex) => {
      try {
        await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_divergencias:${id}`]);
        const [linhas] = await ex.execute('SELECT id, item, version FROM gf_divergencias WHERE id = ? FOR UPDATE', [id]);
        const antes = linhas[0] ? comoItem(linhas[0]) : null;
        if ((antes ? Number(linhas[0].version) : 0) !== expectedVersion) throw f.conflitoVersao(CONFERIR_ANTES);
        let classe = 'criacao';
        if (!antes) {
          if (!a.tarologa && !a.p.canManageConsultations) throw f.negado(true);
          dom.conferirCriacao(pedido, a);
          if (a.tarologa) {
            const [outras] = await ex.execute('SELECT id, item FROM gf_divergencias WHERE (id_reportador = ? OR (id_reportador IS NULL AND id_tarologo = ?)) AND excluida = FALSE', [a.proprio, a.proprio]);
            const repetida = dom.repetida(pedido, outras.map(comoItem), a.proprio);
            if (repetida) throw f.regra(repetida);
            // Data e horário do relato não podem estar no futuro (`missingConsultationError`, no relógio do servidor).
            decisao.conferirConsultaAusente(pedido, outras.map(comoItem), Date.now(), a.proprio);
          }
        } else {
          if (!dom.visivel(antes, a)) throw f.negado(true);
          classe = dom.conferirTransicao(antes, pedido, a);
          conferirPermissao(classe, pedido, a);
          if (a.tarologa && classe === 'edicao' && pedido.issueType === 'Consulta ausente') {
            const [outras] = await ex.execute('SELECT id, item FROM gf_divergencias WHERE (id_reportador = ? OR (id_reportador IS NULL AND id_tarologo = ?)) AND excluida = FALSE AND id <> ?', [a.proprio, a.proprio, id]);
            decisao.conferirConsultaAusente(pedido, outras.map(comoItem), Date.now(), a.proprio);
          }
          if (classe === 'resolucao') {
            const citada = pedido.consultationId || antes.consultationId;
            const [c] = citada ? await ex.execute('SELECT item FROM gf_consultas_ext WHERE id = ?', [citada]) : [[]];
            decisao.conferirEfeitos(antes, pedido, c[0] ? f.textoDe(c[0]) : null);
          }
        }
        await conferirVinculos(ex, antes, pedido, a, classe);
        const agora = new Date().toISOString();
        const reg = dom.carimbar(antes, pedido, a.nome, agora);
        const versao = expectedVersion + 1;
        const { id: _i, ...semId } = reg;
        const colunas = [reg.kind, reg.area, reg.status, reg.clientId || null, reg.tarotId || null, reg.reporterTarotId || null, reg.consultationId || null, reg.paymentId || null, Boolean(reg.deletedAt), JSON.stringify(semId)];
        if (!antes) {
          await ex.execute('INSERT INTO gf_divergencias (tipo, area, situacao, id_cliente, id_tarologo, id_reportador, id_consulta, id_pagamento, excluida, item, id, version, criado_por, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)', [...colunas, id, a.nome, operationKey]);
        } else {
          await ex.execute('UPDATE gf_divergencias SET tipo = ?, area = ?, situacao = ?, id_cliente = ?, id_tarologo = ?, id_reportador = ?, id_consulta = ?, id_pagamento = ?, excluida = ?, item = ?, version = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?', [...colunas, versao, id]);
        }
        return {
          antes: antes ? { version: expectedVersion, status: antes.status, deleted: Boolean(antes.deletedAt) } : null,
          depois: { version: versao, status: reg.status, deleted: Boolean(reg.deletedAt), classe, kind: reg.kind, area: reg.area, clientId: reg.clientId || null, consultationId: reg.consultationId || null },
          resposta: { readAt: agora, items: [reg], versions: { [id]: versao } },
        };
      } catch (e) { throw traduzir(e); }
    },
  });
}

/** As divergências que o perfil vê, para o Painel (`GET /panel/sources`). */
async function paraOPainel(req) { return (await ler(req)).items; }

module.exports = { ler, gravar, paraOPainel, definirVerificadorDeCliente };
