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

/**
 * Legado primeiro (Maturacao/46, caso e): intenções `iniciada` antigas = o processo caiu entre a escrita no legado e o commit do Postgres (ou o
 * desfazer não rodou). Pedido já registrado em `gf_operacoes` -> `concluida`. Cliente/tarólogo: o legado volta ao valor anterior SE ainda tem o que
 * escrevemos (`revertida`); se mudou depois, `divergente` (decisão humana). Consulta: a linha inserida não se apaga (nunca DELETE): `divergente`, e a
 * próxima gravação da mesma consulta a ADOTA pela chave natural. Só age com a flag geral ligada; nunca lança.
 */
async function reconciliarIntencoes({ idadeMinutos = 10, limite = 50, agora = Date.now(), env = process.env } = {}) {
  const r = { examinadas: 0, concluidas: 0, revertidas: 0, divergentes: 0, erros: 0 };
  if (!legado().espelhoLigado(env)) return { ...r, desligado: true };
  const intencoes = require('./intencoes');
  const e = ENTIDADES();
  const lista = await intencoes.antigas(new Date(agora - idadeMinutos * 60_000).toISOString(), limite);
  r.examinadas = lista.length;
  for (const it of lista) {
    try {
      if (await intencoes.pedidoConfirmado(it.escopo, it.operation_key)) { await intencoes.marcar(it.id, 'concluida', 'pedido registrado: commit confirmado'); r.concluidas += 1; continue; }
      if (it.entidade === 'consultas') { await intencoes.marcar(it.id, 'divergente', 'pedido sem registro; a linha do legado (se houve) segue lá e será adotada na próxima gravação'); r.divergentes += 1; continue; }
      const res = e[it.entidade] && it.antes && it.depois && legado().espelhoLigado(env, it.entidade) ? await e[it.entidade].reverter(it) : 'divergente';
      await intencoes.marcar(it.id, res === 'divergente' ? 'divergente' : 'revertida', res === 'divergente' ? 'pedido sem registro e o legado mudou depois: decisão humana' : 'pedido sem registro; legado devolvido ao valor anterior');
      if (res === 'divergente') r.divergentes += 1; else r.revertidas += 1;
    } catch (erro) { r.erros += 1; console.error('[gf-legado.intencoes] reconciliação falhou:', (erro && (erro.codigo || erro.message)) || erro); }
  }
  return r;
}

/** Uma passada em todas. `consultasRec` injetável (teste). `incluirNaoEspelhadas` só pelo comando offline (carga inicial das edições feitas com o espelho desligado). */
async function reconciliarTudo({ idadeMinutos = 10, limite = 50, agora = Date.now(), env = process.env, incluirNaoEspelhadas = false, consultasRec, intencoesRec } = {}) {
  const geral = legado().espelhoLigado(env);
  const saida = { desligado: !geral, consultas: null, clientes: null, tarologos: null, intencoes: null };
  if (!geral) return saida;
  const e = ENTIDADES();
  saida.consultas = await (consultasRec || consultas().reconciliar)({ idadeMinutos, limite, agora, ligado: true });
  for (const nome of ['clientes', 'tarologos']) {
    saida[nome] = await e[nome].reconciliar({ idadeMinutos, limite, agora, ligado: legado().espelhoLigado(env, nome), incluirNaoEspelhadas });
  }
  if (require('./legado-primeiro').modoPrimeiro(env)) saida.intencoes = await (intencoesRec || reconciliarIntencoes)({ idadeMinutos, limite, agora, env }).catch((erro) => ({ erro: String((erro && erro.message) || erro).slice(0, 120) }));
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

module.exports = { reconciliarTudo, reconciliarIntencoes, agendar };
