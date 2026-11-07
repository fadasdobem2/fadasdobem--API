'use strict';

/**
 * `update_client` e `register_client` (Maturacao/59, 5.1; decisões em Maturacao/60, item 1):
 *  - `update_client`: completa/atualiza a cliente (`treatAs`, nome de identificação...) pelo PATCH existente, respeitando `onlyIfEmpty`;
 *    devolve `{ id }` igual ao `clientId` da ação (senão a Lilly escreve Nota "não retornou o ID esperado");
 *  - `register_client`: SÓ completa uma cliente cujo ID já existe. Sem ID existente, recusa 4xx (ponto de extensão em `cadastro-legado.js`).
 */

const { registrar } = require('../acoes/acoes.registro');
const { conferirCliente, completarCadastro, resultadoDoCadastro } = require('./cliente.comum');
const { criarClienteNoLegado, motivoDoCadastroNovo } = require('./cadastro-legado');
const { nao, permitido } = require('./validacao.base');
const { ehObjeto, ehIdCliente } = require('./executores.comum');
const { dependencias } = require('./executores.dependencias');
const { avulso } = require('../dados/executor');
const cfg = require('./executores.config');

const semConta = () => (cfg.contaDeServico() ? null : nao('A conta de serviço da Lilly não está configurada no Gestão.'));
const idInformado = (acao) => `${acao.clientId ?? (ehObjeto(acao.payload) ? acao.payload.clientId : '') ?? ''}`.trim();

function registrarCliente() {
  registrar('update_client', {
    async validar(acao) {
      const sem = semConta(); if (sem) return sem;
      if (!ehObjeto(acao.payload)) return nao('A ação não traz os dados do cadastro.');
      const { id, motivo } = await conferirCliente(acao, avulso);
      if (motivo) return nao(motivo);
      return permitido(acao, { clientId: id });
    },
    async executar(acao, ctx) {
      const feito = await completarCadastro(acao, ctx, { registro: false });
      return { id: feito.id, ...(feito.mudancas.treatAs ? { treatAs: feito.mudancas.treatAs } : {}), changed: Object.keys(feito.mudancas) };
    },
  });
  registrar('register_client', {
    async validar(acao) {
      const sem = semConta(); if (sem) return sem;
      if (!ehObjeto(acao.payload)) return nao('A ação não traz os dados do cadastro.');
      if (!idInformado(acao)) return nao(motivoDoCadastroNovo());
      const { id, motivo } = await conferirCliente(acao, avulso);
      if (motivo) return nao(motivo.startsWith('Cadastro de cliente não') ? `${motivo} ${motivoDoCadastroNovo()}` : motivo);
      return permitido(acao, { clientId: id });
    },
    async executar(acao, ctx) {
      const id = idInformado(acao);
      // Sem ID existente: ponto de extensão do cadastro novo (sempre recusa 4xx hoje).
      if (!ehIdCliente(id) || !(await dependencias().clienteExiste(id))) criarClienteNoLegado(acao.payload, ctx);
      return resultadoDoCadastro(acao, await completarCadastro(acao, ctx, { registro: true }));
    },
  });
}

module.exports = { registrarCliente };
