'use strict';

/**
 * Job da trava da ficha do ASP (Maturacao/53), dentro do processo da API (registrado no `app.js` como o job de presença). REINICIÁVEL: as conferências
 * vivem em `gf_legado_verificacoes` (PostgreSQL); ao subir, `varrer` pega as vencidas durante a parada. Seguro com várias instâncias: trava distribuída por
 * passada e trava de linha (`SKIP LOCKED`) por conferência. Desligado (`GF_LEGADO_VERIFICACAO` e o espelho), não agenda nada.
 */

const { emTransacao: emPostgres } = require('../novo/escritor');
const v = require('./verificacao');
const { conferir } = require('./verificacao.conferir');

const JOB_PADRAO_MS = 30_000;

/** Ids das conferências pendentes e vencidas (`verificacoes_pendentes`). */
async function verificacoesPendentes(agora = Date.now(), limite = 50) {
  return emPostgres(async (ex) => {
    const [l] = await ex.execute("SELECT id FROM gf_legado_verificacoes WHERE estado = 'pendente' AND vence_em <= ? ORDER BY vence_em, id LIMIT ?", [new Date(agora).toISOString(), limite]);
    return l.map((x) => x.id);
  });
}

/** Uma passada. Devolve as contagens do que foi decidido nela. */
async function varrer({ agora = Date.now(), env = process.env, limite = 50 } = {}) {
  const r = { examinadas: 0, ok: 0, reaplicadas: 0, divergentes: 0, adiadas: 0, encerradas: 0, erros: 0 };
  if (!v.ligada(env)) return { ...r, desligado: true };
  for (const id of await verificacoesPendentes(agora, limite)) {
    r.examinadas += 1;
    try {
      const x = await conferir(id, { agora, env });
      if (!x) continue;
      const chave = { ok: 'ok', reaplicada: 'reaplicadas', divergente: 'divergentes', adiada: 'adiadas', encerrada: 'encerradas' }[x.estado];
      if (chave) r[chave] += 1;
    } catch (e) { r.erros += 1; console.error('[gf-legado.verificacao] conferência falhou:', (e && (e.codigo || e.message)) || e); }
  }
  return r;
}

/** Agenda o job (chamado no `listen` do app.js). `null` se a flag ou o espelho estão desligados. Faz uma passada já ao subir. */
function agendar(env = process.env) {
  if (!v.ligada(env) || !require('./index').espelhoLigado(env)) return null;
  const pedido = Number(env.GF_LEGADO_VERIFICACAO_JOB_MS);
  const ms = Number.isFinite(pedido) && pedido >= 1000 ? pedido : JOB_PADRAO_MS;
  const { withDistributedLock } = require('../../providers/redis/distributed-lock');
  let rodando = false;
  const passada = async () => {
    if (rodando) return;
    rodando = true;
    try {
      await withDistributedLock('gf:legado:verificacao', Math.max(ms * 2, 30_000), async () => {
        const r = await varrer({ env });
        if (r.reaplicadas || r.divergentes || r.erros) console.log('[gf-legado.verificacao]', JSON.stringify({ ...r, acumulado: await emPostgres((ex) => v.contagem(ex)) }));
      });
    } catch (e) { console.error('[gf-legado.verificacao] passada falhou:', (e && e.message) || e); } finally { rodando = false; }
  };
  emPostgres((ex) => v.contagem(ex)).then((c) => console.log(`[gf-legado.verificacao] ligada (a cada ${ms}ms); pendências ao subir: ${JSON.stringify(c)}`)).catch(() => {});
  setTimeout(passada, 2000).unref();
  const timer = setInterval(passada, ms);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { varrer, agendar, verificacoesPendentes };
