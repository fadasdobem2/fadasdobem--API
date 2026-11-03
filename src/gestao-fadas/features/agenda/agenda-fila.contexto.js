'use strict';

/**
 * O que a validação de um encaminhamento da fila geral precisa saber, lido dentro da transação (Maturacao/29 seção 11):
 * os agendamentos abertos (as reservas cruzam filas), as consultas do tarólogo e da cliente, a admissão do dia, o cadastro e a
 * presença do tarólogo e as restrições. Cada fonte só entra se a fatia dela está ligada (flag), como no resto do gate.
 */

const store = require('./agenda.store');
const adm = require('./agenda-admissao.store');
const ciclo = require('../consultas-ciclo/ciclo.store');
const presencaStore = require('../presenca/presenca.store');

const ligado = (nome, env = process.env) => `${env[nome] || ''}`.trim().toLowerCase() === 'true';

/** Cadastro do tarólogo (nome e cadastro ativo). Trocável nos testes, onde o legado não está configurado. */
let fonteDeTarologo = async (tarotId) => {
  const itens = await require('../cadastros/tarologos.service').catalogo();
  return itens.find((i) => i.id === tarotId) || null;
};
/** Sem catálogo (legado fora do ar ou não configurado) o tarólogo é desconhecido: regras de cadastro e de presença não se aplicam. */
const cadastroOuNada = async (tarotId) => { try { return await fonteDeTarologo(tarotId); } catch (_e) { return null; } };
/** Como `cadastroOuNada`, mas diz se o catálogo foi lido: `{ catalogo: true, item }` (item null = não existe) ou `{ catalogo: false }`. */
const cadastroConhecido = async (tarotId) => { try { return { catalogo: true, item: await fonteDeTarologo(tarotId) }; } catch (_e) { return { catalogo: false, item: null }; } };
const definirFonteDeTarologo = (fn) => { fonteDeTarologo = fn; };

async function restrita(ex, clientId, tarotId) {
  if (!ligado('GF_FATIA_RESTRICOES')) return false;
  const [linhas] = await ex.execute('SELECT id FROM gf_restricoes WHERE id_cliente = ? AND id_tarologo = ? AND ativa = true LIMIT 1', [clientId, tarotId]);
  return Boolean(linhas[0]);
}

async function carregar(ex, { tarotId, clientId, data }) {
  const registros = await store.abertosTodos(ex);
  const doTarologo = await ciclo.resumoParaPresenca(ex, tarotId);
  const daCliente = await ciclo.abertasDe(ex, tarotId, clientId);
  const eventos = await adm.eventosDoDia(ex, tarotId, data);
  const cadastro = await cadastroOuNada(tarotId);
  const consultas = [...new Map([...doTarologo, ...daCliente.map((r) => r.item)].map((c) => [c.id, c])).values()];
  let perfil;
  if (cadastro && ligado('GF_FATIA_PRESENCA')) {
    const estado = await presencaStore.carregarTravado(ex, tarotId);
    // Sem estado gravado o tarólogo é Offline (o front real mostra a lista sem presença como Offline).
    perfil = { id: tarotId, name: cadastro.name, registrationActive: cadastro.registrationActive, ...(estado ? estado.perfil : { online: false, status: 'Disponível', shiftStatus: 'Offline' }) };
  }
  return { agenda: registros.map((r) => r.item), consultas, eventos, cadastro, perfil, restrita: await restrita(ex, clientId, tarotId) };
}

module.exports = { carregar, definirFonteDeTarologo, ligado, cadastroDe: cadastroOuNada, cadastroConhecido };
