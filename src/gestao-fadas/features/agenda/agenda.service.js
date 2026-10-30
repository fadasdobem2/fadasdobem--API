'use strict';

/**
 * Regras da fatia Agenda (Maturacao/28 seção 2; domínio em `_comum/dominio/agenda-*.js`):
 *   - leitura: `canViewAgenda` (equipe); gravação: `canManageConsultations` (equipe). A taróloga fica fora desta fatia;
 *   - idempotência por `operationKey` (gf_operacoes), concorrência por `expectedVersion` do agendamento (409 VERSION_CHANGED) mais
 *     `expectedContact` e `expectedLatestId` onde o front os tem; auditoria em gf_auditoria e evento em gf_agenda_eventos na MESMA transação;
 *   - o MySQL legado só é LIDO (a cliente existe); nada é gravado nele.
 */

const AppError = require('../../../utils/AppError');
const { hojeOperacional } = require('../../_comum/dia-operacional');
const { proximaPosicao } = require('../../_comum/dominio/agenda-contato');
const { aplicarDelta } = require('../../_comum/dominio/agenda-delta');
const { ErroDeRegra, ErroDeVersao } = require('../../_comum/dominio/agenda-regras');
const { novosDadosNoPostgres } = require('../../novo/modo');
const { lendoNovo } = require('../../novo/leitura');
const comum = require('./agenda.comum');
const validar = require('./agenda.validacao');
const store = require('./agenda.store');
const resposta = require('./agenda.resposta');
const admissao = require('./agenda-admissao.service');
const painel = require('../../_comum/dominio/painel-validacao');
const painelContexto = require('./agenda-painel.contexto');
const FILA_GERAL = 'afila';

const somarDias = (data, n) => new Date(Date.parse(`${data}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const AGENDA_VERSAO = 'Este agendamento mudou. Feche e abra novamente para conferir.'; // texto do front (agenda-experience.tsx:1171)

/** Quem confere se a cliente existe no legado (só leitura). Trocável nos testes, onde o legado não está configurado. */
let verificarCliente = async (clientId) => {
  const { clienteExiste } = require('../clientes/clientes.service');
  return clienteExiste(clientId);
};
const definirVerificadorDeCliente = (fn) => { verificarCliente = fn; };

/** Erro do domínio -> erro HTTP: regra vira 422 com a mensagem do front, versão vira 409. */
function traduzir(erro) {
  if (erro instanceof ErroDeRegra) return comum.regra(erro.message);
  if (erro instanceof ErroDeVersao) return comum.conflitoVersao(AGENDA_VERSAO);
  return erro;
}

/** `GET /agenda`: abertos de qualquer data mais os encerrados dos últimos 7 dias (ou do intervalo pedido). */
async function ler(req) {
  comum.ator(req, false);
  if (!novosDadosNoPostgres()) throw comum.indisponivel();
  const q = validar.consulta(req.query || {});
  const hoje = hojeOperacional();
  const registros = await lendoNovo((m) => store.lerItens(m, { desde: q.de || somarDias(hoje, -7), ate: q.ate, tarotId: q.tarotId, incluirEncerrados: q.incluirEncerrados }));
  return resposta.leitura(registros, hoje, await admissao.paraOPainel());
}

/** `POST /agenda`: cria o agendamento. O servidor dá o número público, a posição, quem criou e quando. */
async function criar(req) {
  const a = comum.ator(req, true);
  const c = validar.corpoCriacao(req.body);
  if (!(await verificarCliente(c.clientId))) throw new AppError('Cadastro de cliente não encontrado.', 404, { codigo: 'CLIENT_NOT_FOUND' }, true);
  return comum.gravar(req, a, {
    escopo: 'agenda.criar', operationKey: c.operationKey, corpo: c, acao: 'agenda.criar',
    producao: async (ex) => {
      await store.travarFila(ex, c.tarotId);
      if (await store.travar(ex, c.id)) throw comum.conflitoVersao('Este agendamento já existe.');
      const abertos = await store.abertosDe(ex, [c.tarotId]);
      const agora = new Date().toISOString();
      const numero = await store.proximoNumero(ex);
      const base = {
        id: c.id, publicNumber: numero, tarotId: c.tarotId, clientId: c.clientId, client: c.client, date: c.date, createdAt: agora, createdBy: a.nome,
        response: 'Aguardando resposta', contact: { attempt: 1, date: c.date, tags: [] }, paymentPending: false,
        position: proximaPosicao(abertos, c.tarotId, c.date, hojeOperacional()),
      };
      let r;
      try { r = aplicarDelta(base, { set: c.set, unset: c.unset, append: c.append }, 'agendamento', a); } catch (e) { throw traduzir(e); }
      const item = { ...r.item, position: base.position };
      await store.inserir(ex, item, numero, a.nome, c.operationKey);
      await store.inserirEvento(ex, { idAgenda: item.id, tipo: 'criacao', ref: null, a, dados: { tarotId: item.tarotId, clientId: item.clientId, date: item.date }, versao: 1, operationKey: c.operationKey });
      for (const e of r.eventos) await store.inserirEvento(ex, { idAgenda: item.id, tipo: e.tipo, ref: e.ref, a, dados: e.dados, versao: 1, operationKey: c.operationKey });
      const fila = await store.abertosDe(ex, [item.tarotId]);
      return { entidadeId: item.id, antes: null, depois: { tarotId: item.tarotId, clientId: item.clientId, date: item.date, publicNumber: numero }, resposta: resposta.gravacao([{ item, version: 1 }], fila, [item.tarotId]) };
    },
  });
}

/** Comando sobre um agendamento existente (contato, observações, saídas, prazo, resolução ou edição do agendamento). */
async function comando(req, grupo) {
  const a = comum.ator(req, true);
  const id = validar.idItem(req.params.id);
  const c = validar.corpoComando(req.body);
  return comum.gravar(req, a, {
    escopo: `agenda.${grupo}`, operationKey: c.operationKey, corpo: { ...c, id }, acao: `agenda.${grupo}`,
    producao: async (ex) => {
      const pre = await store.travar(ex, id);
      if (!pre) throw comum.naoEncontrado();
      // Trava a fila do tarólogo de antes e a do de depois (ordem estável, sem impasse) e relê o agendamento já sob o trava.
      const alvo = c.set && typeof c.set.tarotId === 'string' ? c.set.tarotId : pre.item.tarotId;
      for (const t of [...new Set([pre.item.tarotId, alvo])].sort()) await store.travarFila(ex, t);
      const atual = await store.travar(ex, id);
      if (atual.version !== c.expectedVersion) throw comum.conflitoVersao(AGENDA_VERSAO);
      let r;
      try { r = aplicarDelta(atual.item, c, grupo, a); } catch (e) { throw traduzir(e); }
      let item = r.item;
      // Agendar a cliente da FILA GERAL para uma taróloga (`scheduleGeneralMatch`): o front roda `validateGeneralScheduling` (Maturacao/39).
      if (grupo === 'agendamento' && atual.item.tarotId === FILA_GERAL && item.tarotId !== FILA_GERAL) {
        const entrada = await painelContexto.carregarEntrada(ex, { tarotId: item.tarotId, agora: Date.now() });
        try { painel.validarAgendamento(entrada, id, item.tarotId, item.date || entrada.date, item.scheduledTime); } catch (e) { if (e instanceof painel.RegraDoPainelError) throw comum.regra(e.message); throw e; }
      }
      if (item.tarotId !== atual.item.tarotId && (c.set.position === undefined)) {
        item = { ...item, position: proximaPosicao(await store.abertosDe(ex, [item.tarotId]), item.tarotId, item.date || hojeOperacional(), hojeOperacional()) };
      }
      const versao = atual.version + 1;
      await store.atualizar(ex, item, versao);
      for (const e of r.eventos) await store.inserirEvento(ex, { idAgenda: id, tipo: e.tipo, ref: e.ref, a, dados: e.dados, versao, operationKey: c.operationKey });
      const filas = [...new Set([atual.item.tarotId, item.tarotId])];
      const abertos = await store.abertosDe(ex, filas);
      return {
        entidadeId: id, antes: { version: atual.version, tarotId: atual.item.tarotId, agendaOutcome: atual.item.agendaOutcome }, depois: { version: versao, grupo, eventos: r.eventos.map((e) => e.ref).filter(Boolean) },
        resposta: resposta.gravacao([{ item, version: versao }], abertos, filas),
      };
    },
  });
}

module.exports = { ler, criar, comando, definirVerificadorDeCliente };
