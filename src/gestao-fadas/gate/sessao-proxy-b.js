'use strict';

/**
 * Provedor de sessão, primeira versão: PROXY para a API B (suspiro). A B continua sendo a dona do login, do cookie
 * `__Host-gf_session` e da validação; o gate só repassa e, em cada request protegido, pergunta `GET {B}/api/auth/session`
 * com o cookie recebido.
 *
 * Interface `provedorDeSessao` (trocável por uma sessão própria da A no futuro):
 *   validar(req)  -> { status: 'absent' | 'invalid' | 'access-unavailable' | 'unavailable' }
 *                  | { status: 'identity', identity: { userId, displayName, role, tarotId?, expiresAt }, sessionId }
 *   login(req)    -> resposta { status, headers, corpo }      (corpo: string | null, já no formato da B)
 *   logout(req)   -> resposta
 *   sessao(req)   -> resposta                                  (GET /api/auth/session, com `realFeatures`)
 * Origem da B: env `GATE_B_ORIGEM` (ex.: https://gestao.exemplo.com.br). Sem ela, tudo responde 503 no formato B.
 */

const crypto = require('crypto');

/** Nomes de cookie de sessão da B (`sessionCookiePolicy`): produção https e teste em loopback. */
const COOKIES_DA_B = Object.freeze(['__Host-gf_session', 'gf_test_session']);
/** Forma de um token da B (43 caracteres base64url): o que não for isso nem sai da A. */
const TOKEN_B = /^[A-Za-z0-9_-]{43}$/;
const PAPEIS_B = Object.freeze(['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa']);

/** Cookie de sessão do request: `absent` (nenhum), `malformed` (duplicado ou fora da forma) ou o token com seu nome. */
function cookieDaSessao(cabecalho) {
  if (!cabecalho) return { status: 'absent' };
  const achados = [];
  for (const parte of String(cabecalho).split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const nome = parte.slice(0, i).trim();
    if (COOKIES_DA_B.includes(nome)) achados.push({ nome, valor: parte.slice(i + 1).trim() });
  }
  if (!achados.length) return { status: 'absent' };
  if (achados.length > 1 || !TOKEN_B.test(achados[0].valor)) return { status: 'malformed' };
  return { status: 'token', ...achados[0] };
}

/** Só os cookies de sessão da B seguem para a B (os demais cookies da A não saem daqui). */
function soCookiesDaB(cabecalho) {
  return String(cabecalho || '').split(';').map((p) => p.trim()).filter((p) => COOKIES_DA_B.includes(p.slice(0, Math.max(p.indexOf('='), 0)).trim())).join('; ');
}

function criarProvedorProxyB({ origem, fetchImpl, ttlMs = 5000, timeoutMs = 8000, agora = Date.now } = {}) {
  const lerOrigem = () => `${origem || process.env.GATE_B_ORIGEM || ''}`.trim().replace(/\/+$/, '');
  const http = fetchImpl || ((...a) => fetch(...a));
  const cache = new Map(); // sha256(token) -> { ate, valor }; só identidades válidas, por pouco tempo

  async function chamar(caminho, { metodo, cabecalhos, corpo }) {
    const base = lerOrigem();
    if (!base) return null;
    try {
      const r = await http(`${base}${caminho}`, { method: metodo, headers: cabecalhos, body: corpo, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      return { status: r.status, texto: await r.text(), headers: r.headers };
    } catch (_e) {
      return null; // rede fora, DNS, timeout: o chamador responde 503
    }
  }

  /** Resposta da B repassada como está (status, corpo, Set-Cookie, Retry-After, Allow); null = B inalcançável. */
  function repassar(r) {
    if (!r) return null;
    const headers = {};
    const setCookie = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    if (setCookie.length) headers['Set-Cookie'] = setCookie;
    for (const nome of ['Retry-After', 'Allow']) if (r.headers.get(nome)) headers[nome] = r.headers.get(nome);
    return { status: r.status, headers, corpo: r.texto || null };
  }

  const cabecalhosDeEscrita = (req) => {
    const h = { 'content-type': req.headers['content-type'] || 'application/json' };
    if (req.headers.origin) h.origin = req.headers.origin; // a B confere a Origin contra a própria configuração
    const ck = soCookiesDaB(req.headers.cookie);
    if (ck) h.cookie = ck;
    return h;
  };
  const corpoDe = (req) => (Buffer.isBuffer(req.body) ? req.body : req.body && typeof req.body === 'object' ? JSON.stringify(req.body) : undefined);

  async function validar(req) {
    const c = cookieDaSessao(req.headers.cookie);
    if (c.status === 'absent') return { status: 'absent' };
    if (c.status === 'malformed') return { status: 'invalid' };
    const chave = crypto.createHash('sha256').update(c.valor).digest('hex');
    const guardado = cache.get(chave);
    if (guardado && guardado.ate > agora()) return guardado.valor;
    cache.delete(chave);
    const r = await chamar('/api/auth/session', { metodo: 'GET', cabecalhos: { cookie: `${c.nome}=${c.valor}` } });
    if (!r) return { status: 'unavailable' };
    if (r.status === 401) return { status: 'invalid' };
    if (r.status === 403) return { status: 'access-unavailable' };
    let identity = null;
    try { identity = JSON.parse(r.texto).identity; } catch (_e) { /* corpo ilegível: indisponível */ }
    if (r.status !== 200 || !identity || !identity.userId || !PAPEIS_B.includes(identity.role)) return { status: 'unavailable' };
    const valor = { status: 'identity', identity, sessionId: chave.slice(0, 32) };
    if (cache.size >= 500) cache.clear();
    cache.set(chave, { ate: agora() + ttlMs, valor });
    return valor;
  }

  return {
    validar,
    login: async (req) => repassar(await chamar('/api/auth/login', { metodo: 'POST', cabecalhos: cabecalhosDeEscrita(req), corpo: corpoDe(req) })),
    logout: async (req) => {
      const r = repassar(await chamar('/api/auth/logout', { metodo: 'POST', cabecalhos: cabecalhosDeEscrita(req), corpo: corpoDe(req) }));
      const c = cookieDaSessao(req.headers.cookie);
      if (r && c.status === 'token') cache.delete(crypto.createHash('sha256').update(c.valor).digest('hex'));
      return r;
    },
    sessao: async (req) => repassar(await chamar('/api/auth/session', { metodo: 'GET', cabecalhos: soCookiesDaB(req.headers.cookie) ? { cookie: soCookiesDaB(req.headers.cookie) } : {} })),
  };
}

module.exports = { criarProvedorProxyB, cookieDaSessao, COOKIES_DA_B };
