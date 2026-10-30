'use strict';

/**
 * Constantes e helpers compartilhados do fluxo de recuperação/merge de contas.
 */

function httpCtxNormalize(httpCtx = {}) {
  return {
    ip: httpCtx.ip,
    user_agent: httpCtx.user_agent,
    correlation_id: httpCtx.correlation_id,
  };
}

const VALID_STAGES = ['PENDING_REVIEW', 'IDENTITY_CHECK', 'MERGING', 'MERGED', 'REJECTED', 'CANCELLED'];

// Transições permitidas pelo admin (não pode regredir nem pular etapas críticas)
const ALLOWED_TRANSITIONS = {
  PENDING_REVIEW: ['IDENTITY_CHECK', 'REJECTED', 'CANCELLED'],
  IDENTITY_CHECK: ['MERGING', 'REJECTED', 'CANCELLED'],
  MERGING: ['MERGED', 'REJECTED', 'CANCELLED'],
  MERGED: [],
  REJECTED: [],
  CANCELLED: [],
};

module.exports = { httpCtxNormalize, VALID_STAGES, ALLOWED_TRANSITIONS };
