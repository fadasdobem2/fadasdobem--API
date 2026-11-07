'use strict';

/**
 * Pedido de agendamento (v706 da Nice, Maturacao/57): a taróloga pede (`POST /agenda/requests`, só a PRÓPRIA) e a equipe conduz o pedido
 * (`PUT /agenda/requests/:id`, `expectedVersion`): Perguntar -> Perguntamos -> Confirmado, Desagendar, identificar a cliente, contato e lugar na fila.
 * O servidor confere a transição com o domínio puro (`agenda-pedido-*.js`, `agenda-identidade.js`), dá autoria e relógio às entradas novas do
 * histórico e à resolução, e guarda contato/cliente nulos (nunca um ID fictício). Idempotente por `operationKey`; auditoria na mesma transação.
 */

const AppError = require('../../../utils/AppError');
const { hojeOperacional } = require('../../_comum/dia-operacional');
const { normalizarWhatsapp, pedidoDuplicado, proximoCodigoDeContato, contatoAtivo } = require('../../_comum/dominio/agenda-pedido-identidade');
const { ETAPAS, etapaDoPedido, horarioValido, dataValida } = require('../../_comum/dominio/agenda-pedido-registro');
const { erroDeConsultaAoTarologo, pedidoPodeConfirmar, normalizarHorarioDoPedido } = require('../../_comum/dominio/agenda-pedido-contato');
const { pedidoCombinaComIdentidade } = require('../../_comum/dominio/agenda-identidade');
const { encerrado, limpar } = require('../../_comum/dominio/agenda-contato');
const comum = require('./agenda.comum');
const validar = require('./agenda.validacao');
const agendaStore = require('./agenda.store');
const adm = require('./agenda-admissao.store');
const contatos = require('./agenda-contatos.store');
const { rotuloDaCliente } = require('./agenda-cliente');

const invalido = (c) => new AppError('Dados inválidos.', 400, { codigo: 'INVALID_INPUT', campo: c }, true);
const ehObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const MODALIDADES = ['WhatsApp Áudio', 'PABX', 'WhatsApp Ligação', 'WhatsApp Texto', 'WhatsApp Texto/Áudio', 'WhatsApp', 'Telefone', 'Meio a definir'];
const resposta = (regs) => ({ readAt: new Date().toISOString(), items: regs.map((r) => r.item), versions: Object.fromEntries(regs.map((r) => [r.item.id, r.version])) });
const CONTATO_CAMPOS = ['contact', 'contactHistory', 'contactPlan', 'contactReturn', 'contactReturnHistory'];

/** Campos comuns do pedido (data, horário, meio, minutos, nota): a mesma conferência para criar e editar. */
function conferirCampos(r) {
  if (r.date !== undefined && !dataValida(r.date)) throw comum.regra('Confira a data e o horário do pedido.');
  const horario = r.requestedTime === undefined || r.requestedTime === '' ? undefined : normalizarHorarioDoPedido(`${r.requestedTime}`);
  if (horario !== undefined && !horarioValido(horario)) throw comum.regra('Confira a data e o horário do pedido.');
  if (r.channel !== undefined && r.channel !== '' && !MODALIDADES.includes(r.channel)) throw comum.regra('Escolha um meio de consulta válido.');
  if (r.requestedMinutes !== undefined && !(Number.isSafeInteger(r.requestedMinutes) && r.requestedMinutes > 0)) throw comum.regra('Informe os minutos solicitados com um número inteiro maior que zero.');
  if (r.note !== undefined && (typeof r.note !== 'string' || r.note.length > 500)) throw invalido('request.note');
  if (r.needsReview !== undefined && (typeof r.needsReview !== 'string' || r.needsReview.length > 300)) throw invalido('request.needsReview');
  return horario;
}
const entradasNovas = (anterior, enviado, a, agora) => {
  if (!Array.isArray(enviado) || enviado.length > 500 || !enviado.every((e) => ehObjeto(e) && typeof e.id === 'string' && e.id)) throw invalido('request.history');
  if (!anterior.every((e, i) => enviado[i] && JSON.stringify(limpar(enviado[i])) === JSON.stringify(limpar(e)))) throw comum.regra('Esta ação não pode ser alterada.');
  return [...anterior, ...enviado.slice(anterior.length).map((e) => ({ ...e, by: a.nome, at: agora }))];
};

/** O contato do pedido: reaproveita o ativo do mesmo WhatsApp ou cria um novo (código IL do servidor). */
async function contatoDoPedido(ex, id, identidade, tarotId, referral, a, agora, operationKey) {
  await contatos.travarCodigos(ex);
  const todos = await contatos.todos(ex);
  const fone = normalizarWhatsapp(identidade.whatsapp);
  if (!fone) throw comum.regra(identidade.whatsapp && identidade.whatsapp.trim() ? 'Informe o WhatsApp completo, com DDD e os 8 ou 9 números locais.' : 'Informe o ID ou um WhatsApp completo com DDD.');
  const existente = todos.map((r) => r.item).find((x) => contatoAtivo(x) && normalizarWhatsapp(x.whatsapp) === fone);
  if (existente) return existente;
  const item = { id, name: (identidade.name || '').trim() || 'Nome não informado', whatsapp: fone, source: 'reader_request', sourceTarotId: tarotId, referral, createdAt: agora,
    classification: referral ? 'lead' : 'identification_pending', history: [{ id: `${id}:pedido`, action: 'Pedido recebido', at: agora, by: a.nome }], displayCode: proximoCodigoDeContato(todos.map((r) => r.item)) };
  await contatos.inserir(ex, item, a.nome, operationKey);
  return item;
}

function corpoCriacao(c) {
  if (!ehObjeto(c) || !ehObjeto(c.request)) throw invalido('corpo');
  const r = c.request;
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(r.id)) throw invalido('request.id');
  if (r.clientId !== undefined && (typeof r.clientId !== 'string' || (r.clientId && !/^[A-Za-z0-9._:-]{1,64}$/.test(r.clientId)))) throw invalido('request.clientId');
  if (r.client !== undefined && (typeof r.client !== 'string' || r.client.length > 160)) throw invalido('request.client');
  const e = r.submittedIdentity;
  if (e !== undefined && (!ehObjeto(e) || [e.clientId, e.name, e.whatsapp].some((v) => typeof v !== 'string' || v.length > 160))) throw invalido('request.submittedIdentity');
  if (r.referral !== undefined && typeof r.referral !== 'boolean') throw invalido('request.referral');
  return { operationKey: validar.chaveOperacao(c.operationKey), request: r };
}

/** `POST /agenda/requests`: a PRÓPRIA taróloga pede consulta para uma cliente (ID) ou para um contato (WhatsApp). */
async function registrarPedido(req, { verificarCliente }) {
  const tarotId = `${(req.user && req.user.tarotId) || ''}`;
  const base = comum.ator(req, false, { aceitaTarologa: true });
  if (!tarotId) throw comum.negado(true);
  const a = { ...base, perfil: 'tarologa' };
  const c = corpoCriacao(req.body);
  const r = c.request;
  const clientId = (r.clientId || (r.submittedIdentity && r.submittedIdentity.clientId) || '').trim();
  if (clientId && !(await verificarCliente(clientId))) throw new AppError('Cadastro de cliente não encontrado.', 404, { codigo: 'CLIENT_NOT_FOUND' }, true);
  if (!clientId && !r.submittedIdentity) throw invalido('request.clientId');
  const horario = conferirCampos(r);
  return comum.gravar(req, a, {
    escopo: 'agenda.solicitacao', operationKey: c.operationKey, corpo: { ...c, tarotId }, acao: 'agenda.solicitacao',
    producao: async (ex) => {
      const agora = new Date().toISOString();
      const hoje = hojeOperacional();
      const data = r.date || hoje;
      if (data < hoje) throw comum.regra('Confira a data e o horário do pedido.');
      const contato = clientId ? undefined : await contatoDoPedido(ex, `intake-contact:${r.id}`, r.submittedIdentity, tarotId, r.referral === true, a, agora, c.operationKey);
      const nome = clientId ? ((r.client || '').trim() || (await rotuloDaCliente(clientId).catch(() => r.client || ''))) : contato.name;
      const item = {
        id: r.id, tarotId, clientId, client: nome.slice(0, 160), ...(contato ? { contactId: contato.id, contactCode: contato.displayCode } : {}), identityStatus: clientId ? 'client' : 'contact',
        date: data, ...(horario ? { requestedTime: horario } : {}), channel: r.channel || '', ...(r.requestedMinutes !== undefined ? { requestedMinutes: r.requestedMinutes } : {}), at: agora, note: (r.note || '').trim(),
        ...(r.submittedIdentity ? { submittedIdentity: r.submittedIdentity } : {}), ...(r.referral ? { referral: true } : {}), stage: 'ask', history: [{ id: `${r.id}:submitted`, action: 'submitted', at: agora, by: a.nome, date: hoje }],
      };
      const doDia = await adm.pedidosDoDia(ex, tarotId, data);
      const igual = pedidoDuplicado(doDia.map((x) => x.item), item, contato ? [contato] : []);
      if (igual) {
        if (igual.requestedTime !== item.requestedTime || (igual.channel !== item.channel && Boolean(item.channel)) || (igual.requestedMinutes !== item.requestedMinutes && item.requestedMinutes !== undefined)) {
          throw comum.regra('Já existe um pedido para esta data com dados diferentes. A equipe pode revisar o pedido existente.');
        }
        const reg = doDia.find((x) => x.item.id === igual.id);
        return { entidadeId: igual.id, antes: null, depois: { repetida: true }, resposta: resposta([reg]) };
      }
      await adm.inserirSolicitacao(ex, item, a.nome, c.operationKey);
      return { entidadeId: item.id, antes: null, depois: { tarotId, clientId: item.clientId || null, contactId: item.contactId || null }, resposta: resposta([{ item, version: 1 }]) };
    },
  });
}

/** `PUT /agenda/requests/:id`: a equipe conduz o pedido. */
async function atualizarPedido(req, { verificarCliente }) {
  const a = comum.ator(req, true);
  const id = validar.idItem(req.params.id);
  const b = req.body;
  if (!ehObjeto(b) || !ehObjeto(b.request) || b.request.id !== id || !Number.isInteger(b.expectedVersion) || b.expectedVersion < 1) throw invalido('corpo');
  const chave = validar.chaveOperacao(b.operationKey);
  const r = b.request;
  const horario = conferirCampos(r);
  if (r.stage !== undefined && !ETAPAS.includes(r.stage)) throw invalido('request.stage');
  if (CONTATO_CAMPOS.some((k) => r[k] !== undefined && JSON.stringify(r[k]).length > 65536)) throw invalido('request.contact');
  return comum.gravar(req, a, {
    escopo: 'agenda.solicitacao.atualizar', operationKey: chave, corpo: { id, expectedVersion: b.expectedVersion, request: r }, acao: 'agenda.solicitacao.atualizar',
    producao: async (ex) => {
      const atual = await adm.solicitacaoTravada(ex, id);
      if (!atual) throw comum.naoEncontrado();
      if (atual.version !== b.expectedVersion) throw comum.conflitoVersao('Esta solicitação mudou. Confira a situação atual.');
      const ant = atual.item;
      const agora = new Date().toISOString();
      if (r.tarotId !== ant.tarotId || r.at !== ant.at || JSON.stringify(limpar(r.submittedIdentity ?? null)) !== JSON.stringify(limpar(ant.submittedIdentity ?? null)) || (ant.contactId && r.contactId !== ant.contactId)) throw comum.regra('Esta ação não pode ser alterada.');
      const etapaAntes = etapaDoPedido(ant);
      const etapa = r.stage ?? etapaAntes;
      const clientId = (r.clientId || '').trim();
      if (clientId && clientId !== (ant.clientId || '')) {
        if (!(await verificarCliente(clientId))) throw comum.regra('Selecione uma cliente cadastrada para vincular.');
      }
      if (r.readerInquiry !== ant.readerInquiry) {
        const erro = erroDeConsultaAoTarologo(ant, r.readerInquiry);
        if (erro && !(clientId && !ant.clientId)) throw comum.regra(erro);
      }
      if (etapa !== etapaAntes && etapa === 'confirmed') {
        if (etapaAntes === 'descheduled') throw comum.regra('Este pedido foi desagendado. Reagende antes de confirmar.');
        if (!pedidoPodeConfirmar({ ...ant, clientId })) throw comum.regra(clientId ? 'Marque Perguntamos antes de confirmar o agendamento.' : 'Cadastre ou localize a cliente neste pedido antes de confirmar o agendamento.');
        const ligado = r.agendaId || ant.agendaId ? await agendaStore.travar(ex, r.agendaId || ant.agendaId) : null;
        if (!ligado || encerrado(ligado.item) || !pedidoCombinaComIdentidade({ ...ant, clientId }, ligado.item)) throw comum.regra('Vincule um agendamento ativo antes de confirmar.');
      }
      if (r.queuePlacement !== undefined && (!ehObjeto(r.queuePlacement) || !Number.isInteger(r.queuePlacement.order) || r.queuePlacement.order < 0 || r.queuePlacement.order > 10000
        || [r.queuePlacement.beforeAgendaId, r.queuePlacement.afterAgendaId].some((v) => v !== undefined && (typeof v !== 'string' || v.length > 64)))) throw comum.regra('A posição escolhida já mudou. Confira a fila.');
      const finalizando = etapa !== etapaAntes && (etapa === 'confirmed' || etapa === 'descheduled');
      const item = {
        ...ant, client: r.client !== undefined ? `${r.client}`.slice(0, 160) : ant.client, clientId, date: r.date ?? ant.date, requestedTime: r.requestedTime === undefined ? ant.requestedTime : horario,
        note: r.note !== undefined ? r.note.trim() : ant.note, channel: r.channel ?? ant.channel, requestedMinutes: r.requestedMinutes ?? ant.requestedMinutes, stage: etapa,
        agendaId: r.agendaId ?? ant.agendaId, needsReview: r.needsReview, readerInquiry: r.readerInquiry, identityNotFound: r.identityNotFound, queuePlacement: r.queuePlacement,
        identityStatus: clientId ? 'client' : r.identityStatus ?? ant.identityStatus, contactCode: clientId ? undefined : r.contactCode ?? ant.contactCode,
        ...Object.fromEntries(CONTATO_CAMPOS.map((k) => [k, r[k]])),
        history: entradasNovas(ant.history || [], r.history || [], a, agora),
        resolvedAt: finalizando ? agora : etapa === 'ask' || etapa === 'asked' ? undefined : r.resolvedAt ?? ant.resolvedAt, resolvedBy: finalizando ? a.nome : etapa === 'ask' || etapa === 'asked' ? undefined : r.resolvedBy ?? ant.resolvedBy,
      };
      if (item.agendaId && item.agendaId !== ant.agendaId && !(await agendaStore.travar(ex, item.agendaId))) throw comum.regra('O agendamento não corresponde a este pedido.');
      await adm.atualizarSolicitacao(ex, item, atual.version + 1);
      return { entidadeId: id, antes: { version: atual.version, stage: etapaAntes }, depois: { version: atual.version + 1, stage: etapa }, resposta: resposta([{ item, version: atual.version + 1 }]) };
    },
  });
}

module.exports = { registrarPedido, atualizarPedido };
