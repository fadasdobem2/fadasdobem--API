'use strict';

/**
 * Regras da fatia Consulta (Maturacao/28 seção 4; domínio em `_comum/dominio/consulta-*.js`):
 *   - leitura: equipe (`canViewConsultations`) lê tudo; a taróloga só as suas, SEM observação interna, cobrança nem auditoria;
 *   - gravação: lançar, iniciar pela equipe, término pela equipe e revisões são da equipe (`canManageConsultations`); iniciar, pausar,
 *     retomar e informar o término são da taróloga dona; revisões da taróloga: devolver, pedir correção do término e pedir mais tempo;
 *   - o servidor RECALCULA o que depende do relógio (início, pausa, retomada, término informado) com o instante dele, captura a
 *     comissão no lançamento e garante que o tarólogo encerra UMA vez; as demais revisões são conferidas (`consulta-revisao.js`);
 *   - idempotência por `operationKey` (gf_operacoes), concorrência por `expectedVersion` (409 VERSION_CHANGED), auditoria em
 *     gf_auditoria e evento em gf_consultas_eventos na MESMA transação;
 *   - o MySQL legado é LIDO (a cliente existe); o espelho em `tbl_consultas` é opcional e fica em ciclo.espelho.js (desligado por padrão).
 */

const AppError = require('../../../utils/AppError');
const { hojeOperacional } = require('../../_comum/dia-operacional');
const dom = require('../../_comum/dominio/consulta-comum');
const sessao = require('../../_comum/dominio/consulta-sessao');
const revisao = require('../../_comum/dominio/consulta-revisao');
const { novosDadosNoPostgres } = require('../../novo/modo');
const { lendoNovo } = require('../../novo/leitura');
const comum = require('./ciclo.comum');
const validar = require('./ciclo.validacao');
const store = require('./ciclo.store');
const resposta = require('./ciclo.resposta');
const agenda = require('./ciclo.agenda');
const espelho = require('./ciclo.espelho');
const financeiro = require('./ciclo.financeiro');
const { montarLancamento, HISTORICOS } = require('./ciclo.lancamento');
const correcao = require('./ciclo.correcao');
const refazer = require('./ciclo.refazer');
const edicao = require('./ciclo.edicao');
const regrasDeInicio = require('./ciclo.regras-inicio');
const autorizacao = require('./ciclo.autorizacao');

/** Quem confere se a cliente existe no legado (só leitura). Trocável nos testes, onde o legado não está configurado. */
let verificarCliente = async (clientId) => require('../clientes/clientes.service').clienteExiste(clientId);
const definirVerificadorDeCliente = (fn) => { verificarCliente = fn; };

const somarDias = (data, n) => new Date(Date.parse(`${data}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const evento = (a, tipo, ref, dados, versao, operationKey, idConsulta) => ({ idConsulta, tipo, ref, a, dados, versao, operationKey });

/** `GET /consultations`: abertas de qualquer data, mais as do dia e das últimas 24 h (ou desde `from`). */
async function ler(req) {
  const a = comum.ator(req, {});
  if (!novosDadosNoPostgres()) throw comum.indisponivel();
  const q = validar.consulta(req.query || {});
  const hoje = hojeOperacional();
  const tarologa = a.perfil === 'tarologa';
  if (tarologa && !a.tarotIdProprio) throw comum.negado(false);
  const registros = await lendoNovo((m) => store.lerRegistros(m, { desde: q.de || somarDias(hoje, -1), tarotId: tarologa ? a.tarotIdProprio : q.tarotId, clientId: q.clientId, incluirEncerradas: q.incluirEncerradas }));
  return resposta.leitura(registros, { tarologa, hoje });
}

/** Carrega a consulta travada e confere o recorte: a taróloga só mexe na dela. */
async function carregar(ex, id, a, { soDona = false } = {}) {
  const reg = await store.travar(ex, id);
  if (!reg) throw comum.naoEncontrado();
  if (a.perfil === 'tarologa' && (!a.tarotIdProprio || a.tarotIdProprio !== reg.item.tarotId)) throw comum.negado(true, 'Esta consulta não pertence ao seu perfil.');
  if (soDona && a.perfil !== 'tarologa') throw comum.negado(true);
  return reg;
}

/** Grava o item novo (+ evento + espelho) e devolve a resposta. `agendaRegs`: agendamentos que a consulta resolveu. */
async function salvar(ex, a, antes, item, { tipo, ref, dados, operationKey, agendaRegs = [], espelhar }) {
  const versao = antes.version + 1;
  await store.atualizar(ex, item, versao);
  await store.inserirEvento(ex, evento(a, tipo, ref, dados || {}, versao, operationKey, item.id));
  if (espelhar) await espelho.agendar(ex, { id: item.id, momento: espelhar, item });
  return { item, version: versao, agendaRegs };
}

/** Comando que o servidor recalcula com o relógio dele: `transicao(item, agora, ex)` devolve o item novo. */
async function recalculado(req, { acao, tipo, soDona, soEquipe, validarCorpo, transicao, depois, espelhar, comFinanceiro, antes }) {
  const a = comum.ator(req, { escrita: true, soEquipe });
  const id = validar.idConsulta(req.params.id);
  const c = validarCorpo(req.body);
  return comum.gravar(req, a, {
    escopo: `consulta.${acao}`, operationKey: c.operationKey, corpo: { ...c, id }, acao: `consulta.${acao}`,
    producao: async (ex) => {
      const pre = await carregar(ex, id, a, { soDona });
      await store.travarOcupacao(ex, pre.item.tarotId, pre.item.clientId);
      const reg = await store.travar(ex, id);
      const agora = new Date().toISOString();
      const outras = (await store.abertasDe(ex, reg.item.tarotId, reg.item.clientId)).map((r) => r.item);
      if (antes) await antes(ex, reg.item);
      // Fatia Pagamentos ligada: o excesso sobre o máximo é conferido contra o saldo real da cliente (ciclo.financeiro.js).
      const fin = comFinanceiro ? await financeiro.contexto(ex, reg.item) : undefined;
      const item = transicao({ item: reg.item, a, c, agora, outras, fin });
      const agendaRegs = depois ? await depois(ex, item, a, c.operationKey) : [];
      const r = await salvar(ex, a, reg, item, { tipo, ref: item.audit.length ? item.audit[item.audit.length - 1].id : null, dados: { status: item.status }, operationKey: c.operationKey, agendaRegs, espelhar });
      return { entidadeId: id, antes: { version: reg.version, status: reg.item.status }, depois: { version: r.version, status: item.status }, resposta: resposta.gravacao([r], agendaRegs, { tarologa: a.perfil === 'tarologa' }) };
    },
  });
}

const identidadeTarologa = (a, item) => ({ tarotId: a.perfil === 'tarologa' ? a.tarotIdProprio : item.tarotId, nome: a.nome });

const iniciar = (req) => recalculado(req, {
  acao: 'iniciar', tipo: 'inicio', validarCorpo: validar.corpoSimples, espelhar: 'inicio',
  // Reserva de continuação, turno confirmado e (equipe) as mesmas regras do lançamento: `ciclo.regras-inicio.js`.
  antes: (ex, item) => regrasDeInicio.conferir(ex, { acao: 'iniciar', tarotId: item.tarotId, clientId: item.clientId, consultaId: item.id, origemId: item.continuation && item.continuation.sourceConsultationId }),
  transicao: ({ item, a, agora, outras }) => {
    const { tarotId, nome } = identidadeTarologa(a, item);
    return a.perfil === 'tarologa' ? sessao.iniciar(item, tarotId, nome, agora, outras) : sessao.iniciarPelaEquipe(item, item.tarotId, nome, agora, outras);
  },
  depois: (ex, item, a, chave) => agenda.resolver(ex, item, 'iniciou', a, chave),
});

const pausar = (req) => recalculado(req, {
  acao: 'pausar', tipo: 'pausa', validarCorpo: validar.corpoSimples,
  transicao: ({ item, a, agora }) => dom.pausar(item, a.nome, agora, { perfil: a.perfil, equipe: a.equipe, tarotIdProprio: a.tarotIdProprio }),
});

const retomar = (req) => recalculado(req, {
  acao: 'retomar', tipo: 'retomada', validarCorpo: validar.corpoSimples,
  transicao: ({ item, a, agora }) => {
    if (a.perfil === 'tarologa' && a.tarotIdProprio !== item.tarotId) throw new dom.RegraConsultaError('Esta consulta não pertence ao seu perfil.');
    return dom.retomar(item, a.nome, agora);
  },
});

/** Término informado pela taróloga dona: relógio do servidor, "encerra uma vez". */
const informarTermino = (req) => recalculado(req, {
  acao: 'termino', tipo: 'termino', soDona: true, validarCorpo: validar.corpoTermino, espelhar: 'termino', comFinanceiro: true,
  transicao: ({ item, a, c, agora, fin }) => sessao.informarTermino(item, c.minutes, a.tarotIdProprio, a.nome, agora, c.clientWantsMoreTime, c.earlyFinish, { timingConfirmed: c.timingConfirmed, timeEntry: c.timeEntry, finance: fin }),
  depois: (ex, item, a, chave) => agenda.resolver(ex, item, 'terminou', a, chave),
});

/** Término pela equipe: encerra a operação e libera o tarólogo, com o mesmo relato. */
const informarTerminoPelaEquipe = (req) => recalculado(req, {
  acao: 'termino-equipe', tipo: 'termino', soEquipe: true, validarCorpo: validar.corpoTermino, espelhar: 'termino', comFinanceiro: true,
  transicao: ({ item, a, c, agora, fin }) => sessao.informarTerminoPelaEquipe(item, c.minutes, a.nome, agora, fin),
  depois: (ex, item, a, chave) => agenda.resolver(ex, item, 'terminou', a, chave),
});

/** A taróloga devolve a PRÓPRIA consulta ("Devolvida", sem repasse); o tempo registrado é o do relógio do servidor. */
const devolver = (req) => recalculado(req, {
  acao: 'devolver', tipo: 'desfecho', soDona: true, validarCorpo: validar.corpoDevolucao, espelhar: 'desfecho',
  transicao: ({ item, a, c, agora }) => sessao.devolverPelaTarologa(item, { reason: c.reason, note: c.note }, a.tarotIdProprio, a.nome, agora, dom.duracaoNoInstante(item, Date.parse(agora))),
  depois: (ex, item, a, chave) => agenda.resolver(ex, item, 'terminou', a, chave),
});

/** A taróloga pede mais tempo (a conta é da própria consulta, sem tocar no relógio nem na cobrança). */
const pedirMaisTempo = (req) => recalculado(req, {
  acao: 'mais-tempo', tipo: 'mais_tempo', soDona: true, validarCorpo: validar.corpoSimples,
  transicao: ({ item, a, agora }) => sessao.pedirMaisTempo(item, a.tarotIdProprio, a.nome, agora),
});

/** A taróloga pede UMA correção do tempo informado; a conferência é da equipe. */
const pedirCorrecao = (req) => recalculado(req, {
  acao: 'correcao', tipo: 'correcao', soDona: true, validarCorpo: validar.corpoCorrecao,
  transicao: ({ item, a, c, agora }) => sessao.pedirCorrecao(item, c.minutes, c.reason, a.tarotIdProprio, a.nome, agora),
});

/** `POST /consultations`: lança. Instante, comissão, estado inicial e autor são do servidor. */
async function lancar(req) {
  const a = comum.ator(req, { escrita: true, soEquipe: true });
  const c = validar.corpoLancar(req.body);
  if (!(await verificarCliente(c.record.clientId))) throw new AppError('Cadastro de cliente não encontrado.', 404, { codigo: 'CLIENT_NOT_FOUND' }, true);
  return comum.gravar(req, a, {
    escopo: 'consulta.lancar', operationKey: c.operationKey, corpo: c, acao: 'consulta.lancar',
    producao: async (ex) => {
      const r = c.record;
      await store.travarOcupacao(ex, r.tarotId, r.clientId);
      // Cliente que exige autorização da supervisora não ganha consulta ao vivo sem ela (Maturacao/38; o histórico `Concluída` fica de fora, como no front).
      if (r.status !== 'Concluída') await autorizacao.conferir(ex, r.clientId);
      if (await store.travar(ex, r.id)) throw comum.conflitoVersao('Esta consulta já existe.');
      const abertas = (await store.abertasDe(ex, r.tarotId, r.clientId)).map((x) => x.item);
      const origem = r.continuation ? (await store.travar(ex, r.continuation.sourceConsultationId)) : null;
      const origemCobertura = r.coverage && r.coverage.kind === 'Complemento' && r.coverage.sourceConsultationId ? await store.travar(ex, r.coverage.sourceConsultationId) : null;
      const taxa = await store.percentualVigente(ex, r.tarotId);
      await regrasDeInicio.conferir(ex, { acao: 'lancar', tarotId: r.tarotId, clientId: r.clientId, agendaItemId: r.agendaItemId, origemId: (r.continuation && r.continuation.sourceConsultationId) || (r.coverage && r.coverage.kind === 'Complemento' ? r.coverage.sourceConsultationId : undefined), consultaId: r.id, historico: HISTORICOS.has(r.status), aprovacao: r.occupancyOverride });
      const item = montarLancamento(r, { a, agora: new Date().toISOString(), abertas, origem: origem && origem.item, taxa, origemCobertura: origemCobertura && origemCobertura.item });
      await store.inserir(ex, item, a.nome, c.operationKey);
      const reg = { item, version: 1 };
      await store.inserirEvento(ex, evento(a, 'lancamento', item.audit[0].id, { tarotId: item.tarotId, clientId: item.clientId, status: item.status }, 1, c.operationKey, item.id));
      const agendaRegs = item.awaitingTarologistStart === false && item.status === 'Em curso' ? await agenda.resolver(ex, item, 'iniciou', a, c.operationKey) : [];
      await espelho.agendar(ex, { id: item.id, momento: 'lancamento', item });
      return { entidadeId: item.id, antes: null, depois: { tarotId: item.tarotId, clientId: item.clientId, commissionRate: item.commissionRate }, resposta: resposta.gravacao([reg], agendaRegs) };
    },
  });
}

/** `POST /:id/revise`: conferência, correção de tempo, desfechos, revisão de cancelamento, compensação, mais tempo e edição. */
async function revisar(req) {
  const a = comum.ator(req, { escrita: true, soEquipe: true });
  const id = validar.idConsulta(req.params.id);
  const c = validar.corpoRevisao(req.body);
  return comum.gravar(req, a, {
    escopo: 'consulta.revisar', operationKey: c.operationKey, corpo: { ...c, id }, acao: 'consulta.revisar',
    producao: async (ex) => {
      const reg = await carregar(ex, id, a);
      if (reg.item.updatedAt !== c.expectedVersion) throw comum.conflitoVersao();
      const agora = new Date().toISOString();
      const pedido = { ...c.record, id };
      const kind = revisao.classificar(reg.item, pedido);
      revisao.conferir(kind, reg.item, pedido, a);
      // O servidor recalcula o que é dele; do resto, mantém o registro conferido com o horário e o autor dos eventos novos carimbados.
      // Correção de tempo (`readerCorrection`): o servidor refaz o cálculo com o saldo real e grava o resultado dele.
      // Os demais comandos da conferência (encerramento, desfechos, bônus) também: `ciclo.refazer.js` (Maturacao/38).
      const novo = await refazer.refazer(ex, { a, antes: reg.item, pedido, versao: c.expectedVersion, agora });
      const refeito = novo ? novo.item : (kind === 'correcao-tempo' ? await correcao.refazer(ex, reg.item, pedido, c.expectedVersion, agora) : null);
      // Edição de dados: o que o front confere em `saveForm` (consulta com queixa, horário, bônus, saldo, continuação, autorização e ocupação).
      if (kind === 'edicao' && !novo) await edicao.conferir(ex, { a, antes: reg.item, pedido, agora });
      let item = carimbar(reg.item, refeito || pedido, agora, a);
      if (item.status === 'Em curso') item = { ...item, durationSeconds: reg.item.durationSeconds };
      const agendaRegs = item.status !== reg.item.status && item.status !== 'Em curso' && !item.tarologistFinishReport ? await agenda.resolver(ex, item, 'terminou', a, c.operationKey) : [];
      const tipo = { desfecho: 'desfecho', conferencia: 'conferencia', 'correcao-tempo': 'correcao', 'correcao-recusada': 'correcao', 'revisao-cancelamento': 'revisao', 'decisao-cancelamento': 'revisao', compensacao: 'compensacao', reabertura: 'reabertura', 'mais-tempo': 'mais_tempo', edicao: 'edicao' }[kind];
      const novos = item.audit.slice(reg.item.audit.length);
      // Fatia Pagamentos ligada: a conferência guarda o retrato do saldo real (débito x disponível); não bloqueia, a decisão de cobrar é da equipe.
      const cobertura = ['conferencia', 'correcao-tempo'].includes(kind) ? await financeiro.retrato(ex, item, agora) : undefined;
      const r = await salvar(ex, a, reg, item, { tipo, ref: novos.length ? novos[novos.length - 1].id : null, dados: { kind, status: item.status, ...(cobertura ? { cobertura } : {}) }, operationKey: c.operationKey, agendaRegs, espelhar: ['desfecho', 'correcao', 'conferencia', 'revisao', 'compensacao'].includes(tipo) ? tipo : null });
      return { entidadeId: id, antes: { version: reg.version, status: reg.item.status }, depois: { version: r.version, status: item.status, kind }, resposta: resposta.gravacao([r], agendaRegs) };
    },
  });
}

/** Mantém o registro conferido e carimba o instante e o autor do servidor nos eventos novos e no `updatedAt`. */
function carimbar(antes, pedido, agora, a) {
  const novos = pedido.audit.slice(antes.audit.length).map((e) => ({ ...e, createdAt: agora, actor: e.actor && String(e.actor).trim() ? e.actor : a.nome }));
  return { ...instantesDoEvento(antes, pedido, agora), audit: [...pedido.audit.slice(0, antes.audit.length), ...novos], updatedAt: agora };
}

const mesmoValor = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
/**
 * O INSTANTE de cada evento novo da consulta é do servidor (Maturacao/35): conferência (`finishReview.at`), correção (`readerCorrection.at`),
 * revisão e decisão do cancelamento, revisão financeira. Só o que MUDOU em relação ao guardado; o que o navegador deixou igual fica.
 * Dado do usuário (horário de fim informado, minutos) não é carimbado.
 */
function instantesDoEvento(antes, pedido, agora) {
  const r = { ...pedido };
  const novo = (campo) => r[campo] && !mesmoValor(antes[campo], r[campo]);
  if (novo('finishReview')) r.finishReview = { ...r.finishReview, at: agora };
  if (novo('readerCorrection')) r.readerCorrection = { ...r.readerCorrection, at: agora };
  if (novo('cancellationReview')) {
    const c = r.cancellationReview; const a = antes.cancellationReview;
    r.cancellationReview = { ...c, ...(!a ? { requestedAt: agora } : {}), ...(c.decidedAt && (!a || a.decidedAt !== c.decidedAt) ? { decidedAt: agora } : {}) };
  }
  if (novo('financialReview')) {
    const h0 = (antes.financialReview && antes.financialReview.history && antes.financialReview.history.length) || 0;
    r.financialReview = { ...r.financialReview, at: agora, history: (r.financialReview.history || []).map((e, i) => (i < h0 ? e : { ...e, at: agora })) };
  }
  return r;
}

module.exports = { ler, lancar, iniciar, pausar, retomar, informarTermino, informarTerminoPelaEquipe, devolver, pedirMaisTempo, pedirCorrecao, revisar, definirVerificadorDeCliente, carimbar };
