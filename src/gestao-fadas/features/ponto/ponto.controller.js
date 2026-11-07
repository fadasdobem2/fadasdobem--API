'use strict';

const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const service = require('./ponto.service');

/** Resposta `{ status, corpo }` do service: o gate já devolve o corpo puro (o front do ponto lê `{ error: <frase> }`). */
const responder = (res, r) => res.status(r.status).json(r.corpo);

module.exports = {
  disponibilidade: (req, res) => responder(res, service.disponibilidade()),
  recepcao: catchAsyncRoute(async (req, res) => responder(res, await service.recepcao(req))),
  comSessao: catchAsyncRoute(async (req, res) => responder(res, await service.comSessao(req))),
};
