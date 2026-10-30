'use strict';

/**
 * RECONCILIAÇÃO única do espelho no legado (Maturacao/45): estende a rotina de consultas (`ciclo.reconciliacao.js`, que segue a mesma e continua
 * sendo chamada) para as entidades novas, com a MESMA flag geral e a flag de cada entidade. Nada de segundo mecanismo: cada entidade reutiliza
 * `espelho-entidades.js`. O job (`agendar`) e o comando offline (`scripts/reconciliar-gf-espelho-legado.js`) usam esta função. NÃO é ligado ao
 * app.js: quem decide ligar o espelho decide também ligar este job. Desligado, devolve `{ desligado: true }` sem abrir conexão alguma.
 */

const ENTIDADES = () => require('./entidades');
const legado = () => require('./index');
const consultas = () => require('../features/consultas-ciclo/ciclo.reconciliacao');

const JOB_PADRAO_MS = 300_000;

/** Uma passada em todas. `consultasRec` injetável (teste). `incluirNaoEspelhadas` só pelo comando offline (carga inicial das edições feitas com o espelho desligado). */
async function reconciliarTudo({ idadeMinutos = 10, limite = 50, agora = Date.now(), env = process.env, incluirNaoEspelhadas = false, consultasRec } = {}) {
  const geral = legado().espelhoLigado(env);
  const saida = { desligado: !geral, consultas: null, clientes: null, tarologos: null };
  if (!geral) return saida;
  const e = ENTIDADES();
  saida.consultas = await (consultasRec || consultas().reconciliar)({ idadeMinutos, limite, agora, ligado: true });
  for (const nome of ['clientes', 'tarologos']) {
    saida[nome] = await e[nome].reconciliar({ idadeMinutos, limite, agora, ligado: legado().espelhoLigado(env, nome), incluirNaoEspelhadas });
  }
  return saida;
}

/** Agenda a passada. `null` (nada agendado) se o espelho geral está desligado. */
function agendar(env = process.env) {
  if (!legado().espelhoLigado(env)) return null;
  const pedido = Number(env.GF_LEGADO_RECONCILIACAO_MS);
  const ms = Number.isFinite(pedido) && pedido >= 60_000 ? pedido : JOB_PADRAO_MS;
  let rodando = false;
  const timer = setInterval(async () => {
    if (rodando) return;
    rodando = true;
    try { const r = await reconciliarTudo({ env }); console.log('[gf-espelho.reconciliacao]', JSON.stringify(r)); } catch (e) { console.error('[gf-espelho.reconciliacao] falhou:', (e && e.message) || e); } finally { rodando = false; }
  }, ms);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { reconciliarTudo, agendar };
