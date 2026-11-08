'use strict';

/**
 * Entrega de uma mensagem pela conexão escolhida. SMTP: `email.smtp.js` (TLS obrigatório). Resend: endereço FIXO da API, chave só no cabeçalho,
 * `Idempotency-Key` com o id do recibo, sem seguir redirecionamento (porte de features/email/email-delivery.ts). Falha é sempre `delivery-failed`.
 */

const { sendSmtp } = require('./email.smtp');

const RESEND_URL = 'https://api.resend.com/emails';

async function enviarResend(secret, message, transporte) {
  const nome = message.sender.senderName.replace(/["\\]/g, '');
  const resposta = await transporte(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', 'Idempotency-Key': message.id },
    body: JSON.stringify({ from: `"${nome}" <${message.sender.from}>`, to: [message.to], reply_to: message.sender.replyTo || undefined, subject: message.subject, text: message.text }),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!resposta.ok) throw new Error('delivery-failed');
}

/** `enviar(connection, secret, message)` pronto para o serviço; `transporte` (fetch) e `smtp` são injetáveis nas provas. */
function criarEnvio({ transporte = (...a) => fetch(...a), smtp = sendSmtp } = {}) {
  return async (connection, secret, message) => {
    if (connection.transport === 'resend') return enviarResend(secret, message, transporte);
    return smtp(connection, secret, message);
  };
}

module.exports = { criarEnvio, RESEND_URL };
