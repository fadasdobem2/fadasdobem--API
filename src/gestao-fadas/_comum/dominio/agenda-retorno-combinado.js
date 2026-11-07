'use strict';

/**
 * Retorno combinado da cliente, "Retorno às HHh" (domínio puro), v706 da Nice. Porte de `features/agenda/agenda-contact-return.ts`:
 * `agendaContactReturnDueAt` e `activeAgendaContactReturn`. O front lê o início do dia da configuração da operação
 * (`operationVersionForDate(...).dayStart`, padrão 06:00); aqui ele entra por `inicioDoDia` (padrão '06:00') até a API ter essa configuração.
 * Ouro: scripts/gerar-ouro-gf-agenda-pedido.js.
 */

const { contatoDe, encerrado } = require('./agenda-contato');
const { normalizarRelogio } = require('./agenda-etiqueta');
const { somarDias } = require('./horarios');
const { hojeOperacional } = require('../dia-operacional');

const minutos = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Escolha: `{kind:'minutes',minutes:10|20|30}`, `{kind:'time',time}` ou `{kind:'none'}`. Devolve o ISO do retorno ou `undefined`. */
function prazoDoRetorno(escolha, agora, inicioDoDia = '06:00') {
  if (escolha.kind === 'none') return undefined;
  if (escolha.kind === 'minutes') {
    if (![10, 20, 30].includes(escolha.minutes)) throw new Error('Escolha 10, 20 ou 30 minutos.');
    return new Date(agora + escolha.minutes * 60000).toISOString();
  }
  const hora = normalizarRelogio(escolha.time);
  if (!hora) throw new Error('Informe um horário válido.');
  const hoje = hojeOperacional(new Date(agora));
  const data = minutos(hora) < minutos(inicioDoDia) ? somarDias(hoje, 1) : hoje;
  const prazo = new Date(`${data}T${hora}:00-03:00`).toISOString();
  if (Date.parse(prazo) <= agora) throw new Error('Escolha um horário que ainda não passou.');
  return prazo;
}

/** O retorno só vale enquanto a etiqueta "Chama depois" da mesma tentativa estiver ativa e for a do evento que o criou. */
function retornoVigente(item) {
  const contato = contatoDe(item);
  const valor = item.contactReturn;
  if (!valor || encerrado(item) || item.workflowStatus === 'Em consulta' || !contato.tags.includes('Chama depois') || valor.attempt !== contato.attempt) return undefined;
  const evento = [...(item.contactHistory || [])].reverse().find((r) => r.tag === 'Chama depois' && r.attempt === contato.attempt);
  return evento && evento.active && evento.id === valor.afterEventId ? valor : undefined;
}

module.exports = { prazoDoRetorno, retornoVigente };
