'use strict';

/**
 * Recados: o que o SERVIDOR faz com o registro que o front deixou na tela (Maturacao/30). O front monta o recado com as próprias funções
 * (`staffNoteCreate`, `ownOperationalNoteChange`, `staffOperationalNoteChange`, `operationalNoteReply`, `operationalNoteOk`, organização e
 * importância); aqui o servidor NÃO confia: descobre qual mudança é, confere quem pode, mantém imutável o que não pode mudar, e carimba autor e
 * instante. `aplicar` é puro: devolve o item novo e o que é PESSOAL da conta (lido, fixado, prioridade, arquivado), que não sobe a versão.
 */

const d = require('./recados');
const { erro, estavel, igual, versaoDe, validarTexto, validarPeriodo, detalhes, equipe, visivel, raiz } = d;

const IGNORADAS = ['readsByAccount', 'readAt', 'readBy', 'readById', 'historicalRead', 'incomingToViewer', 'pinnedByAccount', 'prioritizedByAccount', 'archivedByAccount', 'excludedDates'];
const CONTEUDO = ['text', 'formatting', 'subject', 'startDate', 'endDate', 'originalQuote', 'originalQuoteFormatting', 'updatedAt', 'deletedAt', 'revisions'];
const ESPECIAIS = ['importance', 'agendaApplications', 'notifiedAt', 'notifiedBy'];
const ID = /^[A-Za-z0-9._:-]{1,64}$/;
const NAO_IDENTIFICADA = 'Não foi possível identificar esta alteração.';
const objeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const txt = (v, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;
const instanteOk = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));

const limpo = (n) => { const c = { ...n }; for (const k of IGNORADAS) delete c[k]; return c; };

function validarDelivery(dv, conta, contas) {
  if (!objeto(dv) || !['board', 'message'].includes(dv.kind) || !['staff', 'tarologist', 'person', 'tarologists'].includes(dv.audience)) throw erro('Escolha a finalidade e os destinatários.');
  if (dv.senderId !== conta.id || !txt(dv.label) || !Array.isArray(dv.recipientIds) || !Array.isArray(dv.excludedIds) || dv.recipientIds.length > 500 || dv.excludedIds.length > 500
    || [...dv.recipientIds, ...dv.excludedIds].some((x) => !txt(x, 64))) throw erro(NAO_IDENTIFICADA);
  if (dv.kind === 'board' && dv.audience !== 'staff') throw erro(NAO_IDENTIFICADA);
  if (dv.kind === 'message' && !dv.recipientIds.length) throw erro('Nenhuma conta ativa receberia esta mensagem. Revise os destinatários e as exceções.');
  if (dv.audience === 'tarologists' && !require('../politica-acesso').permissoesDoPerfil(conta.papel).canEditProfessionalProfile) throw erro('O envio para todos os tarólogos é reservado ao administrativo.');
  if (contas && dv.recipientIds.some((x) => !contas.has(x))) throw erro('Escolha a pessoa do atendimento.');
}

/** Campos que um recado novo (raiz ou resposta) traz do front; o resto o servidor define. */
function criar({ pedido, conta, agora, todas, contas }) {
  const p = limpo(pedido);
  if (!ID.test(p.id || '')) throw erro(NAO_IDENTIFICADA);
  if (!txt(p.tarotId, 64) || !txt(p.tarot) || !dataValida(p.date)) throw erro(NAO_IDENTIFICADA);
  const tarologa = conta.papel === 'tarologa';
  if (!tarologa && !equipe(conta.papel)) throw erro('Esta conta não pode publicar recados.');
  const nota = { id: p.id, tarotId: p.tarotId, tarot: p.tarot, text: '', at: agora, by: conta.nome, actorId: conta.id, source: tarologa ? 'tarologist' : 'staff', date: p.date };
  // Arquivo de aviso de escala (`ownOperationalNoteChange`, `legacy`): a conta guarda o aviso antigo; vale como veio.
  if (p.source === 'schedule') {
    if (!/^schedule:/.test(p.id) || p.delivery || p.replyToId || (tarologa && p.tarotId !== conta.tarotId) || !instanteOk(p.at)) throw erro(NAO_IDENTIFICADA);
    const texto = validarTexto(p.text, 'Recado', true);
    return { ...p, text: texto, source: 'schedule', by: 'Horários da equipe', actorId: undefined, at: p.at };
  }
  if (p.source !== nota.source) throw erro(NAO_IDENTIFICADA);
  const rotulo = tarologa ? (p.replyToId ? 'Resposta' : 'Recado') : (p.replyToId ? 'Resposta' : 'Mensagem');
  const texto = validarTexto(p.text, rotulo, true);
  if (p.formatting !== undefined) nota.formatting = p.formatting;
  nota.text = texto;
  if (p.replyToId !== undefined) return criarResposta({ p, nota, conta, todas, rotulo });
  // Raiz.
  if (tarologa) {
    if (p.delivery || p.tarotId !== conta.tarotId) throw erro('Seu perfil não está vinculado ao cadastro profissional.');
  } else {
    validarDelivery(p.delivery, conta, contas);
    nota.delivery = p.delivery;
    if (p.delivery.kind === 'board') {
      if (!txt(p.subjectTarotId, 64) || p.subjectTarotId !== p.tarotId) throw erro('Escolha sobre qual tarólogo é o recado.');
      nota.subjectTarotId = p.subjectTarotId;
      nota.originalQuote = validarTexto(p.originalQuote ?? '', 'Mensagem original');
      if (p.originalQuoteFormatting !== undefined) nota.originalQuoteFormatting = p.originalQuoteFormatting;
    }
    if (p.importance !== undefined) {
      if (!objeto(p.importance) || p.importance.byId !== conta.id) throw erro('Somente quem enviou pode alterar a importância deste recado.');
      nota.importance = { byId: conta.id, at: agora };
    }
  }
  const per = validarPeriodo({ subject: p.subject ?? 'Diversos', startDate: p.startDate ?? p.date, endDate: p.endDate ?? p.startDate ?? p.date });
  return { ...nota, ...per };
}
const { dataValida } = d;

function criarResposta({ p, nota, conta, todas, rotulo }) {
  const r = raiz(todas, p.replyToId);
  if (!r || r.deletedAt) throw erro('Este aviso não está disponível para receber respostas.');
  if (!visivel(r, conta)) throw erro(conta.papel === 'tarologa' ? 'Esta conversa não pertence ao seu perfil.' : 'Esta conta não pode acessar a conversa.');
  if (r.id !== p.replyToId) throw erro(NAO_IDENTIFICADA);
  if (p.tarotId !== r.tarotId || p.tarot !== r.tarot || !igual(p.delivery, r.delivery) || (p.subjectTarotId ?? null) !== (r.subjectTarotId ?? null)) throw erro(NAO_IDENTIFICADA);
  const per = detalhes(r);
  if (!igual({ subject: p.subject, startDate: p.startDate, endDate: p.endDate }, per)) throw erro(NAO_IDENTIFICADA);
  if (!Number.isSafeInteger(p.replySequence) || p.replySequence < 1) throw erro(NAO_IDENTIFICADA);
  const saida = { ...nota, replyToId: r.id, replySequence: p.replySequence, tarotId: r.tarotId, tarot: r.tarot, ...per };
  if (r.delivery) saida.delivery = r.delivery;
  if (r.subjectTarotId) saida.subjectTarotId = r.subjectTarotId;
  if (p.okForId !== undefined) {
    const alvo = todas.find((n) => n.id === p.okForId);
    if (!alvo || (!alvo.delivery && alvo.source !== 'tarologist') || alvo.actorId === conta.id || alvo.deletedAt || raiz(todas, alvo.id)?.id !== r.id) throw erro('Escolha um recado do tarólogo para confirmar.');
    if (p.okForVersion !== versaoDe(alvo) || saida.text !== 'OK') throw erro(NAO_IDENTIFICADA);
    if (todas.some((n) => n.okForId === alvo.id && n.okForVersion === p.okForVersion && n.actorId === conta.id && !n.deletedAt)) throw erro(NAO_IDENTIFICADA);
    saida.okForId = p.okForId; saida.okForVersion = p.okForVersion;
  }
  void rotulo;
  return saida;
}

function proximaVersao(antes, agora) {
  const anterior = Date.parse(versaoDe(antes)); const novo = Date.parse(agora);
  return Number.isFinite(anterior) && novo <= anterior ? new Date(anterior + 1).toISOString() : agora;
}

function editar({ antes, pedido, conta, agora }) {
  const tarologista = antes.source === 'tarologist';
  const podeTarologa = tarologista && conta.papel === 'tarologa' && antes.actorId === conta.id;
  const podeEquipe = antes.source === 'staff' && equipe(conta.papel) && antes.actorId === conta.id;
  if (!(podeTarologa || podeEquipe) || antes.deletedAt) throw erro(tarologista ? 'Este recado não pode ser alterado por esta conta.' : 'Esta mensagem não pode ser editada por esta conta.');
  const remove = pedido.deletedAt !== undefined && antes.deletedAt === undefined;
  if (pedido.deletedAt !== undefined && !instanteOk(pedido.deletedAt)) throw erro(NAO_IDENTIFICADA);
  const rotulo = tarologista ? 'Recado' : 'Mensagem';
  let texto = antes.text;
  if (!remove) {
    texto = validarTexto(pedido.text, rotulo, true);
  } else if (pedido.text !== antes.text) throw erro(NAO_IDENTIFICADA);
  const per = antes.replyToId || remove ? detalhes(antes) : validarPeriodo({ subject: pedido.subject ?? detalhes(antes).subject, startDate: pedido.startDate ?? detalhes(antes).startDate, endDate: pedido.endDate ?? detalhes(antes).endDate });
  if (antes.replyToId && !igual({ subject: pedido.subject, startDate: pedido.startDate, endDate: pedido.endDate }, per)) throw erro(NAO_IDENTIFICADA);
  let citacao = {};
  if (!tarologista && antes.delivery && antes.delivery.kind === 'board' && !antes.replyToId) {
    citacao = { originalQuote: validarTexto(pedido.originalQuote ?? antes.originalQuote ?? '', 'Mensagem original') };
    if (pedido.originalQuoteFormatting !== undefined) citacao.originalQuoteFormatting = pedido.originalQuoteFormatting;
  } else if (pedido.originalQuote !== antes.originalQuote) throw erro(NAO_IDENTIFICADA);
  const rv = antes.revisions || []; const nv = pedido.revisions;
  if (!Array.isArray(nv) || nv.length !== rv.length + 1 || nv.length > 300 || !igual(nv.slice(0, rv.length), rv)) throw erro('O histórico do recado só pode crescer.');
  const nova = nv[nv.length - 1];
  if (!objeto(nova) || nova.version !== versaoDe(antes) || nova.text !== antes.text) throw erro(NAO_IDENTIFICADA);
  const versao = proximaVersao(antes, agora);
  const item = { ...antes, ...per, ...citacao, text: texto, updatedAt: versao, revisions: [...rv, { ...nova, at: versao, by: conta.nome }] };
  if (pedido.formatting !== undefined) item.formatting = pedido.formatting; else delete item.formatting;
  if (remove) item.deletedAt = agora;
  delete item.notifiedAt; delete item.notifiedBy;
  if (!citacao.originalQuote && antes.originalQuote === undefined) delete item.originalQuote;
  return item;
}

/** Aplica o pedido sobre o recado guardado. Devolve `{ item, conteudo, pessoal }`; `pessoal` só traz o que a conta mudou nela mesma. */
function aplicar({ antes, pedido, conta, agora, todas, contas, pessoalAntes }) {
  if (!antes) return { item: criar({ pedido, conta, agora, todas, contas }), conteudo: true, criou: true, pessoal: {} };
  if (!visivel(raiz(todas, antes.id) || antes, conta)) throw erro('Esta conta não pode acessar a conversa.');
  const p = limpo(pedido); const a = limpo(antes);
  const proibidas = [...new Set([...Object.keys(a), ...Object.keys(p)])].filter((k) => ![...CONTEUDO, ...ESPECIAIS].includes(k));
  if (proibidas.some((k) => !igual(a[k], p[k]))) throw erro(NAO_IDENTIFICADA);
  let item = a; let conteudo = false;
  if (CONTEUDO.some((k) => !igual(a[k], p[k]))) { item = editar({ antes: a, pedido: p, conta, agora }); conteudo = true; }
  if (!conteudo && !igual(a.importance, p.importance)) {
    if (!(antes.source === 'staff' && equipe(conta.papel) && antes.actorId === conta.id && !antes.deletedAt)) throw erro('Somente quem enviou pode alterar a importância deste recado.');
    if (p.importance !== undefined && (!objeto(p.importance) || p.importance.byId !== conta.id)) throw erro('Informe uma importância válida para o recado.');
    item = { ...item }; if (p.importance) item.importance = a.importance || { byId: conta.id, at: agora }; else delete item.importance;
  }
  if (!igual(a.agendaApplications, p.agendaApplications)) {
    const ant = a.agendaApplications || []; const nov = p.agendaApplications;
    if (!equipe(conta.papel) || !Array.isArray(nov) || nov.length !== ant.length + 1 || !igual(nov.slice(0, ant.length), ant)) throw erro(NAO_IDENTIFICADA);
    const e = nov[nov.length - 1];
    if (!objeto(e) || !dataValida(e.startDate) || !dataValida(e.endDate) || typeof e.hours !== 'string' || e.hours.length > 200 || typeof e.version !== 'string') throw erro(NAO_IDENTIFICADA);
    item = { ...item, agendaApplications: [...ant, { at: agora, by: conta.nome, actorId: conta.id, startDate: e.startDate, endDate: e.endDate, hours: e.hours, version: e.version }] };
  }
  if (!conteudo && (a.notifiedAt !== p.notifiedAt || a.notifiedBy !== p.notifiedBy)) {
    if (a.notifiedAt || antes.actorId !== conta.id || antes.delivery || antes.source !== 'staff') throw erro(NAO_IDENTIFICADA);
    item = { ...item, notifiedAt: agora, notifiedBy: conta.nome };
  }
  const pessoal = pessoalDe({ antes: item, pedido, conta, agora, conteudo, pessoalAntes });
  return { item, conteudo, criou: false, pessoal };
}

/** Lido, fixado, prioridade e arquivado SÓ da própria conta (`organizeNote`, `acknowledge`, `archiveStaff|Own`). */
function pessoalDe({ antes, pedido, conta, agora, conteudo, pessoalAntes }) {
  const saida = {}; const eu = conta.id;
  const lida = pedido.readsByAccount && pedido.readsByAccount[eu];
  const guardada = pessoalAntes && pessoalAntes.lido_versao;
  if (!conteudo && objeto(lida) && lida.version === versaoDe(antes) && guardada !== lida.version && antes.actorId !== eu && !antes.deletedAt) saida.lido = { em: agora, por: conta.nome, versao: lida.version };
  const marca = (campo, coluna, chave) => {
    const quer = Boolean(pedido[campo] && pedido[campo][eu]); const tem = Boolean(pessoalAntes && pessoalAntes[coluna]);
    if (quer !== tem) saida[chave] = quer ? agora : null;
  };
  marca('pinnedByAccount', 'fixado_em', 'fixado'); marca('prioritizedByAccount', 'prioridade_em', 'prioridade');
  const arq = pedido.archivedByAccount && pedido.archivedByAccount[eu];
  const arqAntes = pessoalAntes ? pessoalAntes.arquivado : null;
  if (arq !== undefined || arqAntes) {
    if (arq !== undefined && (!objeto(arq) || !objeto(arq.incomingVersions) || Object.values(arq.incomingVersions).some((x) => typeof x !== 'string'))) throw erro('Informe uma organização válida para a conversa.');
    const novo = arq === undefined ? null : { at: agora, incomingVersions: arq.incomingVersions };
    if (estavel(novo && novo.incomingVersions) !== estavel(arqAntes && arqAntes.incomingVersions)) saida.arquivado = novo;
  }
  if (conteudo) saida.limparLeituras = true;
  return saida;
}

module.exports = { aplicar, criar, editar, pessoalDe, IGNORADAS, CONTEUDO, ESPECIAIS };
