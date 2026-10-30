'use strict';

/**
 * Provedor de sessão NATIVO: o login do sistema é o da API A. Mesma interface do proxy (`sessao-proxy-b.js`):
 *   validar(req) | login(req) | logout(req) | sessao(req)
 * Reaproveita a autenticação existente da A (src/features/auth): `auth.service.login` (senha bcrypt, auditoria,
 * emissão do par JWT), `auth.cookies.helper` (cookies `__Secure-fdb_*`), `auth.tokens.service` (revogação do refresh) e
 * os limitadores de tentativa da rota de login. Não reescreve regra de senha nem de token. O front continua falando o
 * contrato da B (`/api/auth/*`), com o CSRF da A substituído pela regra da B (Origin == `FADAS_ORIGIN` + JSON).
 *
 * Como a conta da A vira perfil da B: papéis RBAC (`loadUserAccessContext`) + `MAPEAMENTO_PERFIL`/`resolverPerfil`
 * (_comum/politica-acesso.js). Sem perfil mapeado: 403 ACCOUNT_ACCESS_UNAVAILABLE, e a sessão recém-emitida é revogada.
 *
 * DECISÕES (documentadas, ver README do módulo):
 *  - RENOVAÇÃO: o cookie de refresh da A tem `Path=/api/v1/auth`, então NÃO chega em `/api/auth/*`. Sem ele o gate não
 *    pode renovar; access expirado = 401 SESSION_INVALID (o front manda entrar de novo). Para sessão mais longa,
 *    aumente `JWT_EXPIRES_IN` (a B vive 8 h). Não se mexe no path do refresh para não ampliar a superfície dele.
 *  - LOGIN: o 403 de conta inativa/bloqueada da A sai ANTES da checagem de senha; aqui vira INVALID_CREDENTIALS
 *    (nunca revela que o usuário existe). O identificador aceito é o e-mail da A.
 *  - LOGOUT: sem o refresh no request, revoga TODOS os refresh do usuário (sai de todos os dispositivos da A).
 *  - CONTA ASSINANTE das gravações: ver `resolverContaAssinante` (pendência: vínculo A <-> gf_auth_accounts).
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { jwtVerifyOptions } = require('../../config/auth.config');
const { ACCESS_COOKIE, REFRESH_COOKIE, setAuthCookies, clearAuthCookies } = require('../../features/auth/auth.cookies.helper');
const { resolverPerfil, MAPEAMENTO_PERFIL } = require('../_comum/politica-acesso');
const { payoutsLigado } = require('./payouts-off');
const { horariosLigado } = require('./rotas-horarios');
const { agendaLigada } = require('./rotas-agenda');
const { consultaLigada } = require('./rotas-consulta');
const { presencaLigada } = require('./rotas-presenca');
const { cadastrosLigado, clientesLigado } = require('./rotas-cadastros');
const { precosLigado, pagamentosLigado, restricoesLigado } = require('./rotas-financeiro');
const { contasLigado } = require('./rotas-contas');
const { configLigado } = require('./rotas-config');
const { recadosLigado } = require('./rotas-recados');
const { divergenciasLigado } = require('./rotas-divergencias');
const { pendenciasLigado } = require('./rotas-pendencias');
const { fichaLigada } = require('./rotas-ficha');
const { estadoFinanceiroLigado } = require('./rotas-estado-financeiro');

/** Painel (Maturacao/29 seção 11): fontes e relógio do servidor. Só anuncia com `GF_FATIA_PAINEL=true` (a tela ainda exige as outras fatias). */
const painelLigado = (env = process.env) => `${env.GF_FATIA_PAINEL || ''}`.trim().toLowerCase() === 'true';
const { novosDadosNoPostgres } = require('../novo/modo');
const { ok, erro, aceitarEscrita, lerLogin, logoutValido, lerCookie, gravadorDeCookies, limitarComLimitadores } = require('./sessao-nativa-http');

/**
 * Conta que assina as gravações (`req.user.gfContaId`). No modo `postgres` é o `users.id` da A. No modo `mysql`, PENDÊNCIA: na A não existe o vínculo
 * usuário da A <-> `gf_auth_accounts`. Enquanto isso, conta de serviço por env `GESTAO_FADAS_ESCRITA_CONTA_ID`;
 * sem ela, `null` (a gravação deve recusar). Nunca se escreve em `gf_auth_*` daqui.
 */
function resolverContaAssinante(usuarioA, env = process.env) {
  // Banco novo (GF_NOVOS_DADOS=postgres, padrão): quem assina é o próprio usuário da A; não há conta de serviço.
  if (novosDadosNoPostgres(env)) return usuarioA && usuarioA.id ? String(usuarioA.id) : null;
  const v = `${env.GESTAO_FADAS_ESCRITA_CONTA_ID || ''}`.trim();
  return v || null;
}

/** Dependências reais, carregadas só no primeiro uso (o teste offline injeta as suas e não toca em banco). */
function servicosPadrao() {
  const { User, RefreshToken, Specialist } = require('../../models');
  const { Op } = require('sequelize');
  const authService = require('../../features/auth/auth.service');
  const tokens = require('../../features/auth/auth.tokens.service');
  const { loadUserAccessContext } = require('../../rbac/authorization.service');
  const rl = require('../../middlewares/rateLimit.middleware');
  return {
    login: authService.login,
    buscarUsuario: (id) => User.findByPk(id),
    // Identidade da taróloga: o `slug` do Specialist da conta é o `tarotId` do front (as contas de teste usam o mesmo slug do mock).
    buscarTarotId: async (userId) => {
      const e = await Specialist.findOne({ where: { user_id: userId }, attributes: ['slug'] });
      const slug = e && e.slug ? String(e.slug) : undefined;
      if (!slug || !cadastrosLigado()) return slug;
      // Fatia Cadastros: a conta ligada a um tarólogo do catálogo (`gf_tarologos_perfil.conta_slug`) usa o id do catálogo (o do legado) em tudo.
      try {
        const p = await require('../novo/leitura').modelosNovos().GfTarologosPerfil.findOne({ where: { conta_slug: slug }, attributes: ['tarot_id'] });
        return p ? String(p.tarot_id) : slug;
      } catch (_e) { return slug; }
    },
    // O access é um JWT sem estado: depois do logout (refresh revogado) ele não pode continuar valendo.
    temSessaoViva: async (id) => (await RefreshToken.count({ where: { user_id: id, revoked_at: null, expires_at: { [Op.gt]: new Date() } } })) > 0,
    carregarContexto: loadUserAccessContext,
    revogarPorJti: tokens.revokeRefreshByJti,
    revogarTodos: tokens.revokeAllRefreshTokensForUser,
    limitar: limitarComLimitadores([rl.loginRegisterIpLimiter, rl.loginEmailLimiter]),
  };
}

const sha = (texto) => crypto.createHash('sha256').update(texto).digest('hex');
const iso = (segundos) => new Date(segundos * 1000).toISOString();

function criarProvedorNativo({ servicos, env = process.env } = {}) {
  let s = servicos || null;
  const svc = () => { if (!s) s = servicosPadrao(); return s; };

  /** `{status:'ok', payload}` | `{status:'absent'|'invalid'}`: mesma verificação do `authMiddleware` (cookie de access). */
  function lerAccess(req, { ignorarExpiracao = false } = {}) {
    const bruto = lerCookie(req, ACCESS_COOKIE);
    if (bruto === null) return { status: 'absent' };
    if (!bruto || !bruto.trim()) return { status: 'invalid' };
    try {
      const payload = jwt.verify(bruto.trim(), process.env.JWT_SECRET, { ...jwtVerifyOptions(), ignoreExpiration: ignorarExpiracao });
      return payload.token_use === 'access' && payload.sub ? { status: 'ok', payload } : { status: 'invalid' };
    } catch (_e) {
      return { status: 'invalid' };
    }
  }

  /** Perfil da B para o usuário da A, ou null. */
  async function perfilDe(usuario) {
    const ctx = await svc().carregarContexto(usuario.id);
    const roleIds = (ctx && ctx.roleIds) || [];
    // O papel de produto (`users.role`) só vale quando a conta NÃO tem papel RBAC. Quem tem papel RBAC sem perfil na B
    // (marketing, social) não pode virar "atendente" só porque `users.role` é ATENDENTE (achado do ensaio real).
    const perfil = resolverPerfil({ accessContext: { roleIds }, user: { role: roleIds.length ? '' : usuario.role } }, MAPEAMENTO_PERFIL);
    const nome = ctx && ctx.staffProfile && ctx.staffProfile.display_name;
    // `tarotId` só para a taróloga (o gate repassa para `req.user.tarotId`); sem Specialist com slug ela segue sem identidade operacional.
    const tarotId = perfil === 'tarologa' && svc().buscarTarotId ? await svc().buscarTarotId(usuario.id) : undefined;
    return { perfil, displayName: `${nome || usuario.email || usuario.id}`.slice(0, 200), tarotId };
  }

  const identidade = (usuario, perfil, displayName, exp, tarotId) => ({
    userId: String(usuario.id), displayName, role: perfil, ...(tarotId ? { tarotId } : {}), expiresAt: iso(exp),
  });

  async function validar(req) {
    try {
      const a = lerAccess(req);
      if (a.status !== 'ok') return { status: a.status };
      const { payload } = a;
      if (payload.account_type === 'temp') return { status: 'access-unavailable' }; // conta temporária não opera o sistema
      const usuario = await svc().buscarUsuario(payload.sub);
      if (!usuario) return { status: 'invalid' };
      if (!usuario.is_active || usuario.blocked_at) return { status: 'access-unavailable' };
      if (svc().temSessaoViva && !(await svc().temSessaoViva(usuario.id))) return { status: 'invalid' };
      const { perfil, displayName, tarotId } = await perfilDe(usuario);
      if (!perfil) return { status: 'access-unavailable' };
      const sessionId = sha(`gf-sessao:${payload.sub}:${payload.iat}:${payload.exp}`).slice(0, 32); // estável, nunca o token
      const identity = { ...identidade(usuario, perfil, displayName, payload.exp, tarotId), gfContaId: resolverContaAssinante(usuario, env) };
      return { status: 'identity', identity, sessionId };
    } catch (_e) {
      return { status: 'unavailable' };
    }
  }

  /** O que o front recebe: sem campos internos (`gfContaId`). */
  const publico = ({ userId, displayName, role, tarotId, expiresAt }) => ({ userId, displayName, role, ...(tarotId ? { tarotId } : {}), expiresAt });

  async function sessao(req) {
    const r = await validar(req);
    if (r.status === 'absent') return erro('SESSION_REQUIRED');
    if (r.status === 'invalid') return erro('SESSION_INVALID');
    if (r.status === 'access-unavailable') return erro('ACCOUNT_ACCESS_UNAVAILABLE');
    if (r.status !== 'identity') return erro('SERVICE_UNAVAILABLE');
    return ok(200, { identity: publico(r.identity), realFeatures: { payouts: payoutsLigado(env), ...(horariosLigado(env) ? { schedules: true } : {}), ...(agendaLigada(env) ? { agenda: true } : {}), ...(presencaLigada(env) ? { presence: true } : {}), ...(consultaLigada(env) ? { consultation: true } : {}), ...(cadastrosLigado(env) ? { cadastros: true } : {}), ...(precosLigado(env) ? { pricing: true } : {}), ...(pagamentosLigado(env) ? { payments: true } : {}), ...(restricoesLigado(env) ? { restrictions: true } : {}), ...(recadosLigado(env) ? { notes: true } : {}), ...(divergenciasLigado(env) ? { divergences: true } : {}), ...(pendenciasLigado(env) ? { pending: true } : {}), ...(contasLigado(env) ? { accounts: true } : {}), ...(configLigado(env) ? { config: true } : {}), ...(painelLigado(env) ? { panel: true } : {}), ...(clientesLigado(env) ? { clients: true } : {}), ...(fichaLigada(env) ? { clientFile: true } : {}), ...(estadoFinanceiroLigado(env) ? { financialState: true } : {}) } });
  }

  async function login(req) {
    const aceito = aceitarEscrita(req, env);
    if (aceito.resposta) return aceito.resposta;
    const entrada = lerLogin(aceito.corpo);
    if (!entrada) return erro('INVALID_INPUT');
    try {
      const lim = await svc().limitar(req, entrada.identifier);
      if (lim.limitado) return erro('TRY_LATER', { 'Retry-After': String(lim.retryAfter) });
    } catch (_e) {
      return erro('SERVICE_UNAVAILABLE');
    }
    let dados;
    try {
      dados = await svc().login({ email: entrada.identifier, password: entrada.password }, { ip: req.ip, userAgent: req.headers['user-agent'] });
    } catch (e) {
      const st = e && e.statusCode;
      // 400 (não é e-mail), 401 (senha) e 403 (conta inativa/bloqueada, que a A checa antes da senha): mesma resposta.
      if (st === 400 || st === 401 || st === 403) return erro('INVALID_CREDENTIALS');
      return erro('SERVICE_UNAVAILABLE');
    }
    // A A já emitiu e gravou o refresh: se não houver acesso, revoga ANTES de responder e não devolve cookie nenhum.
    const negar = async () => {
      try {
        const j = jwt.decode(dados.refresh_token);
        if (j && j.jti) await svc().revogarPorJti(j.jti);
        return erro('ACCOUNT_ACCESS_UNAVAILABLE');
      } catch (_e) { return erro('SERVICE_UNAVAILABLE'); }
    };
    try {
      const acc = jwt.decode(dados.access_token);
      if (!acc || acc.account_type === 'temp') return await negar();
      const usuario = await svc().buscarUsuario(acc.sub);
      if (!usuario) return await negar();
      const { perfil, displayName, tarotId } = await perfilDe(usuario);
      if (!perfil) return await negar();
      const grav = gravadorDeCookies();
      setAuthCookies(grav, dados);
      return ok(200, { identity: identidade(usuario, perfil, displayName, acc.exp, tarotId) }, { 'Set-Cookie': grav.linhas });
    } catch (_e) {
      return erro('SERVICE_UNAVAILABLE');
    }
  }

  async function logout(req) {
    const aceito = aceitarEscrita(req, env);
    if (aceito.resposta) return aceito.resposta;
    if (!logoutValido(aceito.corpo)) return erro('INVALID_INPUT');
    try {
      const a = lerAccess(req, { ignorarExpiracao: true }); // sessão vencida também pode ser encerrada
      let sub = a.status === 'ok' ? `${a.payload.sub}` : null;
      let jti = null;
      const refresh = lerCookie(req, REFRESH_COOKIE);
      if (refresh) {
        try {
          const p = jwt.verify(refresh, process.env.JWT_REFRESH_SECRET, jwtVerifyOptions());
          if (p.token_use === 'refresh' && p.jti && (!sub || `${p.sub}` === sub)) { sub = `${p.sub}`; jti = p.jti; }
        } catch (_e) { /* refresh inválido: cai no revogar todos se houver access */ }
      }
      if (jti) await svc().revogarPorJti(jti);
      else if (sub) await svc().revogarTodos(sub);
      const grav = gravadorDeCookies();
      clearAuthCookies(grav);
      return ok(204, null, { 'Set-Cookie': grav.linhas });
    } catch (_e) {
      return erro('SERVICE_UNAVAILABLE'); // não confirmou: nenhum cookie é tocado, para o retry funcionar
    }
  }

  return { validar, login, logout, sessao };
}

module.exports = { criarProvedorNativo, resolverContaAssinante, servicosPadrao };
