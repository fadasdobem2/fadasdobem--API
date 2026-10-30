'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const { Specialist } = require('../../models');

const DAY_MAP = {
  dom: 0,
  domingo: 0,
  seg: 1,
  segunda: 1,
  ter: 2,
  terça: 2,
  terca: 2,
  qua: 3,
  quarta: 3,
  qui: 4,
  quinta: 4,
  sex: 5,
  sexta: 5,
  sáb: 6,
  sab: 6,
  sábado: 6,
  sabado: 6,
};

function slugify(raw) {
  return `${raw || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

async function ensureUniqueSlug(baseSlug, excludeSpecialistId = null) {
  let slug = slugify(baseSlug) || 'tarologa';
  let suffix = 0;
  for (;;) {
    const candidate = suffix === 0 ? slug : `${slug}-${suffix}`;
    const where = { slug: candidate };
    if (excludeSpecialistId) where.id = { [Op.ne]: excludeSpecialistId };
    const exists = await Specialist.findOne({ where, paranoid: true, attributes: ['id'] });
    if (!exists) return candidate;
    suffix += 1;
    if (suffix > 200) return `${slug}-${Date.now()}`;
  }
}

function generateOnboardingToken() {
  return crypto.randomBytes(24).toString('hex');
}

function generateProvisionalPassword() {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

function parseDayOfWeek(label) {
  const key = `${label || ''}`.trim().toLowerCase();
  return DAY_MAP[key] ?? null;
}

/** Converte agenda mock [{dias, ini, fim}] → slots API {day_of_week, start_time, end_time} */
function agendaMockToScheduleSlots(agenda) {
  if (!Array.isArray(agenda)) return [];
  const rows = [];
  agenda.forEach((block) => {
    if (!block || typeof block !== 'object') return;
    const dias = Array.isArray(block.dias) ? block.dias : [];
    const ini = `${block.ini || block.inicio || ''}`.trim();
    const fim = `${block.fim || block.end || ''}`.trim();
    if (!ini || !fim) return;
    const start = ini.length === 5 ? `${ini}:00` : ini;
    const end = fim.length === 5 ? `${fim}:00` : fim;
    dias.forEach((d) => {
      const dow = parseDayOfWeek(d);
      if (dow == null) return;
      rows.push({ day_of_week: dow, start_time: start, end_time: end, is_active: true });
    });
  });
  return rows;
}

/** "Vídeo · Voz · Chat" → modalidades ENUM */
function parseModalitiesFromCanais(canais) {
  const s = `${canais || ''}`.toLowerCase();
  const out = new Set();
  if (s.includes('chat') || s.includes('texto')) out.add('TEXTO');
  if (s.includes('voz')) out.add('VOZ');
  if (s.includes('vídeo') || s.includes('video')) out.add('VIDEO');
  if (!out.size) {
    out.add('TEXTO');
    out.add('VOZ');
  }
  return [...out];
}

function parsePixType(raw) {
  const s = `${raw || ''}`.trim().toUpperCase();
  const map = {
    EMAIL: 'EMAIL',
    CPF: 'CPF',
    CNPJ: 'CNPJ',
    TELEFONE: 'TELEFONE',
    PHONE: 'TELEFONE',
    EVP: 'EVP',
    ALEATORIA: 'EVP',
    ALEATÓRIA: 'EVP',
  };
  return map[s] || 'EVP';
}

function emptyProc() {
  return {
    obs: [],
    indicadaTaro: '',
    entrevista: { por: '', data: '', impressoes: '' },
    aval: { por: '', data: '', comentarios: '', audios: [], veredito: '' },
  };
}

function emptyOnb() {
  return {
    conviteEnviado: false,
    f2Recebido: false,
    perfilGerado: false,
    emailInstitucional: null,
    foto34: false,
    foto11: false,
    acessoLiberado: false,
    ativado: false,
  };
}

module.exports = {
  slugify,
  ensureUniqueSlug,
  generateOnboardingToken,
  generateProvisionalPassword,
  agendaMockToScheduleSlots,
  parseModalitiesFromCanais,
  parsePixType,
  emptyProc,
  emptyOnb,
};
