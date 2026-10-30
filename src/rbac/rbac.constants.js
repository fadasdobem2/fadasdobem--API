'use strict';

/** Níveis de sensibilidade (spec g33c). */
const NIVEL_CRIT = [
  'clientes.listar',
  'consultas.cancelar_cobranca',
  'dinheiro.saldo_total',
  'dinheiro.faturamento',
  'dinheiro.folha',
  'papeis.editar',
  'papeis.excluir',
  'usuarios.excluir',
  'ajustes.integracoes',
  'auditoria.ver',
];

const NIVEL_ALTO = [
  'consultas.encerrar',
  'consultas.ajustar_tempo',
  'consultas.bonus',
  'dinheiro.estornar',
  'dinheiro.aprovar_estorno',
  'dinheiro.pagar_tarologas',
  'dinheiro.pagamentos',
  'dinheiro.precos',
  'dinheiro.conciliar',
  'dinheiro.nf',
  'clientes.bloquear',
  'clientes.juntar',
  'clientes.cpf_completo',
  'clientes.historico_completo',
  'tarologas.comissao',
  'usuarios.criar',
  'usuarios.editar',
  'papeis.criar',
  'conteudo.newsletter',
];

const NIVEL_MEDIO = [
  'clientes.editar',
  'consultas.trocar',
  'chat.rapidas_time',
  'chat.rapidas_aprovar',
  'chat.ver_grupo',
  'tarologas.ativar',
  'tarologas.aprovar_cand',
  'tarologas.editar',
  'conteudo.publicar',
  'ajustes.regras',
  'ajustes.bot',
  'agenda.editar',
  'dinheiro.recebimentos',
  'relatorios.producao',
];

/**
 * Papéis de PRODUTO (`user.role`) — FONTE ÚNICA de verdade.
 * O ENUM da coluna `users.role` (model User) deriva daqui, e os guards de rota
 * (`requireUserRole`) referenciam estas constantes em vez de strings mágicas.
 */
const USER_ROLES = Object.freeze({
  CLIENTE: 'CLIENTE',
  TAROLOGA: 'TAROLOGA',
  GESTORA: 'GESTORA',
  ATENDENTE: 'ATENDENTE',
});

/** Lista canónica (ordem estável) — usada no ENUM do model User. */
const USER_ROLE_VALUES = Object.values(USER_ROLES);

/** Subconjunto interno (back-office) derivado da fonte única. */
const STAFF_ROLES = new Set([USER_ROLES.GESTORA, USER_ROLES.ATENDENTE]);

const ROOT_ROLE_ID = 'admin';

const PROTECTED_SYSTEM_ROLES = new Set(['admin']);

/** Permissões que o último admin nunca pode perder (spec §4). */
const ROOT_SAFE_PERMISSIONS = ['papeis.editar', 'usuarios.editar', 'auditoria.ver'];

/** Step-up obrigatório: crítico + historico_completo (spec §8). */
function requiresStepUp(chave) {
  const key = `${chave || ''}`.trim();
  if (key === 'clientes.historico_completo') return true;
  return nivelDe(key) === 'critico';
}

function requiresMotivo(chave) {
  const n = nivelDe(chave);
  return n === 'alto' || n === 'critico';
}

function nivelDe(chave) {
  if (NIVEL_CRIT.includes(chave)) return 'critico';
  if (NIVEL_ALTO.includes(chave)) return 'alto';
  if (NIVEL_MEDIO.includes(chave)) return 'medio';
  return 'baixo';
}

function nivelRank(nivel) {
  const map = { baixo: 1, medio: 2, alto: 3, critico: 4 };
  return map[nivel] || 1;
}

function isDepartmentEligible(nivel) {
  return nivel === 'baixo' || nivel === 'medio';
}

module.exports = {
  NIVEL_CRIT,
  NIVEL_ALTO,
  NIVEL_MEDIO,
  USER_ROLES,
  USER_ROLE_VALUES,
  STAFF_ROLES,
  ROOT_ROLE_ID,
  PROTECTED_SYSTEM_ROLES,
  ROOT_SAFE_PERMISSIONS,
  requiresStepUp,
  requiresMotivo,
  nivelDe,
  nivelRank,
  isDepartmentEligible,
};
