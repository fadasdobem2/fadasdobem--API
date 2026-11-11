'use strict';

/**
 * Pagamentos de cliente (Maturacao/29 seção 10): o LANÇAMENTO manual da equipe, como o front faz (nenhum gateway, nenhum dado de cartão).
 *   - leitura: a equipe (`canViewRecentPayments`); a taróloga não vê pagamento nem saldo;
 *   - gravação: lançar, revisar (corrigir, confirmar, cancelar, vincular, movimentos) e conceder Bônus/Cortesia são da equipe
 *     (`canManageConsultations`); movimentos de saída são do Financeiro (administradora e assistente). O servidor carimba autor e instante,
 *     confere a FORMA e as invariantes (`pagamentos.validacao.js`), a revisão (`expectedVersion`, 409 `VERSION_CHANGED`), a idempotência
 *     (`operationKey`) e grava auditoria + evento + `gf_operacoes` na MESMA transação;
 *   - o saldo é do domínio portado (`financeiro-saldo.js`): abertura da PLANILHA DE MIGRAÇÃO (Maturacao/55; sem planilha, zero) mais os movimentos do Postgres depois do corte.
 */

const { randomUUID } = require('crypto');
const janela = require('../../_comum/janela');
const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const f = require('./fin.comum');
const v = require('./pagamentos.validacao');
const regras = require('../../_comum/dominio/pagamentos-regras');
const { dadosEfetivosDoCliente } = require('../../legado-escrita/fusao');
const refazer = require('../../_comum/dominio/pagamentos-refazer');
const acompanhamento = require('../../_comum/dominio/painel-pagamentos');
const ctx = require('./fin.contexto');
const espelho = require('./pagamentos.espelho');
const { contextoParaRefazer, contextoDoLancamento } = require('./pagamentos.contexto');

/**
 * REGRAS DE DINHEIRO NO SERVIDOR (Maturacao/42): com `GF_FINANCEIRO_REGRAS=true` o servidor REFAZ a função do front (lançamento, preço escolhido, duplicidade, correção,
 * movimento, ocorrência, transferência de saldo) e grava o resultado DELE. Ligado por PADRÃO (só `false` explícito desliga); desligado, vale só a conferência de forma e invariantes (comportamento anterior).
 */
const estrito = () => process.env.GF_FINANCEIRO_REGRAS !== 'false';

const COPIA_VERSAO = 'O pagamento mudou. Confira a situação atual antes de continuar.';
const comoItem = (l) => ({ ...f.textoDe(l), id: l.id });
let verificarCliente = async (id) => require('../clientes/clientes.service').clienteExiste(id);
const definirVerificadorDeCliente = (fn) => { verificarCliente = fn; };
const naoExiste = () => new (require('../../../utils/AppError'))('Cadastro de cliente não encontrado.', 404, { codigo: 'CLIENT_NOT_FOUND' }, true);

const COLUNAS_INSERT = 'id, id_cliente, status, confirmacao, valor_centavos, metodo, id_consulta, informado_em, item, version, criado_por, operation_key';
async function inserirEvento(ex, id, tipo, a, dados, versao, operationKey) {
  await ex.execute('INSERT INTO gf_pagamentos_eventos (id, id_pagamento, tipo, ator_id, ator_nome, ator_perfil, dados, versao, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), id, tipo, a.id || 'sem-id', a.nome, a.perfil, JSON.stringify(dados), versao, operationKey]);
}

/** `GET /payments`: todos os recebimentos (sem paginação nesta fatia), as versões e os benefícios concedidos. */
async function ler(req) {
  f.ator(req, { permissao: 'canViewRecentPayments' });
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const clientId = req.query && req.query.clientId !== undefined ? f.idCliente(`${req.query.clientId}`, 'clientId') : undefined;
  const { pagamentos, beneficios } = await lendoNovo(async (m) => ({
    pagamentos: await m.GfPagamentos.findAll({ where: clientId ? { id_cliente: clientId } : {}, order: [['informado_em', 'ASC'], ['id', 'ASC']] }),
    beneficios: await m.GfBeneficiosMinutos.findAll({ where: clientId ? { id_cliente: clientId } : {}, order: [['concedido_em', 'ASC'], ['id', 'ASC']] }),
  }));
  const { itens: pagina, nextCursor } = janela.fatiar(pagamentos, janela.ler(req.query));
  return { readAt: new Date().toISOString(), items: pagina.map(comoItem), versions: Object.fromEntries(pagina.map((l) => [l.id, Number(l.version)])), benefits: beneficios.map(comoItem), ...(nextCursor !== undefined ? { nextCursor } : {}) };
}

/** `POST /payments`: `{ operationKey, record }`. */
async function lancar(req) {
  const a = f.ator(req, { permissao: 'canManageConsultations', escrita: true });
  const b = req.body;
  if (!f.ehObjeto(b)) throw f.invalido('corpo');
  const operationKey = f.chaveOperacao(b.operationKey);
  const r = v.forma(b.record);
  try { regras.conferirLancamento(r, a.p); } catch (e) { throw f.traduzir(e); }
  if (!(await verificarCliente(r.clientId))) throw naoExiste();
  return f.gravar(req, {
    escopo: 'pagamentos.lancar', operationKey, corpo: { record: r }, entidade: 'pagamento', entidadeId: r.id, acao: 'pagamentos.lancar',
    producao: async (ex) => {
      await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_pagamentos:cliente:${r.clientId}`]);
      const [existe] = await ex.execute('SELECT id FROM gf_pagamentos WHERE id = ?', [r.id]);
      if (existe[0]) throw f.conflitoVersao('Este pagamento já existe.');
      if (r.linkedConsultationId) {
        const [consulta] = await ex.execute('SELECT id_cliente FROM gf_consultas_ext WHERE id = ?', [r.linkedConsultationId]);
        if (consulta[0] && consulta[0].id_cliente !== r.clientId) throw f.regra('Esta consulta pertence a outra cliente.');
      }
      await ctx.congelarPartida(ex, r.clientId, a.nome, operationKey);
      const agora = new Date().toISOString();
      // O servidor REFAZ o lançamento (createPaymentRecord), o preço escolhido na tela e a duplicidade com os dados reais e grava o resultado DELE.
      const reg = estrito() ? refazer.refazerLancamento(r, a, agora, await contextoDoLancamento(ex, r.clientId)) : v.carimbarNovo(r, a, agora);
      delete reg.serviceFollowUp; // acompanhamento nasce depois do recebimento, por revisão
      const { id: _id, ...resto } = reg;
      // Legado primeiro (flag GF_LEGADO_PAGAMENTOS): o INSERT em tbl_pagtoinformado vem ANTES de gravar aqui; canal sem casa no legado fica só no Postgres, marcado.
      const legado = await espelho.lancamento(ex, reg, a.nome, operationKey);
      await ex.execute(`INSERT INTO gf_pagamentos (${COLUNAS_INSERT}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, [reg.id, reg.clientId, reg.status, reg.confirmation ?? null, Math.round(reg.amount * 100), reg.method, reg.linkedConsultationId ?? null, reg.informedAt, JSON.stringify(resto), a.nome, operationKey]);
      await espelho.marcar(ex, reg.id, legado);
      await inserirEvento(ex, reg.id, 'lancamento', a, { clientId: reg.clientId, amountCents: Math.round(reg.amount * 100), status: reg.status }, 1, operationKey);
      return { antes: null, depois: { clientId: reg.clientId, amountCents: Math.round(reg.amount * 100), status: reg.status }, resposta: { readAt: agora, items: [reg], versions: { [reg.id]: 1 } } };
    },
  });
}

/** `POST /payments/:id/revise`: `{ operationKey, expectedVersion, record }`. */
async function revisar(req) {
  const a = f.ator(req, { permissao: 'canManageConsultations', escrita: true });
  const id = f.idRegistro(req.params.id);
  const b = req.body;
  if (!f.ehObjeto(b)) throw f.invalido('corpo');
  const operationKey = f.chaveOperacao(b.operationKey);
  const expectedVersion = f.revisao(b.expectedVersion);
  const pedido = v.forma(b.record);
  if (pedido.id !== id) throw f.invalido('record.id');
  return f.gravar(req, {
    escopo: 'pagamentos.revisar', operationKey, corpo: { id, expectedVersion, record: pedido }, entidade: 'pagamento', entidadeId: id, acao: 'pagamentos.revisar',
    producao: async (ex) => {
      const [linhas] = await ex.execute('SELECT id, item, version, id_cliente, legado_id, legado_estado FROM gf_pagamentos WHERE id = ? FOR UPDATE', [id]);
      if (!linhas[0]) throw f.naoEncontrado();
      if (Number(linhas[0].version) !== expectedVersion) throw f.conflitoVersao(COPIA_VERSAO);
      const antes = comoItem(linhas[0]);
      const agora = new Date().toISOString();
      // O servidor REFAZ a operação do front (movimento corrigido, ocorrência, transferência...) com o contexto real e grava o resultado DELE.
      let reg; let refeito = null;
      const familia = estrito() ? refazer.reconhece(antes, pedido) : null;
      if (familia) refeito = refazer.refazerRevisao(antes, pedido, a, agora, await contextoParaRefazer(ex, familia, antes, pedido, agora, verificarCliente), familia);
      if (refeito) reg = refeito.registro; else reg = v.carimbarRevisao(antes, pedido, a, agora);
      // `serviceFollowUp` é do servidor (Maturacao/39): o navegador só acrescenta um evento; ator e instante são os daqui.
      try { const seguimento = acompanhamento.conferirAcompanhamento(antes, pedido, a.nome, Date.parse(agora)); if (seguimento) reg.serviceFollowUp = seguimento; else delete reg.serviceFollowUp; } catch (e) { if (e instanceof acompanhamento.RegraDePagamentoError) throw f.regra(e.message); throw e; }
      if (reg.clientId !== antes.clientId) {
        if (!(await verificarCliente(reg.clientId))) throw naoExiste();
        await ctx.congelarPartida(ex, reg.clientId, a.nome, operationKey);
      }
      if (reg.linkedConsultationId && reg.linkedConsultationId !== antes.linkedConsultationId) {
        const [consulta] = await ex.execute('SELECT id_cliente FROM gf_consultas_ext WHERE id = ?', [reg.linkedConsultationId]);
        if (consulta[0] && consulta[0].id_cliente !== reg.clientId) throw f.regra('Esta consulta pertence a outra cliente.');
      }
      const versao = expectedVersion + 1;
      const { id: _semId, ...semId } = reg;
      await ex.execute('UPDATE gf_pagamentos SET id_cliente = ?, status = ?, confirmacao = ?, valor_centavos = ?, metodo = ?, id_consulta = ?, informado_em = ?, item = ?, version = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?',
        [reg.clientId, reg.status, reg.confirmation ?? null, Math.round(reg.amount * 100), reg.method, reg.linkedConsultationId ?? null, reg.informedAt, JSON.stringify(semId), versao, id]);
      const doLegado = await espelho.revisao(ex, linhas[0], antes, reg, operationKey);
      if (doLegado) await espelho.marcar(ex, id, doLegado);
      // O tipo do evento é um dos 7 do CHECK; o detalhe (movimento-corrigido, ocorrencia-registrar, transferencia-saldo, planilha-minutes...) vai em `dados.tipo`.
      const tipo = refeito ? refeito.tipo : v.classificar(antes, reg);
      const tipoDoEvento = refeito ? (/^(movimento|ocorrencia|transferencia)/.test(tipo) ? 'movimento' : 'correcao') : tipo;
      await inserirEvento(ex, id, tipoDoEvento, a, { tipo, status: reg.status, amountCents: Math.round(reg.amount * 100) }, versao, operationKey);
      return { antes: { version: expectedVersion, status: antes.status, amountCents: Math.round(antes.amount * 100) }, depois: { version: versao, status: reg.status, amountCents: Math.round(reg.amount * 100), tipo }, resposta: { readAt: agora, items: [reg], versions: { [id]: versao } } };
    },
  });
}

/** `POST /payments/benefits`: `{ operationKey, benefit }` (Bônus ou Cortesia concedido à cliente; só acrescenta). */
async function conceder(req) {
  const a = f.ator(req, { permissao: 'canManageConsultations', escrita: true });
  const b = req.body;
  if (!f.ehObjeto(b)) throw f.invalido('corpo');
  const operationKey = f.chaveOperacao(b.operationKey);
  const g = v.beneficio(b.benefit);
  if (!(await verificarCliente(g.clientId))) throw naoExiste();
  return f.gravar(req, {
    escopo: 'pagamentos.beneficio', operationKey, corpo: { benefit: g }, entidade: 'beneficio', entidadeId: g.id, acao: 'pagamentos.beneficio',
    producao: async (ex) => {
      const [existe] = await ex.execute('SELECT id FROM gf_beneficios_minutos WHERE id = ?', [g.id]);
      if (existe[0]) throw f.conflitoVersao('Este benefício já foi lançado.');
      await ctx.congelarPartida(ex, g.clientId, a.nome, operationKey);
      const agora = new Date().toISOString();
      const reg = { ...g, grantedBy: a.nome, grantedAt: agora, payTarologist: true };
      const { id: _id, ...resto } = reg;
      await ex.execute('INSERT INTO gf_beneficios_minutos (id, id_cliente, tipo, minutos, item, concedido_em, concedido_por, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [reg.id, reg.clientId, reg.kind, reg.minutes, JSON.stringify(resto), agora, a.nome, operationKey]);
      return { antes: null, depois: { clientId: reg.clientId, kind: reg.kind, minutes: reg.minutes }, resposta: { readAt: agora, benefit: reg } };
    },
  });
}

/** `GET /payments/accounts?ids=1,2`: saldo, crédito e cobertura (domínio portado) de até 30 clientes, mais nome e Pré/Pós. */
async function contas(req) {
  f.ator(req, { permissao: 'canViewRecentPayments' });
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const ids = [...new Set(`${(req.query && req.query.ids) || ''}`.split(',').map((s) => s.trim()).filter(Boolean))];
  if (!ids.length || ids.length > 30) throw f.invalido('ids');
  ids.forEach((id) => f.idCliente(id, 'ids'));
  const vivas = await ctx.clientesDaConta(ids);
  const saida = {};
  const agora = new Date().toISOString();
  await lendoNovo(async (m) => {
    const exts = await m.GfClientesExt.findAll({ where: { id_cliente: ids } });
    const perfis = new Map(exts.map((e) => [e.id_cliente, e.perfil_pagamento || '']));
    // Nome de identificação editado na ficha (Maturacao/32) vence o do legado; sem edição, vale o do legado.
    const nomes = new Map(exts.map((e) => { const d = dadosEfetivosDoCliente(e); return [e.id_cliente, typeof d.name === 'string' ? d.name.trim() : '']; }));
    for (const id of ids) {
      const viva = vivas.get(id);
      if (!viva) continue;
      const contexto = await ctx.carregar(ctx.porModelos(m), id, { perfilPagamento: perfis.get(id) || '' });
      // A3: o histórico do ASP (consulta ou pagamento anterior) decide a tabela de "primeira consulta"; o front lê estes dois campos do perfil.
      const { hasPriorConsultations, firstConsultationAt } = contexto.profile;
      saida[id] = { name: nomes.get(id) || viva.nome, paymentProfile: contexto.profile.paymentProfile || '', openingKnown: viva.conhecido, hasPriorConsultations: hasPriorConsultations === true, ...(firstConsultationAt ? { firstConsultationAt } : {}), ...ctx.resumir(contexto, agora) };
    }
  });
  return { readAt: agora, accounts: saida };
}

module.exports = { ler, lancar, revisar, conceder, contas, definirVerificadorDeCliente };
