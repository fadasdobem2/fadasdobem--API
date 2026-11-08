'use strict';

/**
 * Servidor SMTP FALSO, local e descartável, para provar o envio real sem credencial nem rede externa. Certificado autoassinado criado na hora
 * com o openssl (apagado no fim). Modos: `tls` (465, implícito) e `starttls` (587). Opções: `semStarttls`, `senhaCerta`, `semAuth`, `certificadoErrado`.
 * Guarda o que recebeu em `recebidos`. Nada aqui é real: usuário, senha e mensagens são de mentira.
 */

const net = require('net');
const tls = require('tls');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function certificado(dir, nome, cn) {
  const chave = path.join(dir, `${nome}.key`); const cert = path.join(dir, `${nome}.crt`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', chave, '-out', cert, '-subj', `/CN=${cn}`, '-addext', `subjectAltName=DNS:${cn}`, '-days', '1'], { stdio: 'pipe' });
  return { key: fs.readFileSync(chave), cert: fs.readFileSync(cert) };
}

async function criarServidor({ modo = 'starttls', semStarttls = false, senhaCerta = 'senha-ficticia', semAuth = false, authLogin = false, certificadoErrado = false, cn = 'smtp.example.org' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-smtp-'));
  const certOk = certificado(dir, 'ok', cn); const certRuim = certificadoErrado ? certificado(dir, 'ruim', 'outro.example.net') : null;
  const credencial = certRuim || certOk;
  const recebidos = []; const comandos = [];
  const tratar = (socket, seguro) => {
    let estado = 'cmd'; let atual = { auth: null, dados: '' }; let buffer = '';
    const dizer = (t) => socket.write(`${t}\r\n`);
    const aoLinha = (linha) => {
      if (estado === 'dados') {
        if (linha === '.') { recebidos.push({ ...atual, seguro }); atual = { auth: atual.auth, dados: '' }; estado = 'cmd'; dizer('250 aceito'); } else atual.dados += `${linha}\n`;
        return;
      }
      if (estado === 'login-usuario') { atual.loginUsuario = Buffer.from(linha, 'base64').toString(); estado = 'login-senha'; dizer('334 UGFzc3dvcmQ6'); return; }
      if (estado === 'login-senha') { const s = Buffer.from(linha, 'base64').toString(); atual.auth = { usuario: atual.loginUsuario, senha: s }; estado = 'cmd'; dizer(s === senhaCerta ? '235 ok' : '535 recusado'); return; }
      comandos.push(linha.split(' ')[0].toUpperCase());
      const [verbo, ...resto] = linha.split(' ');
      switch (verbo.toUpperCase()) {
        case 'EHLO': { dizer('250-fake'); if (!semStarttls && modo === 'starttls' && !seguro) dizer('250-STARTTLS'); if (!semAuth) dizer(authLogin ? '250-AUTH LOGIN' : '250-AUTH PLAIN LOGIN'); dizer('250 8BITMIME'); break; }
        case 'STARTTLS': {
          dizer('220 pronto');
          socket.removeAllListeners('data');
          const s = new tls.TLSSocket(socket, { isServer: true, ...credencial });
          tratar(s, true);
          break;
        }
        case 'AUTH': {
          if (resto[0] === 'PLAIN') { const [, u, p] = Buffer.from(resto[1] || '', 'base64').toString().split('\0'); atual.auth = { usuario: u, senha: p }; dizer(p === senhaCerta ? '235 ok' : '535 recusado'); } else { estado = 'login-usuario'; dizer('334 VXNlcm5hbWU6'); }
          break;
        }
        case 'MAIL': atual.mailFrom = resto.join(' '); dizer('250 ok'); break;
        case 'RCPT': atual.rcpt = resto.join(' '); dizer('250 ok'); break;
        case 'DATA': estado = 'dados'; dizer('354 envie'); break;
        case 'QUIT': dizer('221 tchau'); socket.end(); break;
        default: dizer('502 nao'); break;
      }
    };
    socket.on('data', (d) => { buffer += d.toString('utf8'); for (;;) { const i = buffer.indexOf('\r\n'); if (i < 0) break; const l = buffer.slice(0, i); buffer = buffer.slice(i + 2); aoLinha(l); } });
    socket.on('error', () => {});
    if (!seguro || modo === 'tls') { if (modo === 'tls' || !seguro) dizer('220 fake pronto'); }
  };
  const servidor = modo === 'tls' ? tls.createServer(credencial, (s) => { tratar(s, true); }) : net.createServer((s) => tratar(s, false));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const porta = servidor.address().port;
  return {
    porta, recebidos, comandos, ca: certOk.cert, cn,
    /** Ganchos para `sendSmtp({ resolve, connect, secureConnect })`: o host "público" vira o servidor local. */
    ganchos: ({ ca = certOk.cert } = {}) => ({
      resolve: async () => [{ address: '8.8.8.8' }],
      connect: () => net.connect({ host: '127.0.0.1', port: porta }),
      secureConnect: (o) => tls.connect({ ...o, ...(o.socket ? {} : { host: '127.0.0.1', port: porta }), ca }),
    }),
    async fechar() { await new Promise((r) => servidor.close(r)); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

module.exports = { criarServidor };
