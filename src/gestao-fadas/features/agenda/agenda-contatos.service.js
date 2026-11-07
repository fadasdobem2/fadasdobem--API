'use strict';

/**
 * Contatos da Agenda (v706 da Nice, Maturacao/57): quem ainda não é cliente tem um contato durável com código IL, que pode receber pedidos e
 * agendamentos. `GET /agenda/contacts` (equipe, leitura) e `PUT /agenda/contacts/:id` (equipe, cria ou muda; `expectedVersion` na mudança).
 * O servidor NÃO confia no registro que a tela monta: confere a transição (editar, arquivar, vincular a uma cliente, desfazer o vínculo) com o
 * domínio puro (`agenda-pedido-identidade.js`, `agenda-identidade.js`, `agenda-pedido-contato.js`), dá o código IL, carimba autor e relógio nas
 * entradas novas do histórico e, ao vincular ou desfazer, atualiza os agendamentos do contato NA MESMA transação (idempotente por `operationKey`).
 */

const AppError = require('../../../utils/AppError');
const { hojeOperacional } = require('../../_comum/dia-operacional');
const { novosDadosNoPostgres } = require('../../novo/modo');
const { lendoNovo } = require('../../novo/leitura');
const { normalizarWhatsapp, proximoCodigoDeContato, contatoAtivo } = require('../../_comum/dominio/agenda-pedido-identidade');
const { aplicarContatoNaAgenda } = require('../../_comum/dominio/agenda-identidade');
const { erroAoDesfazerVinculo } = require('../../_comum/dominio/agenda-pedido-contato');
const { encerrado, limpar } = require('../../_comum/dominio/agenda-contato');
const comum = require('./agenda.comum');
const validar = require('./agenda.validacao');
const agendaStore = require('./agenda.store');
const store = require('./agenda-contatos.store');
const { rotuloDaCliente } = require('./agenda-cliente');

const invalido = (c) => new AppError('Dados inválidos.', 400, { codigo: 'INVALID_INPUT', campo: c }, true);
const ehObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const CLASSES = ['lead', 'client', 'identification_pending'];
const FONE_INVALIDO = 'Informe o WhatsApp completo, com DDD e os 8 ou 9 números locais.';
const leitura = (regs) => ({ readAt: new Date().toISOString(), today: hojeOperacional(), items: regs.map((r) => r.item), versions: Object.fromEntries(regs.map((r) => [r.item.id, r.version])) });

async function lerContatos(req) {
  comum.ator(req, false);
  if (!novosDadosNoPostgres()) throw comum.indisponivel();
  return leitura(await lendoNovo((m) => store.ler(m)));
}

function corpo(req) {
  const c = req.body;
  const id = validar.idItem(req.params.id);
  if (!ehObjeto(c) || !ehObjeto(c.contact) || c.contact.id !== id) throw invalido('corpo');
  const k = c.contact;
  if (typeof k.name !== 'string' || k.name.length > 160 || typeof k.whatsapp !== 'string' || k.whatsapp.length > 40) throw invalido('contact');
  if (!['reader_request', 'staff'].includes(k.source) || !CLASSES.includes(k.classification) || typeof k.referral !== 'boolean') throw invalido('contact');
  if (!Array.isArray(k.history) || k.history.length > 500 || !k.history.every((e) => ehObjeto(e) && typeof e.id === 'string' && e.id && e.id.length <= 160 && JSON.stringify(e).length < 4000)) throw invalido('contact.history');
  if (c.expectedVersion !== undefined && (!Number.isInteger(c.expectedVersion) || c.expectedVersion < 1)) throw invalido('expectedVersion');
  return { id, operationKey: validar.chaveOperacao(c.operationKey), expectedVersion: c.expectedVersion, contact: k };
}

/** Entradas novas do histórico: autoria e relógio do servidor; as antigas não mudam. */
function historico(anterior, enviado, ator, agora) {
  if (!anterior.every((e, i) => enviado[i] && enviado[i].id === e.id && JSON.stringify(limpar(enviado[i])) === JSON.stringify(limpar(e)))) throw comum.regra('Esta ação não pode ser alterada.');
  return [...anterior, ...enviado.slice(anterior.length).map((e) => ({ ...e, by: ator.nome, at: agora }))];
}

async function foneLivre(ex, id, fone, itens) {
  if (fone && itens.some((x) => x.id !== id && contatoAtivo(x) && normalizarWhatsapp(x.whatsapp) === fone)) throw comum.regra('Este WhatsApp já está em outro contato. Confira os vínculos antes de alterar.');
}

/** Vincular a uma cliente ou desfazer: os agendamentos do contato mudam junto (atômico). */
async function projetarNaAgenda(ex, novo, a, agora, hoje, operationKey) {
  const ligados = await store.agendamentosDoContato(ex, novo.id);
  const tarologos = [...new Set(ligados.map((r) => r.item.tarotId))];
  const outros = tarologos.length ? await agendaStore.abertosDe(ex, tarologos) : [];
  const base = [...ligados.map((r) => r.item), ...outros.filter((i) => !ligados.some((r) => r.item.id === i.id))];
  let proxima;
  try { proxima = aplicarContatoNaAgenda(base, novo, a.nome, agora, hoje); } catch (e) { throw comum.regra(e.message); }
  if (proxima === base) return ligados.map((r) => r.item.id);
  const mudados = [];
  for (const r of ligados) {
    const item = proxima.find((i) => i.id === r.item.id);
    if (item === r.item) continue;
    await agendaStore.atualizar(ex, item, r.version + 1);
    await agendaStore.inserirEvento(ex, { idAgenda: item.id, tipo: 'agendamento', ref: null, a, dados: { identidade: { leadId: novo.id, clientId: item.clientId || null } }, versao: r.version + 1, operationKey });
    mudados.push(item.id);
  }
  return mudados;
}

async function salvarContato(req) {
  const a = comum.ator(req, true);
  const c = corpo(req);
  return comum.gravar(req, a, {
    escopo: 'agenda.contato', operationKey: c.operationKey, corpo: { id: c.id, expectedVersion: c.expectedVersion, contact: c.contact }, acao: 'agenda.contato',
    producao: async (ex) => {
      await store.travarCodigos(ex);
      const agora = new Date().toISOString();
      const hoje = hojeOperacional();
      const atual = await store.contatoTravado(ex, c.id);
      const todos = await store.todos(ex);
      const k = c.contact;
      const nome = k.name.trim();
      const fone = normalizarWhatsapp(k.whatsapp);
      if (k.whatsapp.trim() && !fone) throw comum.regra(FONE_INVALIDO);
      if (!atual) {
        if (c.expectedVersion !== undefined) throw comum.conflitoVersao('Este contato mudou. Confira os dados atuais.');
        if (k.clientId) throw comum.regra('Selecione uma cliente cadastrada para vincular.');
        if (!nome) throw comum.regra('Informe o nome do contato.');
        await foneLivre(ex, c.id, fone, todos.map((r) => r.item));
        const item = {
          id: c.id, name: nome, whatsapp: fone || '', source: k.source, ...(k.sourceTarotId ? { sourceTarotId: String(k.sourceTarotId).slice(0, 64) } : {}), referral: k.referral, createdAt: agora,
          classification: k.classification === 'client' ? 'identification_pending' : k.classification, history: k.history.map((e) => ({ ...e, by: a.nome, at: agora })),
          displayCode: proximoCodigoDeContato(todos.map((r) => r.item)),
        };
        await store.inserir(ex, item, a.nome, c.operationKey);
        return { entidadeId: c.id, antes: null, depois: { criado: true, codigo: item.displayCode }, resposta: leitura([{ item, version: 1 }]) };
      }
      if (c.expectedVersion !== atual.version) throw comum.conflitoVersao('Este contato mudou. Confira os dados atuais.');
      const ant = atual.item;
      if (k.source !== ant.source || (k.createdAt && k.createdAt !== ant.createdAt)) throw comum.regra('Esta ação não pode ser alterada.');
      const entradas = historico(ant.history || [], k.history, a, agora);
      const base = { ...ant, history: entradas, updatedAt: agora };
      const vinculando = !ant.clientId && Boolean(k.clientId);
      const desfazendo = Boolean(ant.clientId) && !k.clientId;
      let item;
      let mudados = [];
      if (vinculando) {
        const clientId = `${k.clientId}`.trim();
        let rotulo;
        try { rotulo = await rotuloDaCliente(clientId); } catch (_e) { throw comum.regra('Selecione uma cliente cadastrada para vincular.'); }
        if (await store.clienteJaVinculada(ex, clientId, c.id)) throw comum.regra('Esta cliente já está vinculada a outro contato. Confira os registros antes de unir.');
        const ligados = await store.agendamentosDoContato(ex, c.id);
        item = { ...base, name: rotulo, clientId, classification: 'client', archived: true, identityReviewRequired: false, identityUndo: undefined,
          clientLinkSnapshot: { name: ant.name, whatsapp: ant.whatsapp, classification: ant.classification === 'lead' ? 'lead' : 'identification_pending', agendaIds: ligados.filter((r) => r.item.leadId === c.id).map((r) => r.item.id), clientId } };
        mudados = await projetarNaAgenda(ex, item, a, agora, hoje, c.operationKey);
      } else if (desfazendo) {
        const foto = ant.clientLinkSnapshot;
        const ligados = await store.agendamentosDoContato(ex, c.id);
        const erro = erroAoDesfazerVinculo(ant, ligados.map((r) => r.item), [], [], ant.clientId);
        if (erro) throw comum.regra(erro);
        item = { ...base, name: foto.name, whatsapp: foto.whatsapp, classification: foto.classification, clientId: undefined, archived: false, archivedAt: undefined, archivedBy: undefined, archiveReason: undefined,
          clientLinkSnapshot: undefined, identityReviewRequired: true, identityUndo: { clientId: ant.clientId, agendaIds: foto.agendaIds, at: agora, by: a.nome } };
        mudados = await projetarNaAgenda(ex, item, a, agora, hoje, c.operationKey);
      } else {
        if (ant.archived && !k.archived) throw comum.regra('Contato não encontrado.');
        const arquivando = !ant.archived && Boolean(k.archived);
        if (arquivando) {
          const motivo = `${k.archiveReason || ''}`.trim();
          if (!motivo) throw comum.regra('Informe o motivo do arquivamento.');
          const abertos = (await store.agendamentosDoContato(ex, c.id)).filter((r) => r.item.leadId === c.id && !encerrado(r.item));
          if (abertos.length) throw comum.regra('Desagende o atendimento deste contato antes de arquivá-lo.');
          item = { ...base, archived: true, archivedAt: agora, archivedBy: a.nome, archiveReason: motivo };
        } else {
          if (!ant.archived) { if (!nome) throw comum.regra('Informe o nome do contato.'); if (!fone && (!ant.clientId || k.whatsapp.trim())) throw comum.regra(FONE_INVALIDO); await foneLivre(ex, c.id, fone, todos.map((r) => r.item)); }
          item = { ...base, ...(ant.archived ? {} : { name: nome, whatsapp: fone || '', referral: k.referral }) };
        }
      }
      await store.atualizar(ex, item, atual.version + 1);
      const resposta = leitura([{ item: { ...item, displayCode: ant.displayCode }, version: atual.version + 1 }]);
      return { entidadeId: c.id, antes: { version: atual.version }, depois: { version: atual.version + 1, vinculo: vinculando || desfazendo || undefined, agendamentos: mudados }, resposta: { ...resposta, agendaIds: mudados } };
    },
  });
}

module.exports = { lerContatos, salvarContato };
