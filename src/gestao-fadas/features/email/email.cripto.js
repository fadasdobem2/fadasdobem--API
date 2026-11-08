'use strict';

/**
 * Segredo das conexões de e-mail, cifrado em repouso: AES-256-GCM, IV de 12 bytes, a identificação da conexão como dado associado
 * (o mesmo formato `v1.<iv>.<cifrado+tag>` do front, features/email/email-crypto.ts, que usa WebCrypto). A chave mestra vem de
 * `GF_EMAIL_CHAVE_SEGREDO` (32 bytes em base64) e nunca é gravada, registrada nem devolvida.
 */

const { createCipheriv, createDecipheriv, randomBytes, createHash } = require('crypto');

const chaveDe = (mestra) => {
  const bruta = Buffer.from(`${mestra || ''}`, 'base64');
  if (bruta.length !== 32) throw new Error('Proteção de e-mails não configurada.');
  return bruta;
};

function cifrarSegredo(segredo, mestra, id) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chaveDe(mestra), iv);
  c.setAAD(Buffer.from(id, 'utf8'));
  const dados = Buffer.concat([c.update(Buffer.from(segredo, 'utf8')), c.final(), c.getAuthTag()]);
  return `v1.${iv.toString('base64')}.${dados.toString('base64')}`;
}

function decifrarSegredo(cifra, mestra, id) {
  const [v, iv, dados] = `${cifra}`.split('.');
  if (v !== 'v1' || !iv || !dados) throw new Error('Credencial de e-mail inválida.');
  const bruto = Buffer.from(dados, 'base64');
  if (bruto.length < 16) throw new Error('Credencial de e-mail inválida.');
  const d = createDecipheriv('aes-256-gcm', chaveDe(mestra), Buffer.from(iv, 'base64'));
  d.setAAD(Buffer.from(id, 'utf8'));
  d.setAuthTag(bruto.subarray(bruto.length - 16));
  return Buffer.concat([d.update(bruto.subarray(0, bruto.length - 16)), d.final()]).toString('utf8');
}

const chaveConfigurada = (mestra) => { try { chaveDe(mestra); return true; } catch { return false; } };
const impressao = (texto) => createHash('sha256').update(texto, 'utf8').digest('hex');

module.exports = { cifrarSegredo, decifrarSegredo, chaveConfigurada, impressao };
