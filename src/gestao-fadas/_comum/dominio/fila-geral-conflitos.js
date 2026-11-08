'use strict';

/**
 * Bloqueios da Fila Geral ao encaminhar/agendar (domínio puro), Site v710 da Nice (correção c0ce39e). Porte de `features/agenda/general-queue-conflicts.ts`
 * (`assertNoGeneralQueueConflict`): valida a origem pendente E o destino proposto; dias futuros distintos ou dois relógios explícitos diferentes provam
 * pedidos independentes; um relógio novo sozinho não resolve outro pedido de horário desconhecido. Ouro: scripts/gerar-ouro-gf-lilly-v710.js.
 */

const { encerrado, dataDeOrigem, ehDataCivil } = require('./agenda-contato');
const { lerPlano, normalizarRelogio } = require('./agenda-etiqueta');
const { mesmaIdentidade } = require('./agenda-identidade');
const { mesmaOcorrencia } = require('./agenda-ocorrencia');
const { FILA_GERAL } = require('./fila-geral-base');

const pendente = (item) => !encerrado(item) && item.workflowStatus !== 'Concluída';

/** `independentAppointments`. */
function independentes(a, b, hoje) {
  const dataA = dataDeOrigem(a, hoje); const dataB = dataDeOrigem(b, hoje);
  if (!ehDataCivil(dataA) || !ehDataCivil(dataB)) return false;
  if ((dataA < hoje ? hoje : dataA) !== (dataB < hoje ? hoje : dataB)) return true;
  if (dataA < hoje || dataB < hoje) return false;
  const planoA = lerPlano(a); const planoB = lerPlano(b);
  if (!['exact', 'approximate'].includes(planoA.timing) || !['exact', 'approximate'].includes(planoB.timing)) return false;
  const relogioA = normalizarRelogio(planoA.time ?? ''); const relogioB = normalizarRelogio(planoB.time ?? '');
  return Boolean(relogioA && relogioB && relogioA !== relogioB);
}

class ConflitoDaFilaGeralError extends Error {
  constructor(existente, { nomeDaProfissional }) {
    const nome = nomeDaProfissional ? `${nomeDaProfissional(existente.tarotId) || ''}`.trim() : '';
    const lugar = existente.tarotId === FILA_GERAL ? ' na Fila Geral' : nome ? ` com ${nome}` : '';
    super(`A cliente já tem outro agendamento${lugar}. Confira sua ficha antes de transferir.`);
    this.name = 'ConflitoDaFilaGeralError'; this.existente = existente;
  }
}

/** `assertNoGeneralQueueConflict(agenda, origem, candidato, { today, now, professionalName })`. */
function exigirSemConflitoDaFilaGeral(agenda, origem, candidato, opcoes) {
  const { hoje, agora } = opcoes;
  const conflito = agenda.find((o) => o.id !== origem.id && pendente(o) && mesmaIdentidade(o, origem)
    && ((o.tarotId === FILA_GERAL && mesmaOcorrencia(o, origem, hoje, agora)) || !independentes(o, candidato, hoje)));
  if (conflito) throw new ConflitoDaFilaGeralError(conflito, opcoes);
}

module.exports = { exigirSemConflitoDaFilaGeral, ConflitoDaFilaGeralError, independentes };
