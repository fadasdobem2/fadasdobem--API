'use strict';

const { Router } = require('express');
const controller = require('./specialist-candidates.admin.controller');

const router = Router();

router.get('/', controller.list);
router.get('/summary', controller.summary);
router.post('/', controller.create);
router.get('/:id', controller.getById);
router.patch('/:id', controller.patch);
router.patch('/:id/estado', controller.patchEstado);
router.patch('/:id/triagem/espera', controller.patchEspera);
router.patch('/:id/decisao', controller.patchDecisao);
router.patch('/:id/reabrir', controller.reabrir);
router.post('/:id/convite', controller.convite);
router.patch('/:id/f2-recebido', controller.marcarF2);
router.post('/:id/iniciar-processo', controller.iniciarProcesso);
router.put('/:id/perfil-publico', controller.putPerfilPublico);
router.put('/:id/cadastro-privado', controller.putCadastroPrivado);
router.put('/:id/pagamento', controller.putPagamento);
router.post('/:id/gerar-perfil', controller.gerarPerfil);
router.post('/:id/liberar-acesso', controller.liberarAcesso);
router.post('/:id/ativar', controller.ativar);
router.post('/:id/upload', controller.upload);
router.delete('/:id/contrato', controller.removeContrato);
router.patch('/:id/foto', controller.toggleFoto);

module.exports = router;
