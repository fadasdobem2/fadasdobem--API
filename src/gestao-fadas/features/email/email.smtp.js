'use strict';

/**
 * Remetente transacional SMTP, porte de `sendSmtp` (server/email/smtp-transport.mjs do front, v711). TLS é obrigatório e verificado
 * (465 implícito; 587 só segue se o servidor oferecer STARTTLS, e a sessão volta a ser negociada antes de qualquer credencial). O host precisa
 * resolver SÓ para endereços públicos e o socket abre no primeiro endereço conferido. Nenhuma credencial nem mensagem é registrada: qualquer
 * falha vira o mesmo erro `smtp-delivery-failed`. `resolve`, `connect` e `secureConnect` são injetáveis para as provas com servidor falso local.
 */

const net = require('net');
const tls = require('tls');
const dns = require('dns');
const { once } = require('events');
const { publicAddress, smtpMessage } = require('./email.smtp.mensagem');

const TEMPO_MS = 20_000;
const EHLO = 'EHLO fadasdobem.com.br';

function receptor(socket) {
  let texto = '';
  let linhas = [];
  let esperando = [];
  let falha;
  const fila = [];
  const aoReceber = (pedaco) => {
    texto += pedaco.toString('utf8');
    if (texto.length > 64000) { socket.destroy(new Error('smtp-response-too-large')); return; }
    for (;;) {
      const i = texto.indexOf('\n');
      if (i < 0) break;
      const linha = texto.slice(0, i).replace(/\r$/, '');
      texto = texto.slice(i + 1);
      linhas.push(linha);
      if (/^\d{3} /.test(linha)) {
        const resposta = linhas;
        linhas = [];
        const quem = esperando.shift();
        if (quem) quem.resolve(resposta); else fila.push(resposta);
      }
    }
  };
  const falhar = () => { falha = new Error('smtp-connection-failed'); for (const q of esperando) q.reject(falha); esperando = []; };
  socket.on('data', aoReceber);
  socket.on('error', falhar);
  socket.on('close', falhar);
  return {
    async ler() {
      if (fila.length) return fila.shift();
      if (falha) throw falha;
      return new Promise((resolve, reject) => esperando.push({ resolve, reject }));
    },
    soltar() { socket.off('data', aoReceber); socket.off('error', falhar); socket.off('close', falhar); },
  };
}

function conexaoValida(connection, secret) {
  return connection && connection.transport === 'smtp'
    && ((connection.port === 465 && connection.security === 'tls') || (connection.port === 587 && connection.security === 'starttls'))
    && typeof connection.host === 'string' && /^[a-z0-9.-]+\.[a-z]{2,63}$/i.test(connection.host)
    && typeof connection.username === 'string' && !/[\r\n\0]/.test(connection.username)
    && typeof secret === 'string' && secret && !/[\r\n\0]/.test(secret);
}

async function sendSmtp(connection, secret, message, { resolve = (h, o) => dns.promises.lookup(h, o), connect = net.connect, secureConnect = tls.connect } = {}) {
  smtpMessage(message);
  if (!conexaoValida(connection, secret)) throw new Error('invalid-smtp-configuration');
  const enderecos = await resolve(connection.host, { all: true, verbatim: true });
  if (!enderecos.length || enderecos.some((a) => !publicAddress(a.address))) throw new Error('smtp-address-not-public');
  const opcoes = { host: enderecos[0].address, port: connection.port, servername: connection.host, rejectUnauthorized: true, minVersion: 'TLSv1.2' };
  let socket;
  let leitor;
  const prazo = (s) => s.setTimeout(TEMPO_MS, () => s.destroy(new Error('smtp-timeout')));
  try {
    socket = connection.security === 'tls' ? secureConnect(opcoes) : connect({ host: opcoes.host, port: opcoes.port });
    prazo(socket);
    leitor = receptor(socket);
    const esperar = async (codigos) => {
      const resposta = await leitor.ler();
      if (!codigos.includes(Number(resposta[resposta.length - 1].slice(0, 3)))) throw new Error('smtp-command-rejected');
      return resposta;
    };
    const comando = async (valor, codigos) => { socket.write(`${valor}\r\n`); return esperar(codigos); };
    await esperar([220]);
    let recursos = await comando(EHLO, [250]);
    if (connection.security === 'starttls') {
      if (!recursos.some((s) => /STARTTLS/i.test(s))) throw new Error('smtp-tls-required');
      await comando('STARTTLS', [220]);
      leitor.soltar();
      socket = secureConnect({ ...opcoes, socket });
      prazo(socket);
      leitor = receptor(socket);
      await once(socket, 'secureConnect');
      recursos = await comando(EHLO, [250]);
    }
    if (!socket.authorized) throw new Error('smtp-certificate-invalid');
    if (!recursos.some((s) => /AUTH.*(?:PLAIN|LOGIN)/i.test(s))) throw new Error('smtp-auth-unavailable');
    if (recursos.some((s) => /AUTH.*PLAIN/i.test(s))) {
      await comando(`AUTH PLAIN ${Buffer.from(`\0${connection.username}\0${secret}`).toString('base64')}`, [235]);
    } else {
      await comando('AUTH LOGIN', [334]);
      await comando(Buffer.from(connection.username).toString('base64'), [334]);
      await comando(Buffer.from(secret).toString('base64'), [235]);
    }
    await comando(`MAIL FROM:<${message.sender.from}>`, [250]);
    await comando(`RCPT TO:<${message.to}>`, [250, 251]);
    await comando('DATA', [354]);
    socket.write(`${smtpMessage(message)}.\r\n`);
    await esperar([250]);
    socket.end('QUIT\r\n');
  } catch {
    throw new Error('smtp-delivery-failed');
  } finally {
    if (leitor) leitor.soltar();
    if (socket) socket.destroy();
  }
}

module.exports = { sendSmtp };
