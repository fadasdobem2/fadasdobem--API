'use strict';

/**
 * Idempotência genérica em `gf_operacoes` (banco novo): uma operação = (escopo, chave). A mesma chave com o MESMO corpo
 * devolve a resposta guardada sem repetir o efeito; com outro corpo é conflito (o 409 `OPERATION_KEY_CONFLICT` da camada HTTP).
 * Deve rodar DENTRO da transação do efeito (`executor` de `emTransacao`), para a resposta guardada e o efeito andarem juntos.
 */

const { createHash } = require('crypto');

class OperacaoConflitoError extends Error {
  constructor() {
    super('operação: a chave já foi usada com outro corpo');
    this.name = 'OperacaoConflitoError';
    this.codigo = 'operation-key-conflict';
  }
}

/** JSON com chaves em ordem estável, para o mesmo corpo dar o mesmo hash. */
function estavel(v) {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${estavel(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
const hashDoCorpo = (corpo) => createHash('sha256').update(estavel(corpo), 'utf8').digest('hex');

const LER = 'SELECT hash_corpo, resposta FROM gf_operacoes WHERE escopo = ? AND chave = ? FOR UPDATE';
const GRAVAR = 'INSERT INTO gf_operacoes (escopo, chave, hash_corpo, resposta) VALUES (?, ?, ?, ?)';

/** `producao()` faz o efeito e devolve a resposta (JSON). Devolve `{ repetida, resposta }`. */
async function umaVez(executor, { escopo, chave, corpo }, producao) {
  const hash = hashDoCorpo(corpo);
  const guardada = async () => {
    const [linhas] = await executor.execute(LER, [escopo, chave]);
    if (!linhas[0]) return null;
    if (linhas[0].hash_corpo !== hash) throw new OperacaoConflitoError();
    return { repetida: true, resposta: linhas[0].resposta === null ? null : JSON.parse(linhas[0].resposta) };
  };
  const anterior = await guardada();
  if (anterior) return anterior;
  const resposta = await producao();
  await executor.execute(GRAVAR, [escopo, chave, hash, resposta === undefined ? null : JSON.stringify(resposta)]);
  return { repetida: false, resposta: resposta === undefined ? null : resposta };
}

module.exports = { umaVez, hashDoCorpo, OperacaoConflitoError };
