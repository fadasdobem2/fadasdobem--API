'use strict';

/** Preparo da configuração para gravar (porte de `prepareEmailSettings`, features/email/email-service.ts): revisão, segredos novos e reaproveitados. */

const { validateEmailSettings } = require('../../_comum/dominio/email-modelo');
const { cifrarSegredo } = require('./email.cripto');
const { entrada, EmailErro } = require('./email.erro');

const MSG_CREDENCIAIS = 'Confira as credenciais de envio.';

/** Segredo velho só vale se a conexão continua a mesma (mesmo transporte, servidor e usuário). */
const mesmaConexao = (a, b) => Boolean(a) && a.transport === b.transport && a.host === b.host && a.username === b.username;

async function prepareEmailSettings(anterior, valor, segredos, mestra) {
  let settings;
  try { settings = validateEmailSettings(valor); } catch (e) { throw entrada(e instanceof Error ? e.message : 'Confira a configuração.'); }
  if (settings.revision !== (anterior ? anterior.settings.revision : 0)) throw entrada('A configuração mudou. Recarregue antes de salvar.', 409);
  const novos = segredos === undefined || segredos === null ? {} : segredos;
  if (typeof novos !== 'object' || Array.isArray(novos)
    || Object.entries(novos).some(([id, v]) => !settings.connections.some((c) => c.id === id) || typeof v !== 'string' || v.length > 4096 || /[\r\n\0]/.test(v))) throw entrada(MSG_CREDENCIAIS);
  const guardados = {};
  for (const c of settings.connections) {
    const segredo = novos[c.id];
    const velha = anterior && anterior.settings.connections.find((v) => v.id === c.id);
    if (segredo) guardados[c.id] = cifrarSegredo(segredo, mestra, c.id);
    else if (mesmaConexao(velha, c) && anterior.secrets[c.id]) guardados[c.id] = anterior.secrets[c.id];
    else throw entrada(`Informe a senha ou chave da conexão ${c.label}.`);
    c.hasSecret = true;
  }
  return { settings: { ...settings, revision: settings.revision + 1 }, secrets: guardados };
}

module.exports = { prepareEmailSettings, EmailErro };
