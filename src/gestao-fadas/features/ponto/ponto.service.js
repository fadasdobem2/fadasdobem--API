'use strict';

/**
 * Ponto e escala da equipe (v702 da Nice): o contrato HTTP é o de `/api/staff-clock?resource=...` do front (`staff-clock-remote.ts`), com as
 * mesmas frases de recusa. A identidade vem só da sessão do servidor. Regras de domínio em `_comum/dominio/ponto-*.js` e `operacao-calendario.js`
 * (paridade com o front provada por `scripts/verificar-gf-ponto.js`). Cada recurso tem a ordem de recusa do serviço original:
 *   sem função no ponto 403 -> banco indisponível 503 -> recurso da atendente -> recurso da administradora (403 para a atendente).
 */

const { novosDadosNoPostgres } = require('../../novo/modo');
const { escritaHabilitada } = require('../../novo/escritor');
const { PontoErro } = require('./ponto.erro');
const { pessoaDaSessao, atendentes } = require('./ponto.identidade');
const relogioService = require('./ponto.relogio.service');
const escalaService = require('./ponto.escala.service');
const equipeService = require('./ponto.equipe.service');
const atividadeService = require('./ponto.atividade.service');

const tokenDeRecepcao = (env = process.env) => `${env.STAFF_ACTIVITY_INGEST_TOKEN || ''}`;
const indisponivel = () => new PontoErro('O banco de ponto está indisponível.', 503);

/** `GET availability`: o serviço do ponto está ligado neste servidor (a fatia está ativa). */
const disponibilidade = () => ({ status: 200, corpo: { enabled: true } });

async function sessao(pessoa) {
  const base = { mode: 'server', accountId: pessoa.id, accountName: pessoa.name, role: pessoa.role };
  return { status: 200, corpo: pessoa.role === 'administradora' ? { ...base, staff: await atendentes() } : base };
}

/** Recepção do diário: sem sessão (token de servidor). */
async function recepcao(req, relogio = Date.now) {
  if (req.method !== 'POST') throw new PontoErro('Método não permitido.', 405);
  const token = tokenDeRecepcao();
  if (!token || token.length < 32) throw new PontoErro('Recepção de eventos não configurada.', 503);
  if (!novosDadosNoPostgres() || !escritaHabilitada()) throw new PontoErro('O banco de atividades está indisponível.', 503);
  return atividadeService.receber(req, token, await atendentes(), relogio());
}

function exigirCorpo(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new PontoErro('Dados inválidos.', 400);
}

/** Recursos com sessão. `relogio` é o relógio do servidor (injetável para prova). */
async function comSessao(req, relogio = Date.now) {
  const recurso = `${(req.query && req.query.resource) || ''}`;
  const pessoa = await pessoaDaSessao(req);
  if (!pessoa) throw new PontoErro('O ponto requer uma conta autenticada e autorizada no servidor.', 403);
  if (recurso === 'session' && req.method === 'GET') return sessao(pessoa);
  if (!novosDadosNoPostgres()) throw indisponivel();
  const escreve = req.method !== 'GET';
  if (escreve && !escritaHabilitada()) throw indisponivel();
  if (recurso === 'my-schedule') {
    if (req.method === 'PUT') exigirCorpo(req);
    return escalaService.propria(req, pessoa, relogio);
  }
  if (recurso === 'presence') {
    if (pessoa.role === 'administradora') throw new PontoErro('Consulte a presença da equipe no relatório administrativo.', 403);
    if (req.method !== 'GET' || req.query.accountId !== undefined) throw new PontoErro('A presença pessoal usa a identidade da sessão.', 400);
    return { status: 200, corpo: { presence: await atividadeService.presencaAte(pessoa.id, relogio()) } };
  }
  if (recurso === 'current') {
    if (pessoa.role === 'administradora') throw new PontoErro('Somente a própria atendente pode acessar seu ponto.', 403);
    if (req.method === 'GET') return relogioService.lerAtual(pessoa);
    if (req.method === 'POST') { exigirCorpo(req); return relogioService.comandar(pessoa, req.body, relogio); }
    throw new PontoErro('Método não permitido.', 405);
  }
  if (pessoa.role !== 'administradora') throw new PontoErro('A consulta de equipe exige acesso administrativo.', 403);
  if (recurso === 'team-day' && req.method === 'GET') return equipeService.equipeNoDia(req, relogio);
  const idConta = req.query.accountId;
  if (!(await atendentes()).some((p) => p.id === idConta)) throw new PontoErro('Atendente não encontrada.', 404);
  if (recurso === 'activity' && req.method === 'GET') return atividadeService.ler(req, idConta, tokenDeRecepcao());
  if (recurso === 'shifts' && req.method === 'GET') return equipeService.turnos(req, idConta);
  if (recurso === 'schedule') {
    if (req.method === 'PUT') exigirCorpo(req);
    return escalaService.daAtendente(req, pessoa, idConta);
  }
  throw new PontoErro('Operação não permitida.', 405);
}

module.exports = { disponibilidade, recepcao, comSessao, tokenDeRecepcao };
