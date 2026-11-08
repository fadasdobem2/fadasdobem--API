'use strict';

/**
 * `update_client` e `register_client` (Maturacao/59, 5.1; decisões em Maturacao/60, item 1; v708 em docs/banco/21 da Nice):
 *  - `update_client`: completa/atualiza a cliente. Legado: PATCH existente (identificação, tratar por, WhatsApp, nascimento) + extensão
 *    (`situacao_cadastral`, `sem_email`, e-mail, nome completo). Faixa nova: `gf_clientes_novos`. Devolve `{ id }` igual ao `clientId` da ação;
 *  - `register_client`: com ID existente completa o cadastro (como antes). SEM ID cria a cliente no BANCO NOVO (`cliente.registro.js`), só
 *    com `GF_LILLY_CADASTRO_NOVO_ENABLED` ligada; desligada, recusa 4xx como antes (ponto de extensão em `cadastro-legado.js`).
 *    O legado nunca é escrito. O ID real só sai depois do commit.
 */

const { registrar } = require('../acoes/acoes.registro');
const { conferirCliente, completarCadastro, resultadoDoCadastro } = require('./cliente.comum');
const { criarClienteNoLegado, motivoDoCadastroNovo } = require('./cadastro-legado');
const { conferirCriacao, criarCliente } = require('./cliente.registro');
const { atualizarClienteNovo, complementarClienteLegado } = require('./cliente.atualizacao');
const { normalizarCampos } = require('./cliente.campos');
const { nao, permitido } = require('./validacao.base');
const { ehObjeto, ehIdCliente, recusar } = require('./executores.comum');
const { dependencias } = require('./executores.dependencias');
const { ehIdDaFaixaNova } = require('../../clientes/cliente-novo');
const { avulso } = require('../dados/executor');
const cfg = require('./executores.config');

const semConta = () => (cfg.contaDeServico() ? null : nao('A conta de serviço da Lilly não está configurada no Gestão.'));
const idInformado = (acao) => `${acao.clientId ?? (ehObjeto(acao.payload) ? acao.payload.clientId : '') ?? ''}`.trim();

/** Campos do v708 normalizados ou recusa 422. */
function camposOuRecusa(acao) {
  const r = normalizarCampos(acao.payload);
  if (r.erro) recusar('LILLY_CLIENT_INVALID', r.erro);
  return r.campos;
}

/** Atualiza (legado ou faixa nova) e devolve `{ id, ... }`. `registro` = veio de `register_client` com ID existente. */
async function atualizar(acao, ctx, registro) {
  const campos = camposOuRecusa(acao);
  const id = idInformado(acao);
  if (ehIdDaFaixaNova(id)) return { ...(await atualizarClienteNovo(acao, ctx, id, campos)), ...(registro ? { paymentType: 'Pré-pago', postpaid: false } : {}) };
  const feito = await completarCadastro(acao, ctx, { registro });
  const compl = await complementarClienteLegado(acao, ctx, feito.id, campos);
  const extra = compl ? { situacao_cadastral: compl.situacao ?? undefined, noEmail: compl.semEmail === true } : {};
  if (registro) return { ...resultadoDoCadastro(acao, feito), ...extra };
  return { id: feito.id, ...(feito.mudancas.treatAs ? { treatAs: feito.mudancas.treatAs } : {}), changed: Object.keys(feito.mudancas), ...extra };
}

function registrarCliente() {
  registrar('update_client', {
    async validar(acao) {
      const sem = semConta(); if (sem) return sem;
      if (!ehObjeto(acao.payload)) return nao('A ação não traz os dados do cadastro.');
      const { erro } = normalizarCampos(acao.payload); if (erro) return nao(erro);
      const { id, motivo } = await conferirCliente(acao, avulso);
      if (motivo) return nao(motivo);
      return permitido(acao, { clientId: id });
    },
    executar: (acao, ctx) => atualizar(acao, ctx, false),
  });
  registrar('register_client', {
    async validar(acao) {
      const sem = semConta(); if (sem) return sem;
      if (!ehObjeto(acao.payload)) return nao('A ação não traz os dados do cadastro.');
      if (!idInformado(acao)) {
        if (!cfg.cadastroNovoLigado()) return nao(motivoDoCadastroNovo());
        const v = await conferirCriacao(avulso, acao);
        return v.motivo ? nao(v.motivo) : permitido(acao);
      }
      const { erro } = normalizarCampos(acao.payload); if (erro) return nao(erro);
      const { id, motivo } = await conferirCliente(acao, avulso);
      if (motivo) return nao(motivo.startsWith('Cadastro de cliente não') ? `${motivo} ${motivoDoCadastroNovo()}` : motivo);
      return permitido(acao, { clientId: id });
    },
    async executar(acao, ctx) {
      const id = idInformado(acao);
      if (!id && cfg.cadastroNovoLigado()) return criarCliente(acao, ctx);
      // Sem ID existente e cadastro novo desligado: ponto de extensão do legado (sempre recusa 4xx hoje).
      if (!ehIdCliente(id) || !(await dependencias().clienteExiste(id))) criarClienteNoLegado(acao.payload, ctx);
      return atualizar(acao, ctx, true);
    },
  });
}

module.exports = { registrarCliente };
