'use strict';

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const { requireStaffAccess, attachAccessContext } = require('../middlewares/authorization.middleware');
const { responderSucesso } = require('../utils/response.util');
const { catchAsyncRoute } = require('../utils/catchAsync.util');
const { statusLegado, listarModelos } = require('../models/legado');

const router = Router();

/** Todo o módulo exige login e equipe (GESTORA/ATENDENTE); cada rota exige a permissão RBAC do seu assunto. */
router.use(authMiddleware, requireStaffAccess, attachAccessContext);

router.get(
  '/status',
  catchAsyncRoute(async (_req, res) => {
    const m = listarModelos();
    return responderSucesso(res, { legado: await statusLegado(), models: { legado: m.legado.length, novas: m.novas.length } }, 'Estado do módulo Gestão Fadas.', 200);
  })
);

router.use('/clientes', require('./features/clientes/clientes.routes'));
router.use('/tarologos', require('./features/tarologos/tarologos.routes'));
router.use('/consultas', require('./features/consultas/consultas.routes'));
router.use('/pagamentos', require('./features/pagamentos/pagamentos.routes'));
router.use('/repasse', require('./features/repasse/repasse.routes'));

module.exports = router;
