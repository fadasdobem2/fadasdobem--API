'use strict';

/**
 * Guarda de idempotência: executa uma ação UMA vez por chave (Maturacao/59, seção 6 e D5/D6).
 *  - mesma chave + mesmo corpo (hash estável, sem campos voláteis): devolve o resultado guardado, sem repetir o efeito (200);
 *  - mesma chave + corpo diferente: 409 OPERATION_KEY_CONFLICT; recusa definitiva guardada como 'recusada' e repetida igual;
 *  - 'em_execucao'/'incerta' vista por outra tentativa: 503 (a Lilly concilia pelo GET), nunca um segundo efeito.
 * O efeito e a marca 'confirmada' rodam na MESMA transação (executor transacional). O 'em_execucao' entra antes do efeito.
 */

const { normalizarChave, hashDaAcao } = require('../idempotencia/chave');
const repo = require('../dados/acoes.repo');
const { emTransacao } = require('../dados/executor');
const { AcaoRecusadaError, AcaoConflitoError, AcaoEmAndamentoError } = require('./acoes.erros');

const recusaGuardada = (r) => {
  const erro = new AcaoRecusadaError(r?.code || 'LILLY_ACTION_REFUSED', r?.message || 'Ação recusada.', r?.status || 422);
  erro.guardada = true;
  return erro;
};

/** Decide o que fazer com uma linha já existente. Devolve `{ repetida, resultado }` ou lança. */
function decidirRepeticao(existente, hash) {
  if (existente.hash !== hash) throw new AcaoConflitoError();
  if (existente.estado === 'confirmada') return { repetida: true, resultado: existente.resultado };
  if (existente.estado === 'recusada') throw recusaGuardada(existente.resultado);
  throw new AcaoEmAndamentoError();
}

const dadosDaChave = (chave, acao, hash) => ({
  chaveInterna: chave.interna, chaveOriginal: chave.original, hash, kind: acao.kind, eventoOrigem: acao.sourceEventId ?? null,
});

/** Grava a recusa definitiva numa transação própria (a do efeito foi desfeita). */
async function guardarRecusa(chave, acao, hash, erro) {
  await emTransacao(async (executor) => {
    await repo.reservar(executor, dadosDaChave(chave, acao, hash));
    await repo.recusar(executor, chave.interna, { code: erro.code, message: erro.message, status: erro.status });
  });
}

async function executarTransacional(chave, acao, hash, executarEfeito) {
  const ctx = { chave };
  return emTransacao(async (executor) => {
    const criada = await repo.reservar(executor, dadosDaChave(chave, acao, hash));
    const existente = await repo.lerAcao(executor, chave.interna, { travar: true });
    if (!criada) return decidirRepeticao(existente, hash);
    const resultado = await executarEfeito(acao, { ...ctx, executor });
    await repo.confirmar(executor, chave.interna, resultado ?? {});
    return { repetida: false, resultado: resultado ?? {} };
  });
}

/** Efeito fora do banco novo: reserva e confirma o 'em_execucao' antes; se o efeito falhar de forma incerta, fica 'incerta'. */
async function executarNaoTransacional(chave, acao, hash, executarEfeito) {
  const anterior = await emTransacao(async (executor) => {
    const criada = await repo.reservar(executor, dadosDaChave(chave, acao, hash));
    const existente = await repo.lerAcao(executor, chave.interna, { travar: true });
    return criada ? null : decidirRepeticao(existente, hash);
  });
  if (anterior) return anterior;
  let resultado;
  try {
    resultado = await executarEfeito(acao, { chave, executor: null });
  } catch (erro) {
    if (erro instanceof AcaoRecusadaError) erro.guardada = true;
    await emTransacao((executor) => (erro instanceof AcaoRecusadaError
      ? repo.recusar(executor, chave.interna, { code: erro.code, message: erro.message, status: erro.status })
      : repo.marcarIncerta(executor, chave.interna, { message: `${erro && erro.name}` })));
    throw erro;
  }
  await emTransacao((executor) => repo.confirmar(executor, chave.interna, resultado ?? {}));
  return { repetida: false, resultado: resultado ?? {} };
}

/**
 * @param {{ chaveBruta: string, acao: object, executarEfeito: Function, transacional?: boolean }} p
 *   `executarEfeito(acao, { chave, executor })` devolve o `result`; recusa de negócio = lançar `AcaoRecusadaError`.
 * @returns {Promise<{ repetida: boolean, resultado: object }>}
 */
async function executarUmaVez({ chaveBruta, acao, executarEfeito, transacional = true }) {
  const chave = normalizarChave(chaveBruta);
  if (!chave) throw new AcaoRecusadaError('INVALID_INPUT', 'Informe a chave de idempotência.', 400);
  const hash = hashDaAcao(acao);
  try {
    return await (transacional ? executarTransacional : executarNaoTransacional)(chave, acao, hash, executarEfeito);
  } catch (erro) {
    // Recusa nova: o efeito foi desfeito; guarda para a repetição devolver a mesma recusa (conflito e recusa repetida já estão guardados).
    if (transacional && erro instanceof AcaoRecusadaError && !(erro instanceof AcaoConflitoError) && !erro.guardada) {
      erro.guardada = true;
      await guardarRecusa(chave, acao, hash, erro);
    }
    throw erro;
  }
}

module.exports = { executarUmaVez };
