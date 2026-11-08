'use strict';

/**
 * Peças comuns das ações v710 (`reserve_tarologist`, `release_reservation`, `close_consultation`, `open_continuation`, `reorder_appointment`).
 *  - assinaturas EXATAS da Lilly (`rowSignature` da reserva; hash da linha do contexto para consulta e posição), calculadas sobre a MESMA linha que o
 *    contexto entregou (`montador.agenda`/`montador.consultas`);
 *  - revisão otimista (`revision` do snapshot, inteiro) recalculada na hora de gravar: divergência = 409 definitivo `LILLY_REVISION_CHANGED`;
 *  - prova da origem: o evento citado existe em `gf_lilly_eventos` (a API só confia em evento que ela mesma resolveu).
 */

const { createHash } = require('crypto');
const eventos = require('../dados/eventos.repo');
const { recusar } = require('../executores/executores.comum');
const { revisaoAtual } = require('../contexto/revisao');
const { linhaParaAgendamento } = require('../contexto/montador.agenda');
const { linhaParaConsulta } = require('../contexto/montador.consultas');
const { hojeOperacional } = require('../../../_comum/dia-operacional');

const chave = (v) => (v == null ? '' : String(v));
const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ID = /^[A-Za-z0-9._:-]{1,64}$/;
const JANELA_ORIGEM_MS = 24 * 3600 * 1000;

/** `rowSignature` de server/lilly/reservation-flow.mjs, sobre a linha de agendamento do contexto. */
function assinaturaDaReserva(a) {
  const reserva = chave(a.queueReservation?.tarologistId ?? a.queueReservation?.tarotId ?? a.reservedTarologistId);
  const origem = a.generalQueueEnteredAt || a.queueEnteredAt || a.createdAt;
  return JSON.stringify([chave(a.id), chave(a.clientId), chave(a.tarologistId ?? a.tarotId), a.revision ?? null, a.status || null, a.position ?? null, a.date || null,
    a.scheduledTime || null, reserva, a.queueReservation?.at || null, origem, a.channel || null]);
}
/** `rowFingerprint`/`snapshotFingerprint` de staff-agenda-commands.mjs e consultation-closing.mjs: sha256 do JSON da linha do contexto. */
const impressaoDaLinha = (linha) => sha(linha);

/** Linha do agendamento como o contexto a entrega (com `effectivePosition` quando a fila do tarólogo foi apurada). */
function agendamentoDoContexto(linhaBanco, { agora = Date.now(), ordem } = {}) {
  const hoje = hojeOperacional(new Date(agora));
  const row = linhaParaAgendamento(linhaBanco, { agora, hoje });
  if (ordem && ordem.includes(row.id)) row.effectivePosition = ordem.indexOf(row.id) + 1;
  return row;
}
const consultaDoContexto = (linhaBanco) => linhaParaConsulta(linhaBanco);

/** `revision` inteiro e presente; igual à atual. Recusa definitiva 409 se mudou. */
async function exigirRevisao(esperada, motivo = 'Os registros mudaram desde a leitura da Lilly. Reconfira antes de agir.') {
  if (!Number.isSafeInteger(esperada)) recusar('INVALID_INPUT', 'A ação precisa da revisão (expectedRevision, inteiro) lida no contexto.', 400);
  if ((await revisaoAtual()) !== esperada) recusar('LILLY_REVISION_CHANGED', motivo, 409);
}

/**
 * O evento citado (`ref` = id ou messageId) existe e: `staff` (autoria humana: staffAuthorized, interno, mesmo `staffId` do autor), ou `cliente`
 * (mensagem pública da cliente). Recusa 422 sem prova. Devolve o evento. `clientId`: se o evento traz cliente, tem de ser a da ação.
 */
async function provarOrigem(executor, { ref, tipo, autorId, clientId, conversationId, agora = Date.now() }) {
  const texto = typeof ref === 'string' ? ref.trim() : '';
  if (!texto || texto.length > 200) recusar('LILLY_SOURCE_MISSING', 'A ação não cita o evento de origem.', 422);
  const e = await eventos.buscarEventoDeOrigem(executor, texto);
  if (!e) recusar('LILLY_SOURCE_MISSING', 'Não encontrei o evento de origem desta ação.', 422);
  if (clientId && e.clientId && e.clientId !== `${clientId}`) recusar('LILLY_SOURCE_MISMATCH', 'O evento de origem é de outra cliente.', 422);
  if (conversationId && e.conversationId !== conversationId) recusar('LILLY_SOURCE_MISMATCH', 'O evento de origem é de outra conversa.', 422);
  if (!Number.isFinite(Date.parse(e.at)) || agora - Date.parse(e.at) > JANELA_ORIGEM_MS) recusar('LILLY_SOURCE_STALE', 'O evento de origem é antigo demais.', 422);
  if (tipo === 'staff') {
    const d = e.data || {};
    if (e.actor !== 'staff' || e.internal !== true || d.staffAuthorized !== true || !autorId || chave(d.staffId) !== chave(autorId)) recusar('LILLY_AUTHORIZATION_MISSING', 'Não encontrei a autorização da equipe para esta ação.', 422);
  } else if (tipo === 'cliente') {
    if (e.actor !== 'client' || e.internal !== false) recusar('LILLY_SOURCE_MISMATCH', 'O evento de origem não é uma mensagem da cliente.', 422);
  }
  return e;
}

const autorValido = (a) => Boolean(a) && typeof a === 'object' && typeof a.id === 'string' && a.id.trim() && typeof a.name === 'string' && a.name.trim() && a.id.length <= 160 && a.name.length <= 160;

module.exports = { chave, sha, ID, assinaturaDaReserva, impressaoDaLinha, agendamentoDoContexto, consultaDoContexto, exigirRevisao, provarOrigem, autorValido };
