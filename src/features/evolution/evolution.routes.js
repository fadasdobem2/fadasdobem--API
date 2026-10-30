const { Router } = require('express');
const evolutionController = require('./evolution.controller');

const router = Router();

router.get('/integrations/status', evolutionController.probeIntegration);
router.get('/instances', evolutionController.listInstances);
router.post('/instances/:instanceName/reconnect', evolutionController.reconnectInstance);

module.exports = router;
