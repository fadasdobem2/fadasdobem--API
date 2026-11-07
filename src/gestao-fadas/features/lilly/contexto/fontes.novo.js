'use strict';

/**
 * Leituras do BANCO NOVO (Postgres `gf_*`) que o snapshot da Lilly usa, pelos models de leitura (`novo/leitura.js`: funcionam sem a escrita
 * ligada). Só SELECT. Cada função devolve linhas puras (colunas do banco; `item` jsonb já como objeto) e pede `limite + 1` para o montador
 * saber que estourou o limite. Trocáveis em teste (`fontes.js`).
 */

const { Op, literal } = require('sequelize');
const { lendoNovo } = require('../../../novo/leitura');

const unicos = (l) => [...new Set((l || []).map(String))];

/** Agenda: abertas até `dia` (fila ativa), abertas das clientes em foco (qualquer data), encerradas do dia das clientes em foco e um agendamento pedido. */
function agenda({ dia, clientIds, appointmentId, limite }) {
  const foco = unicos(clientIds);
  const condicoes = [{ agenda_outcome: null, data_operacional: { [Op.lte]: dia } }];
  if (foco.length) condicoes.push({ agenda_outcome: null, id_cliente: foco }, { data_operacional: dia, id_cliente: foco });
  if (appointmentId) condicoes.push({ id: String(appointmentId) });
  return lendoNovo((m) => m.GfAgenda.findAll({ where: { [Op.or]: condicoes }, order: [['numero_publico', 'ASC']], limit: limite + 1 }));
}

/** Consultas: abertas (qualquer tarólogo), das clientes em foco desde `desdeIso`, iniciadas desde `inicioDiaIso` e uma consulta pedida. */
function consultas({ clientIds, desdeIso, inicioDiaIso, consultaId, limite }) {
  const foco = unicos(clientIds);
  const condicoes = [{ status: { [Op.in]: ['Em curso', 'Finalizada pelo tarólogo'] } }, { iniciada_em: { [Op.gte]: inicioDiaIso } }];
  if (foco.length) condicoes.push({ id_cliente: foco, iniciada_em: { [Op.gte]: desdeIso } });
  if (consultaId) condicoes.push({ id: String(consultaId) });
  return lendoNovo((m) => m.GfConsultasExt.findAll({ where: { [Op.or]: condicoes }, order: [['iniciada_em', 'ASC'], ['id', 'ASC']], limit: limite + 1 }));
}

/** Presença de todos os tarólogos (tabela pequena). */
function presenca() {
  return lendoNovo((m) => m.GfPresencaEstado.findAll({ order: [['id_tarologo', 'ASC']] }));
}

/** Escala semanal + exceções ativas (que tocam o intervalo) + períodos. */
function horarios({ de, ate }) {
  return lendoNovo(async (m) => {
    const excecoes = await m.GfHorariosExcecoes.findAll({ where: { removida_em: null, data_inicio: { [Op.lte]: ate }, data_fim: { [Op.gte]: de } }, order: [['id_tarologo', 'ASC'], ['id', 'ASC']] });
    const periodos = excecoes.length ? await m.GfHorariosPeriodos.findAll({ where: { id_excecao: excecoes.map((e) => e.id) }, order: [['id_excecao', 'ASC'], ['ordem', 'ASC']] }) : [];
    const semanais = await m.GfEscalasSemanais.findAll({ order: [['id_tarologo', 'ASC']] });
    return { excecoes, periodos, semanais };
  });
}

/** Pagamentos lançados no Postgres: das clientes desde `desdeIso`, mais os ids pedidos (duplicidade por referência). */
function pagamentos({ clientIds, desdeIso, paymentIds, limite }) {
  const condicoes = [];
  if (unicos(clientIds).length) condicoes.push({ id_cliente: unicos(clientIds), informado_em: { [Op.gte]: desdeIso } });
  if (unicos(paymentIds).length) condicoes.push({ id: unicos(paymentIds) });
  if (!condicoes.length) return Promise.resolve([]);
  return lendoNovo((m) => m.GfPagamentos.findAll({ where: { [Op.or]: condicoes }, order: [['informado_em', 'ASC'], ['id', 'ASC']], limit: limite + 1 }));
}

/** Versões de valores (`gf_precos_versoes`), todas: a vigente se resolve em memória (`configuracao-financeira.js`). */
function precosVersoes() {
  return lendoNovo((m) => m.GfPrecosVersoes.findAll({ order: [['vigente_desde', 'ASC'], ['criado_em', 'ASC'], ['id', 'ASC']] }));
}

/** Restrições ATIVAS das clientes pedidas. */
function restricoes({ clientIds, limite }) {
  if (!unicos(clientIds).length) return Promise.resolve([]);
  return lendoNovo((m) => m.GfRestricoes.findAll({ where: { ativa: true, id_cliente: unicos(clientIds) }, order: [['id', 'ASC']], limit: limite + 1 }));
}

/** Divergências (não excluídas) das consultas pedidas. */
function divergencias({ consultaIds, limite }) {
  if (!unicos(consultaIds).length) return Promise.resolve([]);
  return lendoNovo((m) => m.GfDivergencias.findAll({ where: { excluida: false, id_consulta: unicos(consultaIds) }, order: [['id', 'ASC']], limit: limite + 1 }));
}

/** Extensão do cadastro (`gf_clientes_ext`) pelos ids. */
function clientesExt(clientIds) {
  if (!unicos(clientIds).length) return Promise.resolve([]);
  return lendoNovo((m) => m.GfClientesExt.findAll({ where: { id_cliente: unicos(clientIds) } }));
}

/** Clientes cujo WhatsApp editado na ficha termina nos 8 dígitos (pré-filtro; a decisão é do `comoCasa`). `digitos8` só dígitos. */
function clientesExtPorTelefone(digitos8, limite) {
  if (!/^\d{8}$/.test(digitos8)) return Promise.resolve([]);
  return lendoNovo((m) => m.GfClientesExt.findAll({
    where: literal(`regexp_replace(COALESCE(dados->>'whatsapp', ''), '[^0-9]', '', 'g') LIKE '%${digitos8}'`),
    order: [['id_cliente', 'ASC']],
    limit: limite + 1,
  }));
}

/** Última consulta (início) de cada cliente em foco no Postgres, excluindo as canceladas/anuladas. */
function ultimaConsultaPorCliente(clientIds) {
  if (!unicos(clientIds).length) return Promise.resolve([]);
  return lendoNovo((m) => m.GfConsultasExt.findAll({
    attributes: ['id_cliente', 'iniciada_em'],
    where: { id_cliente: unicos(clientIds), status: { [Op.notIn]: ['Cancelada', 'Anulada', 'Erro', 'Devolvida', 'Não houve'] } },
    order: [['iniciada_em', 'DESC']],
    limit: 2000,
  }));
}

module.exports = {
  agenda, consultas, presenca, horarios, pagamentos, precosVersoes, restricoes, divergencias, clientesExt, clientesExtPorTelefone, ultimaConsultaPorCliente,
};
