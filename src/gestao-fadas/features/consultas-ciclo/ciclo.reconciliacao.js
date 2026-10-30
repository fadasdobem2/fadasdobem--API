'use strict';

/**
 * RECONCILIAÇÃO do espelho (anti-órfã). Para consultas SEM vínculo no legado, cujo espelho ficou `pendente` (intenção gravada e não
 * concluída: queda entre o INSERT no legado e a marcação do vínculo) ou em `erro` com a chave natural no detalhe, refaz a sincronização
 * a partir de uma consulta antiga o bastante. A sincronização procura no legado (leitura) uma linha que já corresponda à chave
 * (cliente, tarólogo, data e início) ANTES de reinserir: se achar uma, ADOTA; se achar várias, para (`órfã ambígua`, decisão humana);
 * se não achar, insere. Mesma flag do espelho (`GF_LEGADO_ESCRITA_ENABLED`): desligada, não faz nada. Nunca DELETE, nunca estrutura.
 * O job (`agendar`) NÃO é ligado em lugar nenhum por padrão; quem decide ligar o espelho decide também ligar este job.
 */

const { emTransacao: emPostgres } = require('../../novo/escritor');
const legado = require('../../legado-escrita');
const { sincronizar } = require('./ciclo.espelho');

const IDADE_PADRAO_MIN = 10;
const JOB_PADRAO_MS = 300_000;

/** Ids candidatos: sem vínculo, `pendente`/`erro` com chave, atualizados antes de `corte` (ISO), sem a marca de ambiguidade. */
async function candidatas(corte, limite) {
  return emPostgres(async (pg) => {
    const [linhas] = await pg.execute(
      "SELECT id FROM gf_consultas_ext WHERE id_consulta_legado IS NULL AND legado_estado IN ('pendente', 'erro') AND legado_detalhe LIKE '%#k=%' AND legado_detalhe NOT LIKE 'órfã ambígua%' AND legado_atualizado_em < ? ORDER BY legado_atualizado_em, id LIMIT ?",
      [corte, limite],
    );
    return linhas.map((l) => l.id);
  });
}

/** Uma passada. Devolve contagens; `desligado: true` (sem tocar em nada) se a flag está desligada. `sincronizar` injetável para teste. */
async function reconciliar({ idadeMinutos = IDADE_PADRAO_MIN, limite = 50, agora = Date.now(), ligado = legado.espelhoLigado(), refazer = sincronizar } = {}) {
  if (!ligado) return { desligado: true, examinadas: 0, adotadas: 0, inseridas: 0, ambiguas: 0, erros: 0 };
  const corte = new Date(agora - idadeMinutos * 60_000).toISOString();
  const ids = await candidatas(corte, limite);
  const r = { desligado: false, examinadas: ids.length, adotadas: 0, inseridas: 0, ambiguas: 0, erros: 0, atualizadas: 0 };
  for (const id of ids) {
    const d = await refazer(id, 'reconciliacao');
    if (!d) continue;
    if (d.estado === 'espelhada') { if (/^órfã adotada/.test(d.detalhe)) r.adotadas += 1; else if (/^inserida/.test(d.detalhe)) r.inseridas += 1; else r.atualizadas += 1; }
    else if (/^órfã ambígua/.test(d.detalhe || '')) r.ambiguas += 1;
    else r.erros += 1;
  }
  return r;
}

/** Agenda a reconciliação. `null` (nada agendado) se o espelho está desligado. */
function agendar(env = process.env) {
  if (!legado.espelhoLigado(env)) return null;
  const pedido = Number(env.GF_LEGADO_RECONCILIACAO_MS);
  const ms = Number.isFinite(pedido) && pedido >= 60_000 ? pedido : JOB_PADRAO_MS;
  let rodando = false;
  const timer = setInterval(async () => {
    if (rodando) return;
    rodando = true;
    try { const r = await reconciliar(); if (r.examinadas) console.log('[gf-espelho.reconciliacao]', JSON.stringify(r)); } catch (e) { console.error('[gf-espelho.reconciliacao] falhou:', (e && e.message) || e); } finally { rodando = false; }
  }, ms);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { reconciliar, candidatas, agendar, IDADE_PADRAO_MIN };
