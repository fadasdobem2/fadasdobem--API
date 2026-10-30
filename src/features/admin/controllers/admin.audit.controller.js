'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const { listAuditLogs } = require('../services/admin.audit.service');

module.exports = {
  list: catchAsyncRoute(async (req, res) => {
    const dados = await listAuditLogs(req.query || {});
    return responderSucesso(res, dados, 'Auditoria listada.', 200);
  }),
};
