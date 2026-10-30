'use strict';

/**
 * Admissão do turno e solicitações de consulta (Maturacao/29 seção 11; hoje só no navegador, `agenda-intake-context.tsx`).
 *   - `AgendaIntakeEvent` (`gf_agenda_admissoes`, só acrescenta): "Fechar agenda" deste turno ou por hoje, e "Reabrir agenda". O servidor
 *     recalcula o que é dele: dia operacional, instante do evento, fim do fechamento por hoje (06h do dia seguinte), agendamentos já
 *     na fila (`agendaIds`) e consultas já feitas (`consultationIds`). Do navegador só vêm o id, o tarólogo, o modo, o escopo e (turno) o fim.
 *   - `AgendaConsultationRequest` (`gf_agenda_solicitacoes`): a taróloga avisa "cliente quer consulta" (só a própria), a equipe resolve
 *     ao agendar (`agendaId`, `resolvedAt`, `resolvedBy` do servidor). Pedido repetido da mesma cliente e taróloga sem agenda é o mesmo pedido.
 * Leitura: equipe (`canViewAgenda`). Gravação: fechar/reabrir e resolver são da equipe (`canManageConsultations`); pedir é da taróloga.
 * Idempotência por `operationKey`, auditoria e `gf_operacoes` na MESMA transação.
 */

const AppError = require('../../../utils/AppError');
const { hojeOperacional } = require('../../_comum/dia-operacional');
const { novosDadosNoPostgres } = require('../../novo/modo');
const { lendoNovo } = require('../../novo/leitura');
const { somarDias } = require('../../_comum/dominio/horarios');
const { ativoNoDia, encerrado } = require('../../_comum/dominio/agenda-contato');
const { contaMinutos, retemCoberturaDeCancelamento } = require('../../_comum/dominio/financeiro-base');
const comum = require('./agenda.comum');
const validar = require('./agenda.validacao');
const store = require('./agenda.store');
const adm = require('./agenda-admissao.store');
const ciclo = require('../consultas-ciclo/ciclo.store');

const invalido = (c) => new AppError('Dados inválidos.', 400, { codigo: 'INVALID_INPUT', campo: c }, true);
const ehObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
let verificarCliente = async (id) => require('../clientes/clientes.service').clienteExiste(id);
const definirVerificadorDeCliente = (fn) => { verificarCliente = fn; };

const versoes = (itens, v = 1) => Object.fromEntries(itens.map((i) => [i.id, v]));
const leitura = (items, versions) => ({ readAt: new Date().toISOString(), today: hojeOperacional(), items, versions });

/** Estado das duas listas, para `GET /agenda` e `GET /panel/sources` (mesma janela: desde 3 dias atrás). */
async function paraOPainel() {
  if (!novosDadosNoPostgres()) return { intakeEvents: [], requests: [] };
  const desde = somarDias(hojeOperacional(), -3);
  const [eventos, pedidos] = await Promise.all([lendoNovo((m) => adm.lerEventos(m, { desde })), lendoNovo((m) => adm.lerSolicitacoes(m, { desde }))]);
  return { intakeEvents: eventos, requests: pedidos.map((r) => r.item) };
}

async function lerAdmissoes(req) {
  comum.ator(req, false);
  if (!novosDadosNoPostgres()) throw comum.indisponivel();
  const eventos = (await paraOPainel()).intakeEvents;
  return leitura(eventos, versoes(eventos));
}
async function lerSolicitacoes(req) {
  comum.ator(req, false);
  if (!novosDadosNoPostgres()) throw comum.indisponivel();
  const desde = somarDias(hojeOperacional(), -3);
  const regs = await lendoNovo((m) => adm.lerSolicitacoes(m, { desde }));
  return leitura(regs.map((r) => r.item), Object.fromEntries(regs.map((r) => [r.item.id, r.version])));
}

function corpoAdmissao(c) {
  if (!ehObjeto(c) || !ehObjeto(c.event)) throw invalido('corpo');
  const e = c.event;
  if (typeof e.id !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(e.id)) throw invalido('event.id');
  if (typeof e.tarotId !== 'string' || !/^[A-Za-z0-9._:@-]{1,64}$/.test(e.tarotId)) throw invalido('event.tarotId');
  if (!['open', 'no_more'].includes(e.mode)) throw invalido('event.mode');
  if (e.mode === 'no_more' && !['shift', 'day'].includes(e.closeScope)) throw invalido('event.closeScope');
  if (e.mode === 'no_more' && e.closeScope === 'shift' && (typeof e.endTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.endTime) || !Number.isFinite(Date.parse(e.closedUntil)))) throw invalido('event.endTime');
  return { operationKey: validar.chaveOperacao(c.operationKey), event: e };
}

/** `POST /agenda/admissions`: fecha ou reabre a agenda de um tarólogo para novos agendamentos. */
async function registrarAdmissao(req) {
  const a = comum.ator(req, true);
  const c = corpoAdmissao(req.body);
  const e = c.event;
  return comum.gravar(req, a, {
    escopo: 'agenda.admissao', operationKey: c.operationKey, corpo: c, acao: 'agenda.admissao',
    producao: async (ex) => {
      if (await adm.eventoExiste(ex, e.id)) throw comum.conflitoVersao('Esta ação já foi registrada.');
      await store.travarFila(ex, e.tarotId);
      const agora = new Date(); const hoje = hojeOperacional(agora);
      const evento = { id: e.id, tarotId: e.tarotId, date: hoje, mode: e.mode, at: agora.toISOString(), by: a.nome, consultationIds: [] };
      const consultas = await ciclo.resumoParaPresenca(ex, e.tarotId);
      evento.consultationIds = consultas.filter((x) => ((contaMinutos(x.status) || retemCoberturaDeCancelamento(x)) && x.durationSeconds > 0) || Boolean(x.tarologistFinishReport)).map((x) => x.id);
      if (e.mode === 'no_more') {
        const fimDoDia = new Date(`${somarDias(hoje, 1)}T06:00:00-03:00`).toISOString();
        if (e.closeScope === 'shift') {
          const fim = Date.parse(e.closedUntil);
          if (fim <= agora.getTime() || fim > agora.getTime() + 24 * 3600000) throw comum.regra('Este turno já terminou. Confira o período de fechamento.');
        }
        Object.assign(evento, { closeScope: e.closeScope, closedUntil: e.closeScope === 'shift' ? new Date(e.closedUntil).toISOString() : fimDoDia, ...(e.closeScope === 'shift' ? { endTime: e.endTime } : {}) });
        const abertos = (await store.abertosDe(ex, [e.tarotId])).filter((i) => ativoNoDia(i, hoje, hoje) && !encerrado(i));
        evento.agendaIds = abertos.map((i) => i.id);
      }
      await adm.inserirEvento(ex, evento, a.nome, c.operationKey);
      const vigentes = await adm.eventosDoDia(ex, e.tarotId, hoje);
      return { entidadeId: evento.id, antes: null, depois: { tarotId: evento.tarotId, mode: evento.mode, closeScope: evento.closeScope }, resposta: leitura(vigentes.filter((x) => x.id === evento.id), { [evento.id]: 1 }) };
    },
  });
}

function corpoSolicitacao(c) {
  if (!ehObjeto(c) || !ehObjeto(c.request)) throw invalido('corpo');
  const r = c.request;
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(r.id)) throw invalido('request.id');
  if (typeof r.clientId !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(r.clientId)) throw invalido('request.clientId');
  if (typeof r.client !== 'string' || !r.client.trim() || r.client.length > 160) throw invalido('request.client');
  if (r.note !== undefined && (typeof r.note !== 'string' || r.note.length > 500)) throw invalido('request.note'); // o campo da tela tem maxLength 500 (agenda-intake-context.tsx)
  return { operationKey: validar.chaveOperacao(c.operationKey), request: r };
}

/** `POST /agenda/requests`: a PRÓPRIA taróloga avisa que uma cliente quer consulta. */
async function registrarSolicitacao(req) {
  const tarotId = `${(req.user && req.user.tarotId) || ''}`;
  const base = comum.ator(req, false, { aceitaTarologa: true });
  if (!tarotId) throw comum.negado(true);
  const a = { ...base, perfil: 'tarologa' };
  const c = corpoSolicitacao(req.body);
  const r = c.request;
  if (!(await verificarCliente(r.clientId))) throw new AppError('Cadastro de cliente não encontrado.', 404, { codigo: 'CLIENT_NOT_FOUND' }, true);
  return comum.gravar(req, a, {
    escopo: 'agenda.solicitacao', operationKey: c.operationKey, corpo: { ...c, tarotId }, acao: 'agenda.solicitacao',
    producao: async (ex) => {
      const hoje = hojeOperacional();
      // O mesmo pedido da mesma cliente à mesma taróloga, ainda sem agenda, é o mesmo pedido (agenda-intake-context.tsx:90).
      const antigos = await adm.solicitacaoAberta(ex, tarotId, r.clientId);
      const existente = antigos.find((x) => !x.item.agendaId);
      if (existente) return { entidadeId: existente.item.id, antes: null, depois: { repetida: true }, resposta: leitura([existente.item], { [existente.item.id]: existente.version }) };
      const item = { id: r.id, tarotId, clientId: r.clientId, client: r.client.trim(), date: hoje, at: new Date().toISOString(), note: (r.note || '').trim() };
      await adm.inserirSolicitacao(ex, item, a.nome, c.operationKey);
      return { entidadeId: item.id, antes: null, depois: { tarotId, clientId: item.clientId }, resposta: leitura([item], { [item.id]: 1 }) };
    },
  });
}

/** `POST /agenda/requests/:id/resolve`: a equipe liga o pedido ao agendamento (resolvedAt e resolvedBy são do servidor). */
async function resolverSolicitacao(req) {
  const a = comum.ator(req, true);
  const id = validar.idItem(req.params.id);
  const b = req.body;
  if (!ehObjeto(b) || typeof b.agendaId !== 'string' || !b.agendaId || b.agendaId.length > 64 || !Number.isInteger(b.expectedVersion) || b.expectedVersion < 1) throw invalido('corpo');
  const chave = validar.chaveOperacao(b.operationKey);
  return comum.gravar(req, a, {
    escopo: 'agenda.solicitacao.resolver', operationKey: chave, corpo: { id, agendaId: b.agendaId, expectedVersion: b.expectedVersion }, acao: 'agenda.solicitacao.resolver',
    producao: async (ex) => {
      const atual = await adm.solicitacaoTravada(ex, id);
      if (!atual) throw comum.naoEncontrado();
      if (atual.version !== b.expectedVersion) throw comum.conflitoVersao('Esta solicitação mudou. Confira a situação atual.');
      if (!(await store.travar(ex, b.agendaId))) throw comum.regra('Este agendamento não foi encontrado.');
      const item = { ...atual.item, agendaId: b.agendaId, resolvedAt: new Date().toISOString(), resolvedBy: a.nome };
      await adm.atualizarSolicitacao(ex, item, atual.version + 1);
      return { entidadeId: id, antes: { version: atual.version }, depois: { version: atual.version + 1, agendaId: b.agendaId }, resposta: leitura([item], { [id]: atual.version + 1 }) };
    },
  });
}

module.exports = { paraOPainel, lerAdmissoes, lerSolicitacoes, registrarAdmissao, registrarSolicitacao, resolverSolicitacao, definirVerificadorDeCliente };
