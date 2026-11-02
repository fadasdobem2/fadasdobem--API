'use strict';

/**
 * Pendências: lê no servidor as FONTES que o front usa para derivar (consultas, agenda, pagamentos, divergências) e aplica o porte
 * `_comum/dominio/pendencias-origem.js`. Lê com o recorte da equipe inteira (o front deriva com o papel da administradora e só depois filtra
 * por `pendingVisible`), com as MESMAS janelas das leituras que o navegador faz (consultas: abertas, do dia e das últimas 24 h; agenda:
 * abertas e dos últimos 7 dias). Sem a fatia de Pagamentos ou de Divergências ligada, o servidor NÃO tem as fontes e devolve `null`
 * (a conferência de origem não roda; segue a de forma e de filas). `addition:` (Maturacao/43) só entra com `GF_FATIA_ESTADO_FINANCEIRO=true` e o catálogo de tarólogos lido.
 */

const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const { hojeOperacional, somarDias } = require('../../_comum/dia-operacional');
const origem = require('../../_comum/dominio/pendencias-origem');
const f = require('../financeiro-cliente/fin.comum');
const consultasStore = require('../consultas-ciclo/ciclo.store');
const consultasResposta = require('../consultas-ciclo/ciclo.resposta');
const agendaStore = require('../agenda/agenda.store');
const contexto = require('../financeiro-cliente/fin.contexto');
const adicionaisFonte = require('../estado-financeiro/adicionais.fonte');
const { dadosEfetivosDoCliente } = require('../../legado-escrita/fusao');

let leitor = null;
/** Para os testes: lê as fontes de onde o teste mandar (o resto do caminho é o de produção). */
const definirLeitorDeFontes = (fn) => { leitor = fn; };
const temFontes = (env = process.env) => Boolean(leitor) || ['GF_FATIA_PAGAMENTOS', 'GF_FATIA_DIVERGENCIAS'].every((n) => `${env[n] || ''}`.trim().toLowerCase() === 'true');

/** Só com a ficha real ligada (`GF_FATIA_FICHA`): o front só deriva `guidance:` quando a orientação mora no servidor (`realGuidance`). */
const fichaLigada = (env = process.env) => `${env.GF_FATIA_FICHA || ''}`.trim().toLowerCase() === 'true';

/** Orientações guardadas com o nome da cliente (o de `/payments/accounts`: nome editado, senão o do legado, senão "Cliente <id>"). */
async function lerOrientacoes(m) {
  const linhas = await m.GfClientesOrientacoes.findAll({ order: [['id_cliente', 'ASC']] });
  const pendentes = linhas.map((l) => l.id_cliente);
  if (!pendentes.length) return [];
  const [vivas, exts] = await Promise.all([contexto.clientesNoLegado(pendentes), m.GfClientesExt.findAll({ where: { id_cliente: pendentes } })]);
  const editados = new Map(exts.map((e) => { const d = dadosEfetivosDoCliente(e); return [e.id_cliente, typeof d.name === 'string' ? d.name.trim() : '']; }));
  return linhas.filter((l) => vivas.get(l.id_cliente)).map((l) => ({ clientId: l.id_cliente, nome: (editados.get(l.id_cliente) || vivas.get(l.id_cliente).nome || '').trim() || `Cliente ${l.id_cliente}`, guidance: f.textoDe(l) }));
}

async function carregarFontes() {
  const hoje = hojeOperacional();
  return lendoNovo(async (m) => {
    const [cons, ag, pag, div, orientacoes, adicionais] = await Promise.all([
      consultasStore.lerRegistros(m, { desde: somarDias(hoje, -1) }),
      agendaStore.lerItens(m, { desde: somarDias(hoje, -7) }),
      m.GfPagamentos.findAll({ order: [['informado_em', 'ASC'], ['id', 'ASC']] }),
      m.GfDivergencias.findAll({ order: [['criado_em', 'DESC'], ['id', 'DESC']] }),
      fichaLigada() ? lerOrientacoes(m) : Promise.resolve(undefined),
      adicionaisFonte.lerParaPendencias(m),
    ]);
    return {
      consultas: consultasResposta.leitura(cons, { hoje }).items, agenda: ag.map((r) => r.item),
      pagamentos: pag.map((l) => ({ ...f.textoDe(l), id: l.id })), divergencias: div.map((l) => ({ ...f.textoDe(l), id: l.id })),
      ...(orientacoes ? { orientacoes } : {}),
      ...(adicionais ? { adicionais } : {}),
    };
  });
}

/** `{ fontes, origens, hoje }` para os `registros` (PendingRouting) dados, ou `null` quando o servidor não tem as fontes. */
async function derivar(registros, extras = []) {
  if (!novosDadosNoPostgres() || !temFontes()) return null;
  const hoje = hojeOperacional();
  const resultado = origem.derivar(await (leitor || carregarFontes)(), { hoje, registros, extras });
  return { ...resultado, hoje };
}

module.exports = { derivar, temFontes, definirLeitorDeFontes };
