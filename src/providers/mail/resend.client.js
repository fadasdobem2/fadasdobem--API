const { Resend } = require('resend');

let client;

/**
 * Instância lazy do cliente Resend. Retorna null se não houver chave configurada.
 * @returns {import('resend').Resend | null}
 */
function getResend() {
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) return null;
  if (!client) {
    client = new Resend(key);
  }
  return client;
}

module.exports = {
  getResend,
};
