'use strict';

/**
 * Configuração e regras do snapshot: `financialSettings.pixKey`, `restrictions`, `divergences`, `clientProfileBaseUrl`.
 *  - Chave Pix (Maturacao/60, seção 2): só da VERSÃO de valores gravada em `gf_precos_versoes`, resolvida como `effectivePricing`: uma versão
 *    sem `changedFields` (instantâneo antigo) substitui a chave; com `changedFields` só vale se a lista contiver `pixKey`. NÃO parte do
 *    padrão `VAL-001`. A chave de DEMONSTRAÇÃO (`pix@fadasdobem.com.br`) NUNCA sai, nem se alguém a gravar: sem chave real, `financialSettings`
 *    fica ausente e a Lilly não manda instrução de pagamento.
 *  - `restrictions`: pares ATIVOS cliente x tarólogo (`tarotId` -> `tarologistId`, `solicitante` -> `requestedBy`).
 *  - `divergences`: da consulta (`consultationId`), situação traduzida; só área Consulta.
 *  - `clientProfileBaseUrl`: env `LILLY_CLIENT_PROFILE_BASE_URL`, só HTTPS, sem credencial, consulta ou âncora.
 */

const { LIMITES } = require('./contexto.limites');
const { LimiteExcedido } = require('./contexto.cobertura');
const { PRECOS_PADRAO } = require('../../../_comum/dominio/financeiro-base');

/** Valores de demonstração que nunca viram configuração (seed VAL-001 e o texto documentado no painel). */
const CHAVES_DE_DEMONSTRACAO = new Set([`${PRECOS_PADRAO.pixKey || ''}`.trim().toLowerCase(), 'pix@fadasdobem.com.br'].filter(Boolean));

const item = (l) => (typeof l.item === 'string' ? JSON.parse(l.item) : l.item || {});
const instante = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; };
const sem = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/** @returns {{ pixKey: string, versionId: string, effectiveAt: string } | null} */
function chavePixVigente(versoes, agora) {
  const ordenadas = versoes.map(item).sort((a, b) => instante(a.effectiveAt) - instante(b.effectiveAt) || instante(a.createdAt) - instante(b.createdAt) || `${a.id}`.localeCompare(`${b.id}`));
  let vigente = null;
  for (const v of ordenadas) {
    if (instante(v.effectiveAt) > agora.getTime()) continue;
    if (!Array.isArray(v.changedFields)) vigente = v; // instantâneo antigo: substitui tudo
    else if (v.changedFields.includes('pixKey')) vigente = v;
  }
  const chave = vigente && typeof vigente.pixKey === 'string' ? vigente.pixKey.trim() : '';
  if (!chave || chave.length > 200 || CHAVES_DE_DEMONSTRACAO.has(chave.toLowerCase())) return null;
  return { pixKey: chave, versionId: `${vigente.id}`, effectiveAt: new Date(vigente.effectiveAt).toISOString() };
}

async function montarConfiguracaoFinanceira(agora, f) {
  const vigente = chavePixVigente(await f.precosVersoes(), agora);
  return vigente || undefined;
}

async function montarRestricoes(focoIds, f) {
  const linhas = await f.restricoes({ clientIds: focoIds, limite: LIMITES.RESTRICOES });
  if (linhas.length > LIMITES.RESTRICOES) throw new LimiteExcedido('restrictions');
  return linhas.map((l) => ({ id: l.id, active: true, clientId: l.id_cliente, tarologistId: l.id_tarologo, tarotId: l.id_tarologo, requestedBy: l.solicitante }));
}

const SITUACAO_DA_DIVERGENCIA = Object.freeze({ Pendente: 'pending', 'Em conferência': 'in_review', Resolvida: 'resolved', Arquivada: 'dismissed' });

async function montarDivergencias(consultaIds, f) {
  const linhas = await f.divergencias({ consultaIds, limite: LIMITES.DIVERGENCIAS });
  if (linhas.length > LIMITES.DIVERGENCIAS) throw new LimiteExcedido('divergences');
  return linhas.filter((l) => l.area === 'Consulta').map((l) => sem({ id: l.id, consultationId: l.id_consulta, status: SITUACAO_DA_DIVERGENCIA[l.situacao] || 'pending' }));
}

/** Base da ficha só em HTTPS; qualquer outra coisa (http, credencial, texto) = ausente. */
function urlBaseDaFicha(env = process.env) {
  const bruto = `${env.LILLY_CLIENT_PROFILE_BASE_URL || ''}`.trim();
  if (!bruto) return undefined;
  try {
    const u = new URL(bruto);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) return undefined;
    u.search = ''; u.hash = '';
    return u.toString();
  } catch (_) { return undefined; }
}

module.exports = { chavePixVigente, montarConfiguracaoFinanceira, montarRestricoes, montarDivergencias, urlBaseDaFicha, CHAVES_DE_DEMONSTRACAO };
