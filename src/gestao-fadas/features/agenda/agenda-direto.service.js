'use strict';

/**
 * Agendamento direto e edição (`POST /agenda`, `PATCH /agenda/:id`): o servidor repete o que o front decide ao salvar o formulário
 * "Agendar cliente" (Maturacao/56, C1; domínio em `_comum/dominio/agenda-agendamento-direto.js`). Roda DENTRO da transação da gravação.
 * O fluxo Fila Geral -> tarólogo tem validação própria (`painel-validacao`) e fica fora daqui.
 */

const { RegraDoPainelError } = require('../../_comum/dominio/painel-validacao');
const direto = require('../../_comum/dominio/agenda-agendamento-direto');
const comum = require('./agenda.comum');
const adm = require('./agenda-admissao.store');
const contexto = require('./agenda-painel.contexto');
const contatosStore = require('./agenda-contatos.store');

// Flag (desligada por padrão): exigir um dos 5 meios de consulta atuais ao agendar. Os dados antigos têm "WhatsApp" e continuam legíveis.
const exigirModalidade = () => `${process.env.GF_AGENDA_MODALIDADE_OBRIGATORIA || ''}`.trim().toLowerCase() === 'true';

const FILA_GERAL = 'afila';
const traduzir = (e) => { if (e instanceof RegraDoPainelError) return comum.regra(e.message); return e; };

/** O alvo do agendamento mudou (cliente, tarólogo, dia, "se der hoje" ou horário marcado)? Só então a edição repete a admissão. */
const alvoMudou = (a, b) => ['clientId', 'leadId', 'tarotId', 'date', 'standbyDate', 'scheduledTime'].some((k) => (a[k] || '') !== (b[k] || ''));

/**
 * @param {object} p `{ antes?: AgendaItem, item: AgendaItem (já com o comando aplicado), grupo, set, agora (ms) }`
 */
async function conferir(ex, { antes, item, grupo, set, agora }) {
  try {
    if (grupo === 'agendamento') direto.conferirCobertura(antes, set || {});
    if (antes && (!['agendamento', 'saidas'].includes(grupo) || !alvoMudou(antes, item))) return;
    const entrada = await contexto.carregarEntrada(ex, { tarotId: item.tarotId, agora });
    const data = item.date || entrada.date;
    const solicitacao = item.requestId ? ((await adm.solicitacaoTravada(ex, item.requestId)) || {}).item : undefined;
    const contacts = item.leadId ? (await contatosStore.todos(ex)).map((r) => r.item) : [];
    direto.validarAgendamentoDireto({ ...entrada, contacts, exigirModalidade: exigirModalidade(), intakeEvents: await adm.eventosDoDia(ex, item.tarotId, item.standbyDate || data) },
      { antes, id: item.id, depois: { ...item, date: data }, solicitacao, tarologoDesconhecido: item.tarotId !== FILA_GERAL && entrada.catalogoLido && !entrada.cadastro });
  } catch (e) { throw traduzir(e); }
}

module.exports = { conferir, alvoMudou };
