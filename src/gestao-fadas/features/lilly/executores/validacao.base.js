'use strict';

/**
 * Conferências comuns do `validate` (Maturacao/59, 2.3): vínculo ativo e verificado cliente x conversa (`gf_lilly_vinculos`), cliente real,
 * tarólogo existente e ativo, `contactId`. Recusa conhecida volta `{ allowed:false, reason }` (HTTP 200, nunca 5xx).
 * `conferirBase` devolve `null` (tudo certo) ou a recusa; `permitido` monta a resposta positiva com o `context`.
 */

const vinculos = require('../dados/vinculos.repo');
const { avulso } = require('../dados/executor');
const { dependencias } = require('./executores.dependencias');
const { texto, ehIdCliente } = require('./executores.comum');
const cfg = require('./executores.config');

const nao = (reason) => ({ allowed: false, reason });
const FILA_GERAL = 'afila';

/** O tarólogo existe no catálogo e tem cadastro ativo. `null` se está tudo certo. */
async function conferirTarologo(tarologistId) {
  if (tarologistId === FILA_GERAL) return null;
  const { catalogo, item } = await dependencias().lerTarologo(tarologistId);
  if (!catalogo) return nao('Não consegui conferir o cadastro do tarólogo agora. Tente de novo em instantes.');
  if (!item) return nao('Tarólogo não encontrado no cadastro.');
  if (item.registrationActive === false) return nao('O cadastro deste tarólogo está inativo.');
  return null;
}

/**
 * @param {object} acao   ação da Lilly
 * @param {{exigirCliente?:boolean, exigirVinculo?:boolean, vinculoOpcional?:boolean, exigirTarologo?:boolean, exigirConta?:boolean, executor?:object}} [o]
 * @returns {Promise<{recusa: null|{allowed:false, reason:string}, vinculo?: object|null}>}
 */
async function conferirBaseComVinculo(acao, { exigirCliente = false, exigirVinculo = false, vinculoOpcional = false, exigirTarologo = false, exigirConta = false, executor = avulso } = {}) {
  if (exigirConta && !cfg.contaDeServico()) return { recusa: nao('A conta de serviço da Lilly não está configurada no Gestão.') };
  const conversa = texto(acao.conversationId);
  if (!conversa) return { recusa: nao('A ação não informa a conversa.') };
  const cliente = acao.clientId === undefined || acao.clientId === null ? '' : `${acao.clientId}`;
  if (exigirCliente && !cliente) return { recusa: nao('A ação não informa a cliente.') };
  if (cliente && !ehIdCliente(cliente)) return { recusa: nao('O ID da cliente é inválido.') };
  if (cliente && !(await dependencias().clienteExiste(cliente))) return { recusa: nao('Cadastro de cliente não encontrado.') };
  let vinculo = null;
  if (cliente && exigirVinculo) {
    vinculo = await vinculos.buscarAtivoDaConversa(executor, conversa);
    if (!vinculo || vinculo.clientId !== cliente) return { recusa: nao('A conversa não está vinculada a esta cliente (vínculo ativo e verificado).') };
  }
  if (exigirVinculo && !cliente) return { recusa: nao('A ação não informa a cliente.') };
  // Conversa do TARÓLOGO (ex.: start_consultation): a cliente não tem vínculo com ela. Sem vínculo passa; vínculo com OUTRA cliente recusa.
  if (cliente && vinculoOpcional && !exigirVinculo) {
    vinculo = await vinculos.buscarAtivoDaConversa(executor, conversa);
    if (vinculo && vinculo.clientId !== cliente) return { recusa: nao('A conversa está vinculada a outra cliente.') };
  }
  if (exigirTarologo) {
    const t = texto(acao.tarologistId);
    if (!t) return { recusa: nao('A ação não informa o tarólogo.') };
    const recusa = await conferirTarologo(t);
    if (recusa) return { recusa };
  }
  return { recusa: null, vinculo };
}

const conferirBase = async (acao, opcoes) => (await conferirBaseComVinculo(acao, opcoes)).recusa;

/** Resposta positiva do `validate`: `{ allowed:true, context, ...extra }`. */
async function permitido(acao, extra = {}) {
  return { allowed: true, ...extra, context: await dependencias().montarContexto(acao) };
}

module.exports = { nao, conferirBase, conferirBaseComVinculo, conferirTarologo, permitido, FILA_GERAL };
