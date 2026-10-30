'use strict';

/** Estados do funil — espelho do mock frontend G20a */
const ESTADOS = Object.freeze([
  'nova',
  'em_analise',
  'aprovada',
  'em_onboarding',
  'reprovada',
  'arquivada',
]);

const TRIAGENS = Object.freeze(['pendente', 'em_espera']);

/** Colunas do kanban admin */
const FUNNEL_COLUMNS = Object.freeze([
  { key: 'nova', match: (c) => c.estado === 'nova' && c.triagem !== 'em_espera' },
  { key: 'em_analise', match: (c) => c.estado === 'em_analise' },
  { key: 'aprovada', match: (c) => c.estado === 'aprovada' },
  { key: 'em_onboarding', match: (c) => c.estado === 'em_onboarding' },
  { key: 'em_espera', match: (c) => c.estado === 'nova' && c.triagem === 'em_espera' },
  {
    key: 'historico',
    match: (c) => c.estado === 'reprovada' || c.estado === 'arquivada',
  },
]);

const ONBOARDING_TOKEN_TTL_DAYS = 14;
const ACCESS_LINK_TTL_HOURS = 72;

const DEFAULT_PROC = Object.freeze({
  obs: [],
  indicadaTaro: '',
  entrevista: { por: '', data: '', impressoes: '' },
  aval: { por: '', data: '', comentarios: '', audios: [], veredito: '' },
});

const DEFAULT_ONB = Object.freeze({
  conviteEnviado: false,
  f2Recebido: false,
  perfilGerado: false,
  emailInstitucional: null,
  foto34: false,
  foto11: false,
  acessoLiberado: false,
  ativado: false,
});

module.exports = {
  ESTADOS,
  TRIAGENS,
  FUNNEL_COLUMNS,
  ONBOARDING_TOKEN_TTL_DAYS,
  ACCESS_LINK_TTL_HOURS,
  DEFAULT_PROC,
  DEFAULT_ONB,
};
