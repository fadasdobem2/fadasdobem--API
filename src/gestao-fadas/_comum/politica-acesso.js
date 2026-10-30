'use strict';

/**
 * Política de acesso por perfil do Gestão Fadas. Porte fiel de `features/domain/permissions.ts` (capacidades por
 * perfil) e de `features/auth/real-access.server.ts` (ordem das verificações e auditoria `auth.access.denied`) do
 * suspiro (API B).
 *
 * O que NÃO vem da B: login, sessão e cookie. A API A tem autenticação própria (`auth.middleware`); aqui só se
 * traduz o papel/permissões RBAC da A para um dos 5 perfis da B (`MAPEAMENTO_PERFIL`, o ÚNICO ponto de configuração).
 *
 * As rotas do módulo continuam protegidas por `requirePermission('<chave RBAC>')`. Esta política é a camada de
 * capacidades por perfil (campos sensíveis, histórico completo, exportação...), usada com `exigirCapacidade`.
 */

const AppError = require('../../utils/AppError');

/** Perfis da B (`Role` de features/domain/types.ts). */
const PERFIS = Object.freeze(['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa']);

/** Capacidades, na ordem da B (`RolePermissions`). */
const CAPACIDADES = Object.freeze([
  'canViewConsultations', 'canViewAgenda', 'canViewOwnAgenda', 'canViewSchedules', 'canViewTarologists', 'canViewClients',
  'canCreateClients', 'canViewRecentPayments', 'canViewAllPayments', 'canViewPaymentTotals', 'canViewDailyMinutes',
  'canExportConsultations', 'canManageConsultations', 'canCorrectFinalized', 'canAnnulConsultations',
  'canDecideCancellationPayout', 'canViewClientProfile', 'canEditSchedule', 'canEditProfessionalProfile',
  'canViewDivergences', 'canViewFinancialDivergences', 'canResolveOperationalDivergences',
  'canResolveFinancialDivergences', 'canManagePayouts', 'canManageFinancialValues', 'canViewPriceReference',
  'canReadRealOperations', 'canReadRealClients', 'canExpandRealClientHistory', 'canManagePayoutAgreement',
  'canManagePayoutOpening', 'canRequestCancellationReview',
]);

/** Capacidades do perfil (`permissionsFor` da B). Perfil desconhecido ou nulo: tudo falso. */
function permissoesDoPerfil(perfil) {
  const administrator = perfil === 'administradora';
  const assistant = perfil === 'assistente';
  const supervisor = perfil === 'supervisora';
  const attendant = perfil === 'atendente';
  const tarologist = perfil === 'tarologa';
  const operationalStaff = administrator || assistant || supervisor || attendant;
  const fullPayments = administrator || assistant;

  return {
    canViewConsultations: operationalStaff,
    canViewAgenda: operationalStaff,
    canViewOwnAgenda: tarologist,
    canViewSchedules: operationalStaff,
    canViewTarologists: operationalStaff,
    canViewClients: operationalStaff,
    canCreateClients: operationalStaff,
    canViewRecentPayments: operationalStaff,
    canViewAllPayments: fullPayments,
    canViewPaymentTotals: administrator || assistant,
    canViewDailyMinutes: administrator || assistant || supervisor,
    canExportConsultations: fullPayments,
    canManageConsultations: administrator || assistant || supervisor || attendant,
    canCorrectFinalized: operationalStaff,
    canAnnulConsultations: administrator,
    canDecideCancellationPayout: administrator,
    canViewClientProfile: operationalStaff,
    canEditSchedule: operationalStaff || tarologist,
    canEditProfessionalProfile: administrator || assistant,
    canViewDivergences: operationalStaff,
    canViewFinancialDivergences: fullPayments,
    canResolveOperationalDivergences: operationalStaff,
    canResolveFinancialDivergences: administrator || assistant,
    canManagePayouts: administrator || assistant,
    canManageFinancialValues: administrator || assistant,
    canViewPriceReference: operationalStaff || tarologist,
    canReadRealOperations: fullPayments,
    canReadRealClients: operationalStaff,
    canExpandRealClientHistory: supervisor,
    canManagePayoutAgreement: administrator,
    canManagePayoutOpening: administrator,
    canRequestCancellationReview: fullPayments,
  };
}

/* ------------------------------------------------------------------------------------------------------------ *
 * MAPEAMENTO API A -> perfil da B. ÚNICO objeto de configuração (os clientes e as demais features o reutilizam).
 *
 * DECISÃO (29/10/2026, delegada pelo Patrick; REVISAR com a Nice), tomada a partir da documentação das duas APIs:
 *   - A B tem 5 perfis: administradora, assistente, supervisora, atendente, tarologa. A A tem papéis RBAC por permissão.
 *   - `admin` (papel raiz, `all_access`) é o papel que o seed dá ao usuário de produto GESTORA (a dona, Laya):
 *     = administradora. `gestora` ("Gestão") tem quase todas as permissões do admin: também = administradora.
 *   - "Financeiro é a Assistente" (decisão da Laya, docs/banco/20_Campos_Integracao_v584.md, seção 6): os papéis
 *     `financeiro` e `financeiro_senior` = assistente. A A NÃO tinha um papel com as permissões que as rotas do módulo
 *     exigem (consultas.ver, clientes.*, tarologas.ver, dinheiro.*): foi CRIADO o papel RBAC `assistente`
 *     (src/rbac/rbac.catalog.js) com exatamente essas permissões. `financeiro` continua valendo como perfil
 *     assistente, mas só passa nas rotas se também tiver as permissões da rota.
 *   - `supervisora` = supervisora e `atendente` = atendente (mesmo nome, mesmo propósito).
 *   - `marketing` e `social` não têm relação com a operação: sem perfil (null) = sem acesso a estas rotas.
 *   - Papel de produto (`user.role`), só se nenhum papel RBAC resolveu: GESTORA = administradora; ATENDENTE = atendente.
 *   - Vários papéis: vale o de MAIOR alcance (administradora > assistente > supervisora > atendente).
 *   - Sem perfil mapeado = sem capacidades (nega por padrão; nunca se escolhe perfil "por aproximação").
 * Para mudar a decisão, edite SOMENTE este objeto.
 * ------------------------------------------------------------------------------------------------------------ */
const MAPEAMENTO_PERFIL = Object.freeze({
  /** `req.accessContext.roleIds` (ids de `AccessRole`, ver src/rbac/rbac.catalog.js). */
  papelRbac: Object.freeze({
    admin: 'administradora',
    gestora: 'administradora',
    assistente: 'assistente',
    financeiro: 'assistente',
    financeiro_senior: 'assistente',
    supervisora: 'supervisora',
    atendente: 'atendente',
    marketing: null,
    social: null,
  }),
  /** `req.user.role` (USER_ROLES de src/rbac/rbac.constants.js), usado se nenhum papel RBAC resolveu. */
  papelDeProduto: Object.freeze({
    GESTORA: 'administradora',
    ATENDENTE: 'atendente',
    TAROLOGA: 'tarologa',
    CLIENTE: null,
  }),
  /** Havendo vários papéis, vale o perfil de maior alcance (ordem de PERFIS). */
  prioridade: PERFIS,
});

/** Perfil da B para o request autenticado, ou null (sem correspondência definida = sem capacidades). */
function resolverPerfil(req, mapeamento = MAPEAMENTO_PERFIL) {
  const ids = (req && req.accessContext && Array.isArray(req.accessContext.roleIds) ? req.accessContext.roleIds : [])
    .map((id) => mapeamento.papelRbac[`${id}`])
    .filter(Boolean);
  if (ids.length) return mapeamento.prioridade.find((p) => ids.includes(p)) || null;
  const role = `${(req && req.user && req.user.role) || ''}`.trim().toUpperCase();
  return mapeamento.papelDeProduto[role] || null;
}

/* ------------------------------------------------------------------------------------------------------------ *
 * Guarda (real-access.server.ts). Ordem, cada uma antes da próxima gastar algo: modo -> método -> sessão ->
 * permissão -> parâmetros. Aqui: o módulo ligado (GESTAO_FADAS_ENABLED) e o método GET são do router/Express; a
 * sessão é do `authMiddleware`; esta guarda cobre sessão -> permissão. Os parâmetros são validados DEPOIS dela
 * (validacao.js, no service). Query string, headers e body nunca escolhem perfil nem conta.
 * ------------------------------------------------------------------------------------------------------------ */

/** Códigos que a B soma aos da autenticação (ERRORS), com os mesmos textos de produto. */
const ERROS = Object.freeze({
  INVALID_INPUT: Object.freeze([400, 'Confira o período e a página e tente novamente.']),
  ACCESS_DENIED: Object.freeze([403, 'Esta informação não está disponível para a sua função.']),
  CLIENT_NOT_FOUND: Object.freeze([404, 'Cadastro de cliente não encontrado.']),
});
/** Mesmas recusas numa ESCRITA (WRITE_MESSAGES da B). */
const MENSAGENS_ESCRITA = Object.freeze({
  INVALID_INPUT: 'Confira os dados informados e tente novamente.',
  ACCESS_DENIED: 'Esta ação não está disponível para a sua função.',
  CLIENT_NOT_FOUND: ERROS.CLIENT_NOT_FOUND[1],
});

/** `operationsError` da B, como AppError: o `codigo` vai em `dados`. */
function erroOperacao(codigo, escrita = false) {
  const [status, mensagem] = ERROS[codigo];
  return new AppError(escrita ? MENSAGENS_ESCRITA[codigo] : mensagem, status, { codigo }, true);
}

let registrador = null;

/**
 * Define quem grava a auditoria de negação (A não tem escrita no legado; `gf_auditoria` é somente leitura aqui).
 * `fn(evento)` pode ser async. Sem registrador, a negação é só recusada (a falha em gravar PROPAGA como 503, como na B).
 */
function definirRegistroNegacao(fn) {
  registrador = typeof fn === 'function' ? fn : null;
}

/** Evento `auth.access.denied` (permissionDeniedEvent da B). `motivo`: 'role' (permissão) ou 'scope' (recorte). */
function eventoNegacao(req, capacidade, motivo, perfil) {
  const usuarioId = `${(req.user && req.user.id) || ''}`;
  const sessaoId = `${(req.sessionId || (req.user && req.user.sessionId)) || ''}` || null;
  return {
    acao: 'auth.access.denied',
    resultado: 'denied',
    usuarioId,
    perfil: perfil || null,
    permissao: capacidade,
    motivo,
    sessaoId,
    // Uma linha por sessão e permissão: sondar de novo não pode crescer a tabela de auditoria.
    chave: `auth.access.denied:${motivo}:${capacidade}:${sessaoId || usuarioId}`,
  };
}

async function registrar(evento) {
  if (!registrador) return;
  try {
    await registrador(evento);
  } catch (_e) {
    // Negação que não pôde ser registrada nunca passa como autorizada: 503 (a B responde SERVICE_UNAVAILABLE).
    throw new AppError('Serviço indisponível no momento. Tente novamente.', 503, { codigo: 'SERVICE_UNAVAILABLE' });
  }
}

/**
 * Middleware: sessão -> permissão do perfil. Sem sessão 401; perfil sem a capacidade 403 ACCESS_DENIED com o seu
 * `auth.access.denied` (motivo `role`).
 */
function exigirCapacidade(capacidade, { escrita = false, mapeamento = MAPEAMENTO_PERFIL } = {}) {
  if (!CAPACIDADES.includes(capacidade)) throw new Error(`Capacidade desconhecida: ${capacidade}`);
  return async (req, _res, next) => {
    try {
      if (!(req.user && req.user.id)) throw new AppError('Sessão inválida.', 401, null, true);
      const perfil = resolverPerfil(req, mapeamento);
      if (perfil && permissoesDoPerfil(perfil)[capacidade]) return next();
      await registrar(eventoNegacao(req, capacidade, 'role', perfil));
      throw erroOperacao('ACCESS_DENIED', escrita);
    } catch (err) {
      return next(err instanceof AppError ? err : new AppError('Acesso negado.', 403, null, true));
    }
  };
}

/**
 * `refuseScope` da B: o perfil TEM a permissão mas pediu um recorte/busca fora da sua política (Clientes, R19).
 * 403 ACCESS_DENIED como a falta de permissão, com o evento de motivo `scope`. Lança.
 */
async function negarEscopo(req, capacidade) {
  await registrar(eventoNegacao(req, capacidade, 'scope', resolverPerfil(req)));
  throw erroOperacao('ACCESS_DENIED');
}

module.exports = {
  PERFIS, CAPACIDADES, MAPEAMENTO_PERFIL, ERROS, MENSAGENS_ESCRITA,
  permissoesDoPerfil, permissionsFor: permissoesDoPerfil,
  resolverPerfil, exigirCapacidade, negarEscopo, erroOperacao, definirRegistroNegacao, eventoNegacao,
};
