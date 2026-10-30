'use strict';

const { Op } = require('sequelize');
const { lendoNovo: lendo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const { nomesDeContasDaA } = require('../../novo/contas');
const { idTarologo } = require('./repasse.validacao');
const { acordoDe, lerAbertura, aberturasDe } = require('./repasse.dto');

/**
 * Repasse (LEITURA), porta fiel das rotas GET da B (`real-payouts-http.server.ts`): o acordo do tarólogo
 * (percentual e calendário) e a abertura / Saldo Migrado (vigente, rascunho e revisões). Tabelas NOVAS `gf_repasse_*`
 * (banco novo: PostgreSQL da A, `GF_NOVOS_DADOS=postgres`, ou o MySQL do suspiro no modo `mysql`), ligadas ao tarólogo legado por `tarot_id` (TEXTO). Aqui são
 * SOMENTE LEITURA: nada é gravado. O formato é o do contrato (payouts-http.md), em `repasse.dto.js`; as regras puras
 * (centavos, half-up, saldo corrido, calendário) ficam em `repasse.core.js` e `repasse.model.js`.
 *
 * Como na B, não se confere se o tarólogo existe no legado: sem nenhum registro o acordo vem com os padrões (30% e sem
 * calendário) e as aberturas vêm vazias.
 *
 * TODO(escrita) - NÃO implementadas de propósito (os models `GfRepasse*` são somente leitura e a escrita exige decisão
 * registrada, com `operation_key` idempotente e `gf_auditoria` na MESMA transação; README do módulo, seção 8):
 *   - POST /repasse/tarologos/:id/percentual   -> gf_repasse_percentuais (só administradora; validar com corpoPercentual;
 *                                                 `vigente_desde` = agora de São Paulo ao segundo; responde 201 com o acordo);
 *   - POST /repasse/tarologos/:id/calendario   -> gf_repasse_calendarios (só administradora; corpoCalendario; 201);
 *   - POST /repasse/aberturas                  -> rascunho da revisão 1 (só administradora; corpoAbertura; um só rascunho
 *                                                 aberto por tarólogo; 201);
 *   - POST /repasse/aberturas/:id/confirmar    -> rascunho vira a vigente, com quem confirmou e quando (corpoConfirmar; 200);
 *   - POST /repasse/aberturas/:id/corrigir     -> revisão N+1 em rascunho, N preservada (corrigir o rascunho o deixa
 *                                                 `descartada`; dívidas da N+1 apontam para as da N por `corrige_id`; 201).
 *   As leituras da apuração (A pagar, composição) também NÃO têm rota aqui: o núcleo (`repasse.core.js`) está portado
 *   e verificado, mas faltam pagamentos, cancelamentos e a política de divergências (suspensos na própria B).
 */

const LIMITE_LEITURA = 10000; // teto defensivo; a B não pagina estas leituras

// --- nome de quem registrou ------------------------------------------------------------------------------

/**
 * Como na B (`listAccountNames` de db/finance-store.ts): o nome de quem lançou, confirmou ou registrou vem de
 * `gf_auth_accounts` (só `id` e `display_name`; o model da A nem tem as colunas de credencial). Conta que não existe
 * mais fica com `displayName: null` (a tela mostra "Conta não identificada").
 */
function contasCitadas(no, saida) {
  if (Array.isArray(no)) no.forEach((x) => contasCitadas(x, saida));
  else if (no && typeof no === 'object') {
    if (typeof no.accountId === 'string' && 'displayName' in no) saida.add(no.accountId);
    Object.values(no).forEach((x) => contasCitadas(x, saida));
  }
  return saida;
}

function preencherNomes(no, nomes) {
  if (Array.isArray(no)) no.forEach((x) => preencherNomes(x, nomes));
  else if (no && typeof no === 'object') {
    if (typeof no.accountId === 'string' && 'displayName' in no) no.displayName = nomes.get(no.accountId) ?? null;
    Object.values(no).forEach((x) => preencherNomes(x, nomes));
  }
  return no;
}

async function comNomes(m, dto) {
  const ids = [...contasCitadas(dto, new Set())];
  if (!ids.length) return dto;
  // Banco novo: o nome vem do perfil de equipe do usuário da A (conta que assinou), não de gf_auth_accounts.
  if (novosDadosNoPostgres()) return preencherNomes(dto, await nomesDeContasDaA(ids));
  const linhas = await m.GfAuthAccounts.findAll({ attributes: ['id', 'display_name'], where: { id: { [Op.in]: ids } }, raw: true });
  return preencherNomes(dto, new Map(linhas.map((l) => [l.id, l.display_name])));
}

function ordenarPorTexto(campo) {
  return (a, b) => (a[campo] < b[campo] ? -1 : a[campo] > b[campo] ? 1 : 0);
}

/** Linhas cruas (`raw`) das aberturas do tarólogo, por revisão. */
function aberturasBrutas(m, tarotId) {
  return m.GfRepasseAberturas.findAll({ where: { tarot_id: tarotId }, order: [['revisao', 'ASC']], raw: true, limit: LIMITE_LEITURA });
}

/** `GET /repasse/tarologos/:id/acordo` -> `{ commission: { current, since, history[] }, schedule: { current, since, history[] } }`. */
async function acordo(idTexto) {
  const tarotId = idTarologo(idTexto);
  return lendo(async (m) => {
    const [percentuais, calendarios, brutas] = await Promise.all([
      m.GfRepassePercentuais.findAll({ where: { tarot_id: tarotId }, order: [['vigente_desde', 'ASC'], ['id', 'ASC']], raw: true, limit: LIMITE_LEITURA }),
      m.GfRepasseCalendarios.findAll({ where: { tarot_id: tarotId }, order: [['vigente_desde', 'ASC'], ['id', 'ASC']], raw: true, limit: LIMITE_LEITURA }),
      aberturasBrutas(m, tarotId),
    ]);
    const vazio = { pendencias: [], dividas: [], parcelas: [], ajustes: [] };
    return comNomes(m, acordoDe({ percentuais, calendarios, aberturas: brutas.map((r) => lerAbertura(r, vazio)) }));
  });
}

/** `GET /repasse/tarologos/:id/aberturas` -> `{ current, draft, revisions[] }` (a vigente, o rascunho aberto e todas as revisões). */
async function aberturas(idTexto) {
  const tarotId = idTarologo(idTexto);
  return lendo(async (m) => {
    const brutas = await aberturasBrutas(m, tarotId);
    if (!brutas.length) return comNomes(m, aberturasDe([]));
    const ids = brutas.map((r) => r.id);
    const [pendencias, dividas, ajustes] = await Promise.all([
      m.GfRepasseAberturaPendencias.findAll({ where: { abertura_id: { [Op.in]: ids } }, raw: true, limit: LIMITE_LEITURA }),
      m.GfRepasseDividas.findAll({ where: { tarot_id: tarotId }, order: [['registrado_em', 'ASC'], ['id', 'ASC']], raw: true, limit: LIMITE_LEITURA }),
      m.GfRepasseAjustes.findAll({ where: { tarot_id: tarotId, abertura_id: { [Op.in]: ids } }, order: [['registrado_em', 'ASC'], ['id', 'ASC']], raw: true, limit: LIMITE_LEITURA }),
    ]);
    const parcelas = dividas.length
      ? await m.GfRepasseDividaParcelas.findAll({ where: { divida_id: { [Op.in]: dividas.map((d) => d.id) } }, order: [['divida_id', 'ASC'], ['sequencia', 'ASC']], raw: true, limit: LIMITE_LEITURA })
      : [];
    const filhos = { pendencias: pendencias.sort(ordenarPorTexto('id')), dividas, parcelas, ajustes };
    return comNomes(m, aberturasDe(brutas.map((r) => lerAbertura(r, filhos))));
  });
}

module.exports = { acordo, aberturas, contasCitadas, preencherNomes };
