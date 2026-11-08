'use strict';

/**
 * Duplicidade do agendamento (domínio puro), Site v710 da Nice. Porte de `features/agenda/agenda-duplicate.ts`:
 * `agendaDuplicateMatches`, `agendaDuplicateMessage`, `assertNoAgendaDuplicate`. Duplicado = mesmo pedido (`requestId`) OU mesma profissional (a reservada,
 * se a cliente está na Fila Geral com reserva vigente) + mesma identidade + mesma ocorrência. NÃO bloqueia todas as consultas futuras de uma pessoa.
 * Ouro: scripts/gerar-ouro-gf-lilly-v710.js.
 */

const { encerrado, dataDeOrigem, ativoNoDia } = require('./agenda-contato');
const { mesmaIdentidade } = require('./agenda-identidade');
const { mesmaOcorrencia } = require('./agenda-ocorrencia');
const { compararFila } = require('./painel-ordem');
const { FILA_GERAL } = require('./fila-geral-base');
const { liberacaoImediataFeita } = require('./fila-geral');
const { diaOperacionalDe } = require('./painel-tempo');

const somarDias = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const ativo = (item) => !encerrado(item) && item.workflowStatus !== 'Concluída';
const profissional = (item) => (item.tarotId === FILA_GERAL && !liberacaoImediataFeita(item) ? (item.queueReservation && item.queueReservation.tarotId) ?? item.tarotId : item.tarotId);
const ORDINAIS = ['', 'primeira', 'segunda', 'terceira', 'quarta', 'quinta', 'sexta', 'sétima', 'oitava', 'nona', 'décima'];

/** `agendaDuplicateMatches(agenda, candidato, { today, now, excludeId })`. */
function duplicados(agenda, candidato, { hoje, agora, excluirId }) {
  return agenda.filter((item) => item.id !== (excluirId ?? candidato.id) && ativo(item) && (
    Boolean(candidato.requestId && item.requestId === candidato.requestId)
    || (profissional(item) === candidato.tarotId && mesmaIdentidade(item, candidato) && mesmaOcorrencia(item, candidato, hoje, agora))));
}

/** `agendaDuplicateMessage`. */
function mensagemDeDuplicidade(item, agenda, { hoje, agora, nomeDaProfissional }) {
  const origem = dataDeOrigem(item, hoje);
  const data = origem > hoje ? origem : hoje;
  const fila = agenda.filter((r) => profissional(r) === profissional(item) && ativo(r) && r.workflowStatus !== 'Em consulta' && ativoNoDia(r, data, hoje))
    .sort((a, b) => compararFila(a, b, agora, data, data === hoje));
  const indice = fila.findIndex((r) => r.id === item.id); const posicao = indice + 1;
  const ordinal = ORDINAIS[posicao] ?? `${posicao}ª`;
  const nome = (nomeDaProfissional || '').trim();
  const destino = item.tarotId === FILA_GERAL && !item.queueReservation ? 'na Fila Geral' : nome ? `na fila de ${nome}` : 'na fila desta profissional';
  const criado = item.createdAt && Number.isFinite(Date.parse(item.createdAt)) ? diaOperacionalDe(Date.parse(item.createdAt)) : undefined;
  const aviso = criado === somarDias(hoje, -1) ? ' O agendamento foi feito ontem.' : criado && criado !== hoje ? ` O agendamento foi feito em ${criado.split('-').reverse().join('/')}.` : '';
  return `Esta cliente já está ${destino}${indice >= 0 ? `, na ${ordinal} posição` : ''}.${aviso} Abra o agendamento existente.`;
}

class DuplicidadeDeAgendaError extends Error {
  constructor(existente, agenda, opcoes) { super(mensagemDeDuplicidade(existente, agenda, opcoes)); this.name = 'DuplicidadeDeAgendaError'; this.existente = existente; }
}

/** `assertNoAgendaDuplicate`: lança `DuplicidadeDeAgendaError` (a mensagem é a do front). */
function exigirSemDuplicidade(agenda, candidato, opcoes) {
  const d = duplicados(agenda, candidato, opcoes)[0];
  if (d) throw new DuplicidadeDeAgendaError(d, agenda, opcoes);
}

module.exports = { duplicados, mensagemDeDuplicidade, exigirSemDuplicidade, DuplicidadeDeAgendaError };
