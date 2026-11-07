'use strict';

/**
 * Perfis (funções) do Clientes da B e o MAPEAMENTO dos papéis RBAC da API A para eles.
 *
 * Porta de: features/domain/permissions.ts (só canReadRealClients e canExpandRealClientHistory),
 * features/clientes/client-workspace-model.ts (clientRolePolicy, clientListRange) e
 * features/clientes/client-profile-model.ts (canViewFullRegistration).
 *
 * ------------------------------------------------------------------------------------------------------------
 * MAPEAMENTO PAPEL-DA-A -> PERFIL-DA-B: NÃO é definido aqui. Vem do ÚNICO objeto `MAPEAMENTO_PERFIL` de
 * `src/gestao-fadas/_comum/politica-acesso.js` (decisão e justificativa estão lá). Aqui só se deriva o formato que as
 * funções deste módulo usam (`papelParaPerfil` e `precedencia`).
 * ------------------------------------------------------------------------------------------------------------
 */

const { MAPEAMENTO_PERFIL } = require('../../../_comum/politica-acesso');
const { DATAS_POR_FUNCAO } = require('../../../_comum/dominio/cliente-lista-datas');

const PERFIS = Object.freeze(['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa']);

const CONFIGURACAO_PERFIS = Object.freeze({
  papelParaPerfil: MAPEAMENTO_PERFIL.papelRbac,
  precedencia: Object.freeze(['administradora', 'assistente', 'supervisora', 'atendente']),
});

/** Perfil da B para os ids de papel RBAC do usuário, ou null quando nenhum papel está mapeado. */
function perfilDeClientes(roleIds, configuracao = CONFIGURACAO_PERFIS) {
  const perfis = new Set();
  for (const id of roleIds || []) {
    const perfil = configuracao.papelParaPerfil[`${id}`];
    if (perfil) perfis.add(perfil);
  }
  return configuracao.precedencia.find((p) => perfis.has(p)) ?? null;
}

const permissionsFor = (role) => ({
  canReadRealClients: ['administradora', 'assistente', 'supervisora', 'atendente'].includes(role),
  canExpandRealClientHistory: role === 'supervisora',
});

/**
 * Identidade civil da cliente (nome completo, CPF e nascimento) por perfil (onda 1, A2). A API é a AUTORIDADE: o recorte é feito aqui, no servidor, com a regra que
 * o front aplica HOJE e que a tela já mostra (`clientListDisplayName`, `canUseClientProfile`, `basicRegistrationFields`): os quatro perfis de equipe veem
 * (administradora, assistente, supervisora, atendente) e a taróloga não (nem chega: `canReadRealClients` é falso e a rota responde 403). Perfil desconhecido: nada.
 * Mudar quem vê = mudar SÓ esta tabela (decisão da Nice, CLIENTES-12); lista, ficha e históricos leem daqui.
 */
const IDENTIDADE_CIVIL_POR_PERFIL = Object.freeze({ administradora: true, assistente: true, supervisora: true, atendente: true, tarologa: false });
const canViewCivilIdentity = (role) => IDENTIDADE_CIVIL_POR_PERFIL[role] === true;

const canViewFullRegistration = (role) => role === 'administradora' || role === 'assistente';

const clientRolePolicy = (role) => ({
  canSearchDetails: role !== 'assistente' && role !== 'tarologa',
  canSeeBalance: role === 'assistente' || role === 'administradora',
  canSeeDateCounts: role === 'administradora',
  dates: DATAS_POR_FUNCAO(role),
  pageSize: role === 'administradora' ? 50 : role === 'atendente' ? 20 : 30,
});

module.exports = { CONFIGURACAO_PERFIS, IDENTIDADE_CIVIL_POR_PERFIL, PERFIS, canViewCivilIdentity, canViewFullRegistration, clientRolePolicy, perfilDeClientes, permissionsFor };
