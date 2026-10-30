'use strict';

/**
 * Helpers compartilhados de candidaturas de oraculistas: localização de
 * candidata, guarda de estado final e verificação de disponibilidade de e-mail.
 */
const { Op } = require('sequelize');
const { User, SpecialistCandidate } = require('../../models');
const AppError = require('../../utils/AppError');
const { normalizeEmail } = require('../auth/auth.constants');

const FINAL_ESTADOS = new Set(['reprovada', 'arquivada']);

async function findCandidateOrThrow(id, options = {}) {
  const row = await SpecialistCandidate.findByPk(id, {
    paranoid: true,
    ...options,
  });
  if (!row) throw new AppError('Candidata não encontrada.', 404, null, true);
  return row;
}

function assertNotFinal(candidate) {
  if (FINAL_ESTADOS.has(candidate.estado)) {
    throw new AppError('Candidatura encerrada — reabra antes de editar.', 409, null, true);
  }
}

async function assertEmailAvailable(email, excludeCandidateId = null) {
  const mail = normalizeEmail(email);
  if (!mail) return;
  const userExists = await User.findOne({ where: { email: mail }, attributes: ['id'] });
  if (userExists) {
    throw new AppError('Este e-mail já pertence a uma conta.', 409, null, true);
  }
  const where = {
    email: mail,
    estado: { [Op.notIn]: ['reprovada', 'arquivada'] },
  };
  if (excludeCandidateId) where.id = { [Op.ne]: excludeCandidateId };
  const dup = await SpecialistCandidate.findOne({ where, attributes: ['id'] });
  if (dup) {
    throw new AppError('Já existe candidatura activa com este e-mail.', 409, null, true);
  }
}

module.exports = { FINAL_ESTADOS, findCandidateOrThrow, assertNotFinal, assertEmailAvailable };
