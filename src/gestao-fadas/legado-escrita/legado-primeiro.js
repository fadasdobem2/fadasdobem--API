'use strict';

/**
 * LEGADO PRIMEIRO (Maturacao/46): o campo que tem casa no legado é gravado NO LEGADO, dentro do próprio pedido, ANTES do commit do Postgres; o
 * Postgres guarda só o que é novo (colunas sem casa no legado), o vínculo/ids e a auditoria. Este arquivo tem o que é comum às três entidades
 * (cliente, tarólogo, consulta): o modo, o erro 503 e o desfazer quando o Postgres falha DEPOIS de o legado ter recebido.
 *   - modo: `GF_LEGADO_MODO` (padrão `primeiro`; `copia` = o modo anterior, escrita DEPOIS do commit, mantido só para a carga das edições antigas e
 *     para os testes dele). O modo só vale com a flag geral E a da entidade ligadas e com a trava de banco (`GF_LEGADO_ESCRITA_BANCOS`).
 *   - legado falhou -> 503 (mensagem neutra: o front não tem texto próprio para isto) e NADA é salvo (a transação do Postgres é desfeita).
 *   - Postgres falhou depois do legado -> `ex.compensacoes` (rodadas pelo `gravar` do pedido): reverte o legado ao valor anterior se ele ainda
 *     tem o que escrevemos; senão marca `divergente`. Queda do processo: a reconciliação (`reconciliacao.js`) faz o mesmo com as `iniciada` antigas.
 */

const AppError = require('../../utils/AppError');
const { MapeamentoError } = require('./mapeamento');

const legado = () => require('./index');
const MENSAGEM_NEUTRA = 'Não foi possível salvar no sistema antigo agora. Nada foi alterado. Tente novamente em instantes.';

const modoPrimeiro = (env = process.env) => `${env.GF_LEGADO_MODO || 'primeiro'}`.trim().toLowerCase() !== 'copia';
const ativo = (entidade, env = process.env) => modoPrimeiro(env) && legado().espelhoLigado(env, entidade);

/** Erro do legado -> o que o pedido devolve. Valor que não cabe na coluna (mapeamento) é 422 com o motivo; o resto é 503 neutro. */
function falhaDoLegado(erro) {
  if (erro instanceof AppError) return erro;
  if (erro instanceof MapeamentoError) return new AppError(erro.message, 422, { codigo: 'RULE_VIOLATION' }, true);
  const codigo = (erro && (erro.codigo || erro.code)) || 'erro';
  console.error('[gf-legado-primeiro] o legado não aceitou a escrita:', codigo, String((erro && erro.message) || '').slice(0, 150));
  return new AppError(MENSAGEM_NEUTRA, 503, { codigo: 'LEGACY_UNAVAILABLE', usarMensagem: true }, true);
}

/** Valores do legado que ainda são os que escrevemos? (comparação por texto: o legado devolve datas e números como texto). */
const mesmosValores = (linha, colunas) => Object.entries(colunas).every(([c, v]) => String(linha && linha[c] === null ? '' : linha && linha[c]) === String(v === null ? '' : v));

/** Desfaz no legado o que o pedido escreveu (só se o legado ainda tem o `depois`). Devolve 'revertida' | 'divergente' | 'nada'. */
async function desfazer({ entidade, ler, escrever, idLegado, antes, depois }) {
  return legado().emTransacao(async (lx) => {
    const atual = await ler(lx, idLegado);
    if (!atual) return 'divergente';
    if (mesmosValores(atual, antes)) return 'nada';
    if (!mesmosValores(atual, depois)) return 'divergente'; // alguém (o ASP) mudou depois: não se sobrescreve
    await escrever(lx, idLegado, antes);
    return 'revertida';
  }, { entidade });
}

module.exports = { MENSAGEM_NEUTRA, modoPrimeiro, ativo, falhaDoLegado, mesmosValores, desfazer };
