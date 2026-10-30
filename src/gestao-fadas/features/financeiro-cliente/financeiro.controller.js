'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const precos = require('./precos.service');
const pagamentos = require('./pagamentos.service');
const restricoes = require('./restricoes.service');

/** O gate remove o envelope `{sucesso, dados}` e devolve o DTO puro, como a B. */
const rota = (fn, mensagem) => catchAsyncRoute(async (req, res) => responderSucesso(res, await fn(req), mensagem, 200));

module.exports = {
  lerPrecos: rota(precos.ler, 'Valores.'),
  criarVersaoDePreco: rota(precos.criarVersao, 'Valores atualizados.'),
  lerPagamentos: rota(pagamentos.ler, 'Pagamentos.'),
  contas: rota(pagamentos.contas, 'Contas das clientes.'),
  lancarPagamento: rota(pagamentos.lancar, 'Pagamento lançado.'),
  revisarPagamento: rota(pagamentos.revisar, 'Pagamento atualizado.'),
  concederBeneficio: rota(pagamentos.conceder, 'Benefício lançado.'),
  lerRestricoes: rota(restricoes.ler, 'Restrições.'),
  gravarRestricao: rota(restricoes.gravar, 'Restrição atualizada.'),
};
