'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const service = require('./ciclo.service');
const painel = require('./ciclo.painel');

/** O gate remove o envelope `{sucesso, dados}` e devolve o DTO puro, como a B. */
const rota = (fn, mensagem) => catchAsyncRoute(async (req, res) => responderSucesso(res, await fn(req), mensagem, 200));

module.exports = {
  ler: rota(service.ler, 'Consultas.'),
  fontesDoPainel: rota(painel.fontes, 'Fontes do Painel.'),
  lancar: rota(service.lancar, 'Consulta lançada.'),
  iniciar: rota(service.iniciar, 'Consulta iniciada.'),
  pausar: rota(service.pausar, 'Consulta pausada.'),
  retomar: rota(service.retomar, 'Consulta retomada.'),
  termino: rota(service.informarTermino, 'Término informado.'),
  terminoPelaEquipe: rota(service.informarTerminoPelaEquipe, 'Término registrado pela equipe.'),
  devolver: rota(service.devolver, 'Consulta devolvida.'),
  maisTempo: rota(service.pedirMaisTempo, 'Pedido de mais tempo registrado.'),
  correcao: rota(service.pedirCorrecao, 'Correção solicitada.'),
  revisar: rota(service.revisar, 'Consulta atualizada.'),
};
