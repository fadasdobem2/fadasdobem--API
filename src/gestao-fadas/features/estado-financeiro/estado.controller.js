'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const motivos = require('./motivos.service');
const adicionais = require('./adicionais.service');
const log = require('./log.service');

/** O gate remove o envelope `{sucesso, dados}` e devolve o DTO puro, como a B. */
const rota = (fn, mensagem) => catchAsyncRoute(async (req, res) => responderSucesso(res, await fn(req), mensagem, 200));

module.exports = {
  lerMotivos: rota(motivos.ler, 'Motivos financeiros.'),
  gravarMotivo: rota(motivos.gravar, 'Motivo gravado.'),
  lerAdicionais: rota(adicionais.ler, 'Adicionais do repasse.'),
  gravarAdicional: rota(adicionais.gravar, 'Adicional gravado.'),
  lerLog: rota(log.ler, 'Trilha operacional.'),
  gravarLog: rota(log.gravar, 'Eventos registrados.'),
};
