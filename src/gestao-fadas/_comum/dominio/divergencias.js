'use strict';

/**
 * Divergências (Maturacao/31): regras PURAS portadas do CÓDIGO do front, sem banco nem HTTP.
 *   - estado de abertura: `domain/divergence-state.ts` (`isOpenDivergence`);
 *   - visibilidade da taróloga: `tarologist-divergences-model.ts` (`readerDivergences`, `ownsReaderDivergence`);
 *   - visibilidade da equipe e quem resolve: `domain/permissions.ts` (`canViewFinancialDivergences`, `canResolve*`);
 *   - transições da taróloga (editar, retirar/arquivar, excluir, restaurar, desarquivar, comentar, limpar lixeira): `changeReaderDivergence`,
 *     `appendDivergenceComment`, `clearReaderDivergenceTrash`; da equipe: `divergence-detail-dialog.tsx` (`takeForReview`, `resolveSelected`,
 *     `sendComment`) e a Financeira de `consultations-experience.tsx:1583` (criar, ou reescrever a aberta da mesma consulta).
 * O servidor NÃO refaz a edição (o front monta o registro): confere FORMA, INVARIANTES e a transição, e carimba autor e instante dos eventos
 * novos. O ouro (`scripts/gerar-ouro-gf-divergencias.js`) roda as funções reais do front e exige que o porte aceite tudo o que elas produzem.
 */

class DivergenciaInvalidaError extends Error { constructor(m) { super(m); this.name = 'DivergenciaInvalidaError'; } }
const falha = (m) => { throw new DivergenciaInvalidaError(m); };

const TIPOS = ['Operacional', 'Financeira'];
const AREAS = ['Consulta', 'Pagamento', 'Repasse'];
const SITUACOES = ['Pendente', 'Em conferência', 'Resolvida', 'Arquivada'];
const ASSUNTOS = ['Consulta ausente', 'Profissional incorreto', 'Minutagem incorreta', 'Outro'];
const ACOES = ['Relato editado', 'Retirada e arquivada', 'Arquivada', 'Excluída', 'Restaurada', 'Desarquivada', 'Removida da lixeira do tarólogo'];
const INSTANTES = ['createdAt', 'updatedAt', 'resolvedAt', 'archivedAt', 'deletedAt', 'readerTrashClearedAt'];
const AUTORES = { resolvedAt: 'resolvedBy', archivedAt: 'archivedBy', deletedAt: 'deletedBy', readerTrashClearedAt: 'readerTrashClearedBy' };
const LIMITE_TEXTO = 4000;

const texto = (v) => typeof v === 'string';
const instante = (v) => texto(v) && Number.isFinite(Date.parse(v));
const aberta = (d) => !d.deletedAt && (d.status === 'Pendente' || d.status === 'Em conferência');
const dela = (d, tarotId) => Boolean(tarotId) && d.kind === 'Operacional' && d.reporterTarotId === tarotId;
const visivelDaTarologa = (d, tarotId) => !(d.deletedAt && d.readerTrashClearedAt) && Boolean(tarotId) && d.kind === 'Operacional' && (d.reporterTarotId === tarotId || (!d.reporterTarotId && d.tarotId === tarotId));
const visivelParaEquipe = (d, p) => Boolean(p.canViewDivergences) && (d.kind === 'Operacional' || Boolean(p.canViewFinancialDivergences));

/** Quem vê o quê. `ator`: `{ tarologa, proprio, p }`. */
const visivel = (d, ator) => (ator.tarologa ? visivelDaTarologa(d, ator.proprio) : visivelParaEquipe(d, ator.p));

function opcional(d, campo, tipo) { if (d[campo] !== undefined && typeof d[campo] !== tipo) falha(`Divergência: ${campo} inválido.`); }

/** Forma do registro (o `Divergence` de `domain/types.ts:680`). */
function forma(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) falha('Divergência inválida.');
  if (!texto(d.id) || !/^[A-Za-z0-9._:-]{1,64}$/.test(d.id)) falha('Divergência: identificador inválido.');
  if (!TIPOS.includes(d.kind)) falha('Divergência: tipo inválido.');
  if (!AREAS.includes(d.area) || (d.kind === 'Operacional' && d.area !== 'Consulta')) falha('Divergência: área inválida.');
  if (!SITUACOES.includes(d.status)) falha('Divergência: situação inválida.');
  if (d.issueType !== undefined && !ASSUNTOS.includes(d.issueType)) falha('Divergência: assunto inválido.');
  if (!texto(d.clientId) || (d.clientId !== '' && !/^[1-9]\d{0,9}$/.test(d.clientId))) falha('Divergência: ID da cliente inválido.');
  if (!texto(d.client) || !d.client.trim() || d.client.length > 200) falha('Divergência: cliente inválida.');
  if (!texto(d.reason) || !d.reason.trim() || d.reason.length > LIMITE_TEXTO) falha('Descreva o que precisa ser conferido (até 4.000 caracteres).');
  if (!texto(d.reportedBy) || !d.reportedBy.trim() || d.reportedBy.length > 200) falha('Divergência: autor inválido.');
  if (!instante(d.createdAt)) falha('Divergência: data inválida.');
  for (const c of ['consultationId', 'paymentId', 'tarotId', 'tarot', 'reporterTarotId']) opcional(d, c, 'string');
  for (const c of ['reportNote', 'decision', 'resolvedBy', 'archiveReason', 'deleteReason', 'reportedClientName', 'reportedClientPhone', 'reportedDate', 'reportedTime', 'reportedChannel']) opcional(d, c, 'string');
  for (const c of INSTANTES) if (d[c] !== undefined && !instante(d[c])) falha('Divergência: data inválida.');
  for (const c of ['reportedMinutes', 'recordedMinutes', 'amount']) if (d[c] !== undefined && !(typeof d[c] === 'number' && Number.isFinite(d[c]) && d[c] >= 0)) falha('Divergência: valor inválido.');
  for (const c of ['id', 'consultationId', 'paymentId', 'tarotId', 'reporterTarotId']) if (d[c] !== undefined && !/^[A-Za-z0-9._:-]{1,64}$/.test(d[c])) falha('Divergência: vínculo inválido.');
  if (d.statusBeforeArchive !== undefined && !['Pendente', 'Em conferência', 'Resolvida'].includes(d.statusBeforeArchive)) falha('Divergência: situação anterior inválida.');
  if (d.clientIdentificationPending !== undefined && typeof d.clientIdentificationPending !== 'boolean') falha('Divergência: identificação inválida.');
  if (d.history !== undefined) {
    if (!Array.isArray(d.history) || d.history.length > 500) falha('Divergência: histórico inválido.');
    for (const e of d.history) {
      if (!e || !texto(e.id) || !e.id || !ACOES.includes(e.action) || !texto(e.actor) || !e.actor.trim() || !instante(e.at) || (e.note !== undefined && !texto(e.note))) falha('Divergência: histórico inválido.');
      for (const lado of [e.before, e.after]) if (!lado || !texto(lado.reason) || !SITUACOES.includes(lado.status)) falha('Divergência: histórico inválido.');
    }
  }
  if (d.comments !== undefined) {
    if (!Array.isArray(d.comments) || d.comments.length > 500) falha('Divergência: comentários inválidos.');
    for (const c of d.comments) {
      if (!c || !texto(c.id) || !c.id || !instante(c.at) || !texto(c.actor) || !c.actor.trim() || !texto(c.text) || !c.text.trim() || c.text.length > LIMITE_TEXTO || !['tarologist', 'staff'].includes(c.source)) falha('Divergência: comentário inválido.');
      if (c.formatting !== undefined && (typeof c.formatting !== 'object' || c.formatting === null || JSON.stringify(c.formatting).length > 20000)) falha('Divergência: comentário inválido.');
    }
  }
  return d;
}

const estavel = (v) => {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${estavel(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
};
const igual = (a, b) => estavel(a) === estavel(b);
const mesmo = (a, b, campos) => campos.every((c) => igual(a[c], b[c]));
const prefixo = (antes = [], depois = []) => depois.length >= antes.length && igual(antes, depois.slice(0, antes.length));

/** Uma aberta da mesma leitora para o mesmo assunto (`tarologist-operations-experience.tsx:408` e `missingConsultationError`). */
function repetida(nova, outras, tarotId) {
  const minhas = outras.filter((o) => o.id !== nova.id && visivelDaTarologa(o, tarotId) && aberta(o));
  if (nova.consultationId && nova.issueType && minhas.some((o) => o.consultationId === nova.consultationId && o.issueType === nova.issueType)) return 'Essa divergência já está aguardando análise.';
  if (nova.issueType === 'Consulta ausente' && minhas.some((o) => o.issueType === 'Consulta ausente' && (nova.clientId ? o.clientId === nova.clientId : !o.clientId && (o.reportedClientName || o.reportedClientPhone) === (nova.reportedClientName || nova.reportedClientPhone))
    && o.reportedDate === nova.reportedDate && o.reportedTime === nova.reportedTime)) return 'Esta consulta já tem um pedido de conferência aberto. Acompanhe em Divergências.';
  return null;
}

const SEM_RESOLUCAO = ['resolvedBy', 'resolvedAt', 'decision', 'archivedAt', 'archivedBy', 'archiveReason', 'statusBeforeArchive', 'deletedAt', 'deletedBy', 'deleteReason', 'readerTrashClearedAt', 'readerTrashClearedBy'];

/** Criação: a taróloga cria Operacional dela, Pendente; a equipe cria Financeira, Pendente. */
function conferirCriacao(d, ator) {
  if (d.status !== 'Pendente') falha('Não foi possível enviar o pedido. Confira os dados e tente novamente.');
  if ((d.history && d.history.length) || (d.comments && d.comments.length) || SEM_RESOLUCAO.some((c) => d[c] !== undefined)) falha('Não foi possível enviar o pedido. Confira os dados e tente novamente.');
  if (ator.tarologa) {
    if (d.kind !== 'Operacional' || d.area !== 'Consulta' || !ator.proprio || d.tarotId !== ator.proprio || (d.reporterTarotId !== undefined && d.reporterTarotId !== ator.proprio)) falha('Você só pode enviar divergências em seu nome.');
    return;
  }
  if (d.kind !== 'Financeira') falha('A equipe registra aqui apenas divergências financeiras.');
}

/** Transição de um registro existente. Devolve a classe da mudança (para auditoria e para quem pode). */
function conferirTransicao(antes, depois, ator) {
  if (!mesmo(antes, depois, ['id', 'kind', 'area'])) falha('Não foi possível identificar esta alteração.');
  if (!prefixo(antes.history, depois.history) || !prefixo(antes.comments, depois.comments)) falha('O histórico da divergência não pode ser apagado.');
  const eventos = (depois.history || []).slice((antes.history || []).length);
  const notas = (depois.comments || []).slice((antes.comments || []).length);
  const fixos = ['issueType', 'paymentId', 'recordedMinutes', 'reportedClientName', 'reportedClientPhone'];
  if (!mesmo(antes, depois, fixos)) falha('Não foi possível identificar esta alteração.');
  if (ator.tarologa) return transicaoDaTarologa(antes, depois, ator, eventos, notas);
  return transicaoDaEquipe(antes, depois, eventos, notas);
}

function transicaoDaTarologa(antes, depois, ator, eventos, notas) {
  if (!dela(antes, ator.proprio)) falha('Você só pode alterar divergências que enviou.');
  if (!mesmo(antes, depois, ['clientId', 'client', 'tarotId', 'tarot', 'reporterTarotId', 'consultationId', 'reportedBy', 'createdAt', 'clientIdentificationPending', 'resolvedBy', 'resolvedAt', 'decision'])) falha('Você só pode alterar divergências que enviou.');
  if (notas.some((c) => c.source !== 'tarologist')) falha('Você não pode comentar nesta divergência.');
  if (notas.length) {
    if (eventos.length || antes.deletedAt || antes.status === 'Arquivada') falha('Esta divergência não recebe novos comentários.');
    if (!mesmo(antes, depois, ['status', 'reason', 'reportNote', 'reportedMinutes', 'reportedDate', 'reportedTime', 'reportedChannel', 'deletedAt', 'archivedAt', 'readerTrashClearedAt'])) falha('Não foi possível identificar esta alteração.');
    return notas.length === 1 ? 'comentario' : falha('Envie um comentário por vez.');
  }
  if (eventos.length !== 1) falha('Não foi possível identificar esta alteração.');
  const [e] = eventos;
  const sit = (x) => x.status;
  if (antes.deletedAt && !['Restaurada', 'Removida da lixeira do tarólogo'].includes(e.action)) falha('Esta divergência foi excluída.');
  if (antes.status === 'Arquivada' && !antes.deletedAt && !['Excluída', 'Desarquivada'].includes(e.action)) falha('Esta divergência já está arquivada.');
  switch (e.action) {
    case 'Excluída':
      if (antes.deletedAt || !depois.deletedAt || !depois.deleteReason || sit(depois) !== sit(antes)) falha('Informe o motivo da exclusão.');
      return 'exclusao';
    case 'Restaurada':
      if (!antes.deletedAt || antes.readerTrashClearedAt || depois.deletedAt || sit(depois) !== 'Arquivada') falha('Este relato já saiu da sua lixeira.');
      return 'restauracao';
    case 'Desarquivada': {
      if (antes.deletedAt || antes.status !== 'Arquivada') falha('Esta divergência não está arquivada.');
      const alvo = antes.statusBeforeArchive === 'Resolvida' || antes.resolvedAt ? 'Resolvida' : 'Pendente';
      if (sit(depois) !== alvo || depois.archivedAt !== undefined) falha('Esta divergência não está arquivada.');
      return 'desarquivar';
    }
    case 'Arquivada': case 'Retirada e arquivada': {
      if (antes.status === 'Arquivada' || sit(depois) !== 'Arquivada' || !depois.archivedAt || depois.statusBeforeArchive !== antes.status || (e.action === 'Retirada e arquivada') !== aberta(antes)) falha('Esta divergência já está arquivada.');
      return 'arquivo';
    }
    case 'Relato editado':
      if (!aberta(antes) || sit(depois) !== sit(antes)) falha('A conferência já foi concluída. O relato original permanece no histórico.');
      return 'edicao';
    case 'Removida da lixeira do tarólogo':
      if (!antes.deletedAt || antes.readerTrashClearedAt || !depois.readerTrashClearedAt || sit(depois) !== sit(antes)) falha('A lixeira foi atualizada. Confira a lista novamente.');
      return 'lixeira';
    default: return falha('Não foi possível identificar esta alteração.');
  }
}

function transicaoDaEquipe(antes, depois, eventos, notas) {
  if (eventos.length) falha('Não foi possível identificar esta alteração.');
  if (notas.some((c) => c.source !== 'staff')) falha('Você não pode comentar nesta divergência.');
  if (!mesmo(antes, depois, ['deletedAt', 'deletedBy', 'deleteReason', 'readerTrashClearedAt', 'archivedAt', 'archivedBy', 'archiveReason', 'statusBeforeArchive'])) falha('Esta divergência não pode ser alterada pela equipe.');
  if (notas.length) {
    if (antes.deletedAt || antes.status === 'Arquivada') falha('Esta divergência não recebe novos comentários.');
    if (notas.length !== 1) falha('Envie um comentário por vez.');
  }
  if (antes.status === 'Arquivada' || antes.deletedAt) {
    if (!igual(antes, depois) && !notas.length) falha('Esta divergência não pode ser alterada pela equipe.');
  }
  const classe = classeDaEquipe(antes, depois, notas);
  if (classe !== 'reescrita' && !mesmo(antes, depois, ['tarotId', 'tarot', 'reportedBy', 'createdAt', 'reason', 'reportNote', 'reportedMinutes', 'reportedDate', 'reportedTime', 'reportedChannel'])) falha('Não foi possível identificar esta alteração.');
  return classe;
}

function classeDaEquipe(antes, depois, notas) {
  const de = antes.status; const para = depois.status;
  if (de === para) {
    // Financeira aberta reescrita pela equipe (`consultations-experience.tsx:1583`): mesma consulta, razão e autor novos.
    if (antes.kind === 'Financeira' && aberta(antes) && !notas.length && !igual(antes, depois)) {
      if (!mesmo(antes, depois, ['consultationId'])) falha('Não foi possível identificar esta alteração.');
      return 'reescrita';
    }
    return notas.length ? 'comentario' : 'nada';
  }
  if (para === 'Em conferência') { if (de !== 'Pendente') falha('A conferência já foi iniciada.'); return 'conferencia'; }
  if (para === 'Pendente') { if (antes.kind !== 'Financeira' || de !== 'Em conferência') falha('Não foi possível identificar esta alteração.'); return 'reescrita'; }
  if (para === 'Resolvida') {
    if (!aberta(antes)) falha('Este relato foi atualizado. Reabra a divergência antes de aplicar a decisão.');
    if (!texto(depois.decision) || !depois.decision.trim() || !depois.resolvedBy || !depois.resolvedAt) falha('Informe a decisão da conferência.');
    return 'resolucao';
  }
  return falha('Não foi possível identificar esta alteração.');
}

/** O que a equipe precisa poder para a classe de mudança: resolver (operacional ou financeira) ou só ver (comentar). */
const exigeResolver = (classe) => ['conferencia', 'resolucao'].includes(classe);

/** Carimbo do servidor: instantes e autores que mudaram (ou são novos) passam a ser os dele e o da sessão. */
function carimbar(antes, depois, nome, agora) {
  const reg = { ...depois };
  const mudou = (campo) => !antes || depois[campo] !== antes[campo];
  for (const campo of INSTANTES) {
    if (reg[campo] === undefined || !mudou(campo)) continue;
    reg[campo] = agora;
    if (AUTORES[campo]) reg[AUTORES[campo]] = nome;
  }
  if (!antes || mudou('createdAt')) reg.reportedBy = nome;
  const n0 = antes && antes.history ? antes.history.length : 0;
  const c0 = antes && antes.comments ? antes.comments.length : 0;
  if (reg.history) reg.history = reg.history.map((e, i) => (i < n0 ? e : { ...e, at: agora, actor: nome }));
  if (reg.comments) reg.comments = reg.comments.map((c, i) => (i < c0 ? c : { ...c, at: agora, actor: nome }));
  if (antes && ((reg.history || []).length > n0 || (reg.comments || []).length > c0)) reg.updatedAt = agora;
  return reg;
}

module.exports = { DivergenciaInvalidaError, aberta, dela, visivel, visivelDaTarologa, visivelParaEquipe, forma, repetida, conferirCriacao, conferirTransicao, exigeResolver, carimbar, igual, estavel };
