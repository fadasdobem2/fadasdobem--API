'use strict';

/**
 * Aplica um comando da Agenda a um `AgendaItem` (domínio puro). O front calcula o resultado com as funções dele; a API NÃO confia
 * nele (D9 do contrato 28): confere o grupo de campos da rota (`agenda-grupos.js`), as regras (`agenda-regras.js`), que as histórias só
 * cresceram, e carimba o autor dos eventos novos com a sessão. Devolve o item novo e os eventos a gravar em `gf_agenda_eventos`.
 *
 * Forma do comando: `{ set?, unset?, append?, restoreDepartures?, expectedContact?, expectedLatestId? }` (campo ausente fica ausente).
 */

const { GRUPOS, RESERVADOS, AUTOR_DA_HISTORIA, TIPO_DO_EVENTO } = require('./agenda-grupos');
const regras = require('./agenda-regras');
const { ehDataCivil, limpar } = require('./agenda-contato');

const { ErroDeRegra } = regras;
const invalido = (m) => new ErroDeRegra(m || 'Confira os dados informados e tente novamente.');
const ehObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const TAMANHO_MAXIMO = 262144;

const ID_TAROLOGO = /^[A-Za-z0-9._:@-]{1,64}$/;
/** Validação de forma por campo; o que não está aqui é objeto livre (limitado pelo tamanho do item). */
const FORMAS = Object.freeze({
  tarotId: (v) => typeof v === 'string' && ID_TAROLOGO.test(v),
  clientId: (v) => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(v),
  client: (v) => typeof v === 'string' && v.length <= 160,
  channel: (v) => typeof v === 'string' && v.length <= 40,
  date: ehDataCivil, standbyDate: ehDataCivil, forwardedDate: ehDataCivil,
  time: (v) => typeof v === 'string' && v.length <= 80, scheduledTime: (v) => typeof v === 'string' && v.length <= 80, requestedTime: (v) => typeof v === 'string' && v.length <= 120,
  paymentPending: (v) => typeof v === 'boolean', position: (v) => Number.isInteger(v) && v >= 0 && v <= 100000,
  response: (v) => ['Aguardando resposta', 'Respondeu', 'Não respondeu'].includes(v),
  workflowStatus: (v) => ['Avisada', 'Em consulta', 'Não pode', 'Concluída'].includes(v),
  agendaOutcome: (v) => ['Concluída', 'Cancelada'].includes(v),
  observation: (v) => typeof v === 'string' && v.length <= 20000,
  resolvedAt: (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)),
  forwardedAt: (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)),
});

function conferirCampo(nome, valor) {
  if (nome === 'contactPlan') return regras.planoGuardado(valor);
  if (FORMAS[nome] && !FORMAS[nome](valor)) throw invalido();
  if (!FORMAS[nome] && typeof valor === 'object' && valor !== null && JSON.stringify(valor).length > 65536) throw invalido();
  return valor;
}

/** Elemento novo de uma história: objeto com `id` próprio e curto. */
function elementoNovo(historia, e) {
  if (!ehObjeto(e) || typeof e.id !== 'string' || !e.id || e.id.length > 160) throw invalido();
  if (JSON.stringify(e).length > 32768) throw invalido();
  return e;
}

function carimbar(historia, e, ator) {
  const campo = AUTOR_DA_HISTORIA[historia];
  return campo && typeof e[campo] === 'string' ? { ...e, [campo]: ator.nome } : e;
}

const CAMPOS_DE_INSTANTE = new Set(['at', 'createdAt', 'resolvedAt', 'forwardedAt', 'requestedAt']);
const INSTANTE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
function instantesDoComando(valor, achados) {
  if (Array.isArray(valor)) valor.forEach((v) => instantesDoComando(v, achados));
  else if (ehObjeto(valor)) for (const [k, v] of Object.entries(valor)) { if (CAMPOS_DE_INSTANTE.has(k) && typeof v === 'string' && INSTANTE_ISO.test(v)) achados.add(v); else instantesDoComando(v, achados); }
  return achados;
}
function trocarInstantes(valor, de, para) {
  if (typeof valor === 'string') return de.has(valor) ? para : valor;
  if (Array.isArray(valor)) return valor.map((v) => trocarInstantes(v, de, para));
  if (ehObjeto(valor)) return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, trocarInstantes(v, de, para)]));
  return valor;
}
/**
 * Relógio do servidor (Maturacao/29 seção 11): o front carimba os eventos novos com o relógio do navegador (um `at` por ação). O servidor
 * troca esse instante, em todo lugar onde ele aparece no comando (eventos novos e campos do item, ex. `queueReservation.at`), pelo dele.
 */
function comRelogioDoServidor(cmd, agoraIso, item) {
  // Instante que o item JÁ tem (observação antiga reenviada em `set.observations`, reserva antiga etc.) é dado antigo: não é reescrito.
  const jaGravado = item ? JSON.stringify(item) : '';
  const doSet = [...instantesDoComando(cmd.set || {}, new Set())].filter((v) => !jaGravado.includes(`"${v}"`));
  const achados = instantesDoComando(cmd.append || {}, new Set(doSet));
  achados.delete(agoraIso);
  if (!achados.size) return cmd;
  return { ...cmd, ...(cmd.set ? { set: trocarInstantes(cmd.set, achados, agoraIso) } : {}), ...(cmd.append ? { append: trocarInstantes(cmd.append, achados, agoraIso) } : {}) };
}

/**
 * @param {object} item  AgendaItem atual (do banco)
 * @param {object} cmd   comando (corpo validado em forma pela camada HTTP)
 * @param {string} grupo contato | observacoes | prazo | saidas | resolucao | agendamento
 * @param {{nome:string}} ator
 */
function aplicarDelta(item, bruto, grupo, ator, agora = new Date()) {
  const cmd = comRelogioDoServidor(bruto, agora.toISOString(), item);
  const regra = GRUPOS[grupo];
  if (!regra) throw invalido();
  const set = cmd.set || {}; const unset = cmd.unset || []; const append = cmd.append || {};
  if (!ehObjeto(set) || !Array.isArray(unset) || !ehObjeto(append)) throw invalido();
  const proibido = (n) => RESERVADOS.includes(n);
  for (const n of Object.keys(set)) if (proibido(n) || !regra.set.includes(n)) throw invalido();
  const apagavel = (n) => (regra.unset || []).includes(n) || (!['tarotId', 'clientId', 'date', 'position'].includes(n) && !proibido(n) && regra.set.includes(n));
  for (const n of unset) if (typeof n !== 'string' || !apagavel(n)) throw invalido();
  for (const n of Object.keys(append)) if (!regra.append.includes(n) || !Array.isArray(append[n])) throw invalido();
  const restaura = cmd.restoreDepartures || [];
  if (!Array.isArray(restaura) || (restaura.length && !regra.restaura)) throw invalido();

  // Reservar uma taróloga da fila geral é do encaminhamento (`/route-general`), que valida o destino; o delta só limpa a reserva.
  if (set.queueReservation !== undefined && JSON.stringify(limpar(set.queueReservation)) !== JSON.stringify(limpar(item.queueReservation))) throw invalido('Use o encaminhamento da Fila Geral para reservar uma taróloga.');
  const proximo = { ...item };
  for (const [n, v] of Object.entries(set)) proximo[n] = conferirCampo(n, v);
  for (const n of unset) delete proximo[n];

  const eventos = [];
  const novosPorHistoria = {};
  for (const [historia, lista] of Object.entries(append)) {
    const atuais = proximo[historia] || [];
    const ids = new Set(atuais.map((e) => e.id));
    const novos = [];
    for (const bruto of lista) {
      const e = carimbar(historia, elementoNovo(historia, bruto), ator);
      if (ids.has(e.id)) throw invalido('Esta ação já foi registrada.'); // o mesmo evento nunca entra duas vezes
      ids.add(e.id); novos.push(e);
    }
    novosPorHistoria[historia] = novos;
    proximo[historia] = [...atuais, ...novos];
    for (const e of novos) eventos.push({ tipo: TIPO_DO_EVENTO[historia], ref: `${historia}:${e.id}`, dados: e });
  }
  if (restaura.length) {
    const ids = new Set(restaura);
    proximo.departures = (proximo.departures || []).map((d) => (ids.has(d.id) && d.action === 'cancel' && !d.restored ? { ...d, restored: true } : d));
  }

  // Regras por história presente (uma rota pode trazer mais de uma: o agendamento editado mexe em várias).
  if (novosPorHistoria.contactHistory || cmd.expectedContact !== undefined) regras.conferirContato(item, novosPorHistoria.contactHistory || [], cmd.expectedContact, grupo, set.contactPlan !== undefined);
  if (set.contact) regras.contatoNovo(item, proximo, novosPorHistoria.contactHistory || []);
  if (set.contactPlan !== undefined) regras.conferirPlanoEmConsulta(item, proximo.contactPlan, novosPorHistoria.contactHistory || []);
  if (set.observations || novosPorHistoria.observationHistory) regras.conferirObservacoes(item, proximo, novosPorHistoria.observationHistory || []);
  if (novosPorHistoria.requestedWaitHistory) regras.conferirPrazo(item, novosPorHistoria.requestedWaitHistory, cmd.expectedLatestId);
  if (novosPorHistoria.departures) regras.conferirSaidas(item, proximo, novosPorHistoria.departures);
  if (novosPorHistoria.resolutionHistory) regras.conferirResolucao(novosPorHistoria.resolutionHistory);

  if (!eventos.length) eventos.push({ tipo: 'estado', ref: null, dados: limpar({ set: Object.keys(set), unset }) });
  if (JSON.stringify(proximo).length > TAMANHO_MAXIMO) throw invalido();
  return { item: proximo, eventos };
}

module.exports = { aplicarDelta, conferirCampo, comRelogioDoServidor };
