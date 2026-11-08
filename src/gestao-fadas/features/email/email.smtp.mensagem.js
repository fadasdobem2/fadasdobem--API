'use strict';

/**
 * Peças puras do envio SMTP, porte de server/email/smtp-transport.mjs do front (v711): validação do endereço, a regra "só endereço PÚBLICO"
 * (recusa host que resolve para rede privada, loopback, link-local, documentação, 6to4...) e a mensagem MIME em texto, base64 e UTF-8.
 */

const net = require('net');

const mailbox = (v) => typeof v === 'string' && v.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(v);

function ipv4Publico(address) {
  const p = address.split('.').map(Number);
  const reservado = p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224
    || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    || (p[0] === 192 && (p[1] === 168 || (p[1] === 0 && (p[2] === 0 || p[2] === 2)) || (p[1] === 88 && p[2] === 99)))
    || (p[0] === 198 && (p[1] === 18 || p[1] === 19 || (p[1] === 51 && p[2] === 100)))
    || (p[0] === 203 && p[1] === 0 && p[2] === 113);
  return !reservado;
}

/** Só unicast global 2000::/3, sem atribuições de protocolo, 6to4 e documentação. */
function ipv6Publico(address) {
  const grupos = address.toLowerCase().split(':');
  const primeiro = parseInt(grupos[0], 16);
  const segundo = parseInt(grupos[1] || '0', 16);
  return primeiro >= 0x2000 && primeiro <= 0x3fff && !(primeiro === 0x2001 && (segundo < 0x200 || segundo === 0xdb8)) && primeiro !== 0x2002 && primeiro !== 0x3fff;
}

function publicAddress(address) {
  if (net.isIP(address) === 4) return ipv4Publico(address);
  return net.isIP(address) === 6 && ipv6Publico(address);
}

const codificado = (v) => `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;

function smtpMessage(message) {
  const ok = message && mailbox(message.to) && mailbox(message.sender && message.sender.from)
    && !(message.sender.replyTo && !mailbox(message.sender.replyTo))
    && [message.subject, message.sender.senderName].every((v) => typeof v === 'string' && v.length < 200 && !/[\r\n\0]/.test(v))
    && typeof message.text === 'string' && message.text.length <= 100000;
  if (!ok) throw new Error('invalid-mail');
  const corpo = Buffer.from(message.text, 'utf8').toString('base64').match(/.{1,76}/g);
  const linhas = [
    `From: ${codificado(message.sender.senderName)} <${message.sender.from}>`, `To: <${message.to}>`, `Subject: ${codificado(message.subject)}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64',
    ...(message.sender.replyTo ? [`Reply-To: <${message.sender.replyTo}>`] : []), '', corpo ? corpo.join('\r\n') : '',
  ];
  return `${linhas.join('\r\n')}\r\n`;
}

module.exports = { mailbox, publicAddress, smtpMessage };
