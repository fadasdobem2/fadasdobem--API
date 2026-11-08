'use strict';

/** Liga o serviço de e-mails ao ambiente: banco novo, chave e flags vêm do ambiente; o ator vem SÓ da sessão do servidor (`req.perfilGate`, `req.user`). */

const { randomUUID } = require('crypto');
const { novosDadosNoPostgres } = require('../../novo/modo');
const { chaveConfigurada } = require('./email.cripto');
const { criarEnvio } = require('./email.envio');
const { repositorio } = require('./email.store');
const { contasPorEmail } = require('./email.convite');
const service = require('./email.service');

const ligado = (nome, env) => `${env[nome] || ''}`.trim().toLowerCase() === 'true';

function ambiente(env = process.env) {
  return {
    armazenamento: novosDadosNoPostgres(env), chave: env.GF_EMAIL_CHAVE_SEGREDO, chaveOk: chaveConfigurada(env.GF_EMAIL_CHAVE_SEGREDO),
    envioLigado: ligado('GF_EMAIL_ENVIO_ENABLED', env), origem: env.GF_EMAIL_ORIGEM_PUBLICA || env.FADAS_ORIGIN || '',
  };
}

/** Convites e recuperação por e-mail só existem com a fatia de contas ligada (é onde o convite mora). */
const dependencias = (env = process.env, extra = {}) => ({
  repo: repositorio, enviar: criarEnvio(), convites: ligado('GF_FATIA_CONTAS', env) ? contasPorEmail : undefined, env: ambiente(env), agora: Date.now, uuid: randomUUID, ...extra,
});

const atorDa = (req) => (req.user && `${req.user.id || ''}`.trim() && req.perfilGate ? { id: `${req.user.id}`.trim(), role: req.perfilGate } : null);

/** `{ status, corpo }` para o pedido (o gate já conferiu origem, JSON e, quando preciso, a sessão). */
const tratar = (req, extra) => service.tratar(dependencias(process.env, extra), {
  recurso: `${(req.query && req.query.resource) || 'settings'}`, metodo: req.method, corpo: req.body, ator: atorDa(req),
});

module.exports = { tratar, dependencias, ambiente, atorDa };
