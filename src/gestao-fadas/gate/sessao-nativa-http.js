'use strict';

/**
 * Peças HTTP do provedor de sessão NATIVO (sessao-nativa.js), no formato da B (`features/auth/auth-http.server.ts`):
 * resposta `{status, headers, corpo}` com o erro `{error:{code,message}}`, Origin/JSON/tamanho do corpo, cookies da A
 * montados sem tocar no `res` e o limite de tentativas do login reaproveitado da A. Nada aqui fala com banco.
 */

const cookieLib = require('cookie');
const { ERROS } = require('./http');

const LIMITE_CORPO = 16 * 1024; // BODY_LIMIT_BYTES da B
const PROIBIDOS = /[\p{Cc}\p{Cf}\p{Cs}]/u; // controle, formato (largura zero, bidi) e surrogate solto, como a B

/** Resposta de sucesso (JSON) ou sem corpo, sempre `no-store` (o gate também força). */
const ok = (status, corpo, headers = {}) => ({ status, headers, corpo: corpo === null ? null : JSON.stringify(corpo) });

/** Resposta de erro da B. */
function erro(codigo, headers = {}) {
  const [status, message] = ERROS[codigo];
  return { status, headers, corpo: JSON.stringify({ error: { code: codigo, message } }) };
}

/** `FADAS_ORIGIN` como a B: a origem permitida, exata. Ausente = configuração quebrada (503), nunca "aceita tudo". */
function origemPermitida(env = process.env) {
  const v = `${env.FADAS_ORIGIN || ''}`.trim();
  return v || null;
}

/**
 * Regras de escrita da B, na ordem dela: Origin -> mídia JSON -> tamanho -> JSON. Devolve `{corpo}` ou `{resposta}`.
 * O corpo pode vir como Buffer (lido pelo gate) ou como objeto (se um `express.json` já rodou).
 */
function aceitarEscrita(req, env = process.env) {
  const permitida = origemPermitida(env);
  if (!permitida) return { resposta: erro('SERVICE_UNAVAILABLE') };
  if (req.headers.origin !== permitida) return { resposta: erro('ORIGIN_NOT_ALLOWED') };
  const tipo = `${req.headers['content-type'] || ''}`.split(';')[0].trim().toLowerCase();
  if (tipo !== 'application/json') return { resposta: erro('UNSUPPORTED_MEDIA_TYPE') };
  const b = req.body;
  if (Buffer.isBuffer(b)) {
    if (b.length > LIMITE_CORPO) return { resposta: erro('PAYLOAD_TOO_LARGE') };
    try { return { corpo: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)) }; } catch (_e) { return { resposta: erro('INVALID_INPUT') }; }
  }
  if (b && typeof b === 'object') return { corpo: b };
  return { resposta: erro('INVALID_INPUT') };
}

/** `{identifier, password}` exatos (`loginSchema` da B: sem chaves extras). Devolve `{identifier, password}` ou null. */
function lerLogin(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return null;
  const chaves = Object.keys(corpo);
  if (chaves.length !== 2 || !chaves.includes('identifier') || !chaves.includes('password')) return null;
  const { identifier, password } = corpo;
  if (typeof identifier !== 'string' || typeof password !== 'string') return null;
  const id = identifier.trim().normalize('NFC');
  if (!id || Array.from(id).length > 254 || PROIBIDOS.test(id)) return null;
  if (Array.from(password).length > 128 || Buffer.byteLength(password) > 512) return null;
  return { identifier: id, password };
}

/** Logout da B: o corpo é exatamente `{}`. */
const logoutValido = (corpo) => Boolean(corpo) && typeof corpo === 'object' && !Array.isArray(corpo) && Object.keys(corpo).length === 0;

/** Cookie pelo nome: `req.cookies` (cookie-parser) ou o cabeçalho. `null` = ausente; `''` = duplicado/ilegível. */
function lerCookie(req, nome) {
  const h = req.headers && req.headers.cookie;
  if (typeof h === 'string' && h) {
    const achados = h.split(';').map((p) => p.trim()).filter((p) => p.slice(0, Math.max(p.indexOf('='), 0)).trim() === nome);
    if (!achados.length) return null;
    if (achados.length > 1) return '';
    try { return cookieLib.parse(achados[0])[nome] || ''; } catch (_e) { return ''; }
  }
  return req.cookies && typeof req.cookies[nome] === 'string' ? req.cookies[nome] : null;
}

/** "res" mínimo que só anota os `Set-Cookie` que os helpers da A (`setAuthCookies`/`clearAuthCookies`) escreveriam. */
function gravadorDeCookies() {
  const linhas = [];
  const escrever = (nome, valor, op) => {
    const o = { ...op };
    if (o.maxAge !== undefined) { o.expires = new Date(Date.now() + o.maxAge); o.maxAge = Math.floor(o.maxAge / 1000); }
    linhas.push(cookieLib.serialize(nome, `${valor}`, o));
  };
  return {
    linhas,
    cookie: escrever,
    clearCookie: (nome, op) => { const { maxAge, expires, ...resto } = op || {}; linhas.push(cookieLib.serialize(nome, '', { ...resto, expires: new Date(1), maxAge: 0 })); },
  };
}

/**
 * Limite de tentativas do login da A (`loginRegisterIpLimiter` + `loginEmailLimiter`, mesmos contadores/Redis). Os
 * limitadores leem `req.body.email`; aqui lhes damos um request derivado com o identificador nesse campo.
 * Devolve `{limitado:false}` ou `{limitado:true, retryAfter}`.
 */
function limitarComLimitadores(limitadores) {
  return async (req, identifier) => {
    const derivado = Object.create(req, { body: { value: { email: identifier } } });
    for (const mw of limitadores) {
      const r = await new Promise((resolve) => {
        const res = {
          statusCode: 200, headersSent: false, locals: {},
          setHeader() { return this; }, getHeader() { return undefined; }, set() { return this; }, append() { return this; }, removeHeader() {},
          status(c) { this.statusCode = c; return this; },
          json(b) { resolve({ limitado: true, retryAfter: Number(b && b.dados && b.dados.retry_after_seconds) || 900 }); return this; },
          end() { resolve({ limitado: true, retryAfter: 900 }); },
        };
        try { Promise.resolve(mw(derivado, res, (e) => resolve(e ? { falha: true } : { limitado: false }))).catch(() => resolve({ falha: true })); } catch (_e) { resolve({ falha: true }); }
      });
      if (r.falha) throw new Error('limitador indisponível');
      if (r.limitado) return r;
    }
    return { limitado: false };
  };
}

module.exports = { ok, erro, origemPermitida, aceitarEscrita, lerLogin, logoutValido, lerCookie, gravadorDeCookies, limitarComLimitadores };
