'use strict';

const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { JobApplication } = require('../../../models');
const AppError = require('../../../utils/AppError');
const { persistAdminAuditLog } = require('../helpers/adminAudit.helper');
const {
  httpCtxNormalize,
  initialsFromName,
  formatRelativeDate,
} = require('./admin.access.shared');

/**
 * Funil de candidatos internos (g34 · Usuários › Candidatos).
 *
 * Persistência: reutiliza `JobApplication` (mesma origem das candidaturas do
 * site) e guarda o workflow do funil em `meta` (JSONB) — sem migração:
 *   meta.origem            'formulário' | 'indicação'
 *   meta.funnel            { etapa, estado } — os dois eixos do front
 *   meta.proc              { obs: string[], entrevista: { por, data, impressoes } }
 *   meta.onb               objeto de admissão/onboarding (ver ensureOnb no front)
 *   meta.avatar_*          gradiente/iniciais do avatar
 *   meta.created_user_id   id do utilizador interno gerado na conversão
 *
 * A coluna `estado` (enum) é mantida em sincronia para compatibilidade com o
 * painel público de candidaturas e com os índices existentes.
 */

const STAFF_CATEGORIES = new Set(['atendimento', 'outras_areas', 'financeiro', 'marketing', 'conteudo']);
const DEFAULT_CATEGORIA = 'outras_areas';

// eixo "coluna do funil" (rail/andamento) — inclui admissão (pós-aprovação)
const FUNNEL_ETAPAS = ['novo', 'analise', 'aprovado', 'admissao'];
// eixo "ciclo de vida" — sobrepõe a coluna quando terminal
const FUNNEL_ESTADOS = ['ativo', 'reprovado', 'arquivado', 'contratado'];

const CONTRACTS_SUBDIR = 'staff-contracts';
const CONTRACTS_DIR = path.join(process.cwd(), 'uploads', CONTRACTS_SUBDIR);
const CONTRACT_ALLOWED_EXT = new Set(['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg']);
const CONTRACT_MAX_BYTES = 10 * 1024 * 1024;

function defaultProc() {
  return { obs: [], entrevista: { por: '', data: '', impressoes: '' } };
}

/** Etapa do front → estado (enum) do JobApplication. */
function etapaToColumnEstado(etapa) {
  if (etapa === 'analise') return 'em_analise';
  if (etapa === 'aprovado' || etapa === 'admissao') return 'aprovado';
  return 'novo';
}

/** Estado (enum) legado → etapa do front (para linhas sem meta.funnel). */
function columnEstadoToEtapa(estado) {
  if (estado === 'em_analise') return 'analise';
  if (estado === 'aprovado') return 'aprovado';
  if (estado === 'reprovado' || estado === 'arquivado') return 'analise';
  return 'novo';
}

/** Deriva { etapa, estado } (os dois eixos do front) a partir da linha. */
function readFunnel(plain) {
  const meta = plain.meta || {};
  const f = meta.funnel || {};
  let etapa = FUNNEL_ETAPAS.includes(f.etapa) ? f.etapa : null;
  let estado = FUNNEL_ESTADOS.includes(f.estado) ? f.estado : null;
  if (!etapa) etapa = columnEstadoToEtapa(plain.estado);
  if (!estado) {
    if (plain.estado === 'reprovado') estado = 'reprovado';
    else if (plain.estado === 'arquivado') estado = 'arquivado';
    else estado = 'ativo';
  }
  return { etapa, estado };
}

/** { etapa, estado } do front → estado (enum) a persistir na coluna. */
function funnelToColumnEstado(funnel) {
  if (funnel.estado === 'reprovado') return 'reprovado';
  if (funnel.estado === 'arquivado') return 'arquivado';
  // 'ativo' e 'contratado' acompanham a coluna do funil
  return etapaToColumnEstado(funnel.etapa);
}

/** Merge profundo (objetos mesclam; arrays e escalares substituem). */
function deepMerge(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const key of Object.keys(patch)) {
    const val = patch[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      out[key] = deepMerge(out[key], val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

function candidateToFront(row) {
  const plain = row.get ? row.get({ plain: true }) : row;
  const payload = plain.payload || {};
  const meta = plain.meta || {};
  const { etapa, estado } = readFunnel(plain);
  const nome = plain.nome_completo || '';

  const out = {
    id: plain.id,
    nome,
    ini: meta.avatar_initials || initialsFromName(nome),
    g: meta.avatar_gradient || 'linear-gradient(135deg,#d9cec2,#8a7866)',
    emailPessoal: plain.email || '',
    whats: plain.whatsapp || '',
    vaga: plain.cargo_desejado || '',
    origem: meta.origem || 'formulário',
    quando: formatRelativeDate(plain.chegou_em),
    criadoEm: plain.chegou_em,
    etapa,
    estado,
    razao: plain.razao || '',
    cidade: plain.cidade || '',
    nasc: payload.nasc || payload.data_nascimento || '',
    linkedin: plain.linkedin || '',
    comoConheceu: plain.como_chegou || '',
    disp: payload.disp || payload.disponibilidade || '',
    pretensao: payload.pretensao || '',
    inicio: payload.inicio || '',
    exp: payload.experiencia || plain.apresentacao || '',
    motivacao: payload.motivacao || '',
    obs: payload.obs || '',
  };

  if (meta.proc && typeof meta.proc === 'object') out.proc = meta.proc;
  if (meta.onb && typeof meta.onb === 'object') out.onb = meta.onb;
  if (meta.created_user_id) out.usuarioId = meta.created_user_id;
  return out;
}

async function findCandidateOrThrow(id) {
  const row = await JobApplication.findByPk(id);
  if (!row) throw new AppError('Candidato não encontrado.', 404, null, true);
  return row;
}

async function listStaffCandidates(query = {}) {
  const rows = await JobApplication.findAll({
    where: { categoria: { [Op.in]: [...STAFF_CATEGORIES] } },
    order: [['chegou_em', 'DESC']],
    limit: Math.min(Number(query.limit) || 300, 500),
  });

  let items = rows.map(candidateToFront);

  const etapa = `${query.etapa || ''}`.trim();
  if (etapa && FUNNEL_ETAPAS.includes(etapa)) {
    items = items.filter((c) => c.etapa === etapa);
  }
  const estado = `${query.estado || ''}`.trim();
  if (estado && FUNNEL_ESTADOS.includes(estado)) {
    items = items.filter((c) => c.estado === estado);
  }
  return items;
}

async function getStaffCandidate(id) {
  const row = await findCandidateOrThrow(id);
  return candidateToFront(row);
}

/** Cadastro manual (indicação) — g34 "Cadastrar por indicação". */
async function createStaffCandidate(actorId, body = {}, httpCtx = {}) {
  const nome = `${body.nome || ''}`.trim();
  if (!nome) throw new AppError('Informe o nome do candidato.', 400, null, true);

  const row = await JobApplication.create({
    categoria: STAFF_CATEGORIES.has(`${body.categoria}`) ? body.categoria : DEFAULT_CATEGORIA,
    nome_completo: nome,
    email: `${body.emailPessoal || body.email || ''}`.trim().toLowerCase(),
    whatsapp: `${body.whats || body.whatsapp || ''}`.trim() || null,
    cidade: `${body.cidade || ''}`.trim() || null,
    cargo_desejado: `${body.vaga || 'Atendente'}`.trim(),
    linkedin: `${body.linkedin || ''}`.trim() || null,
    como_chegou: `${body.comoConheceu || ''}`.trim() || null,
    apresentacao: `${body.exp || ''}`.trim() || null,
    area_interesse: [],
    payload: {
      nasc: body.nasc || '',
      disp: body.disp || '',
      pretensao: body.pretensao || '',
      inicio: body.inicio || '',
      motivacao: body.motivacao || '',
      experiencia: body.exp || '',
      obs: body.obs || 'Cadastrado por indicação',
    },
    meta: {
      origem: body.origem || 'indicação',
      funnel: { etapa: 'novo', estado: 'ativo' },
      avatar_initials: initialsFromName(nome),
      avatar_gradient: body.g || 'linear-gradient(135deg,#d9cec2,#8a7866)',
    },
    estado: 'novo',
  });

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_STAFF_CANDIDATE_CREATE',
    target_entity: 'JobApplication',
    target_id: row.id,
    new_value: { nome, origem: body.origem || 'indicação' },
    httpCtx: httpCtxNormalize(httpCtx),
  });

  return candidateToFront(row);
}

/**
 * Update flexível — serve todas as mutações do funil/admissão do front:
 * etapa/estado/razão (decisão), campos base, e merge profundo de `proc`/`onb`.
 */
async function updateStaffCandidate(actorId, id, body = {}, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  const plain = row.get({ plain: true });

  const meta = { ...(plain.meta || {}) };
  const payload = { ...(plain.payload || {}) };
  const updates = {};

  if (body.nome != null) updates.nome_completo = `${body.nome}`.trim();
  if (body.emailPessoal != null) updates.email = `${body.emailPessoal}`.trim().toLowerCase();
  if (body.whats != null) updates.whatsapp = `${body.whats}`.trim() || null;
  if (body.vaga != null) updates.cargo_desejado = `${body.vaga}`.trim() || null;
  if (body.cidade != null) updates.cidade = `${body.cidade}`.trim() || null;
  if (body.linkedin != null) updates.linkedin = `${body.linkedin}`.trim() || null;
  if (body.comoConheceu != null) updates.como_chegou = `${body.comoConheceu}`.trim() || null;
  if (body.exp != null) {
    updates.apresentacao = `${body.exp}`;
    payload.experiencia = `${body.exp}`;
  }
  for (const f of ['nasc', 'disp', 'pretensao', 'inicio', 'motivacao', 'obs']) {
    if (body[f] != null) payload[f] = body[f];
  }

  const funnel = readFunnel(plain);
  if (body.etapa != null) {
    const e = `${body.etapa}`.trim();
    if (FUNNEL_ETAPAS.includes(e)) funnel.etapa = e;
  }
  if (body.estado != null) {
    const s = `${body.estado}`.trim();
    if (FUNNEL_ESTADOS.includes(s)) funnel.estado = s;
  }
  meta.funnel = funnel;
  updates.estado = funnelToColumnEstado(funnel);
  if (['aprovado', 'reprovado', 'arquivado'].includes(updates.estado)) {
    updates.decidida_em = new Date();
  }

  if (body.razao != null) updates.razao = `${body.razao}`.trim() || null;

  if (body.proc != null && typeof body.proc === 'object') {
    meta.proc = deepMerge(meta.proc || defaultProc(), body.proc);
  }
  if (body.onb != null && typeof body.onb === 'object') {
    meta.onb = deepMerge(meta.onb || {}, body.onb);
  }
  if (body.g != null) meta.avatar_gradient = `${body.g}`;

  updates.meta = meta;
  updates.payload = payload;

  await row.update(updates);

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_STAFF_CANDIDATE_UPDATE',
    target_entity: 'JobApplication',
    target_id: id,
    old_value: { estado: plain.estado, funnel: (plain.meta || {}).funnel || null },
    new_value: { estado: updates.estado, funnel: meta.funnel, razao: updates.razao },
    httpCtx: httpCtxNormalize(httpCtx),
  });

  return candidateToFront(row);
}

/** Inicia a análise/entrevista (etapa → analise, cria bloco de processo). */
async function startAnalysis(actorId, id, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  const meta = { ...(row.meta || {}) };
  if (!meta.proc) meta.proc = defaultProc();
  meta.funnel = { ...(readFunnel(row.get({ plain: true }))), etapa: 'analise' };
  await row.update({ meta, estado: 'em_analise' });
  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_STAFF_CANDIDATE_START_ANALYSIS',
    target_entity: 'JobApplication',
    target_id: id,
    httpCtx: httpCtxNormalize(httpCtx),
  });
  return candidateToFront(row);
}

async function addObservation(actorId, id, texto, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  const v = `${texto || ''}`.trim();
  if (!v) throw new AppError('Observação vazia.', 400, null, true);

  const meta = { ...(row.meta || {}) };
  const proc = meta.proc && typeof meta.proc === 'object' ? { ...meta.proc } : defaultProc();
  proc.obs = Array.isArray(proc.obs) ? [...proc.obs, v] : [v];
  meta.proc = proc;
  await row.update({ meta });

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_STAFF_CANDIDATE_OBS_ADD',
    target_entity: 'JobApplication',
    target_id: id,
    new_value: { texto: v },
    httpCtx: httpCtxNormalize(httpCtx),
  });
  return candidateToFront(row);
}

async function removeObservation(actorId, id, index, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  const i = Number(index);
  const meta = { ...(row.meta || {}) };
  const proc = meta.proc && typeof meta.proc === 'object' ? { ...meta.proc } : defaultProc();
  const obs = Array.isArray(proc.obs) ? [...proc.obs] : [];
  if (!Number.isInteger(i) || i < 0 || i >= obs.length) {
    throw new AppError('Observação não encontrada.', 404, null, true);
  }
  obs.splice(i, 1);
  proc.obs = obs;
  meta.proc = proc;
  await row.update({ meta });

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_STAFF_CANDIDATE_OBS_REMOVE',
    target_entity: 'JobApplication',
    target_id: id,
    old_value: { index: i },
    httpCtx: httpCtxNormalize(httpCtx),
  });
  return candidateToFront(row);
}

function persistContractFile(candidateId, body = {}) {
  const url = `${body.url || body.file_url || ''}`.trim();
  if (url) {
    return { arquivo: url, nome: body.file_name || body.filename || url.split('/').pop() };
  }

  const base64Raw = body.base64 || body.file_base64 || body.content_base64;
  if (!base64Raw) {
    throw new AppError('Envie o arquivo do contrato (base64 ou url).', 400, null, true);
  }

  const ext = `${body.ext || 'pdf'}`.replace(/^\./, '').toLowerCase();
  if (!CONTRACT_ALLOWED_EXT.has(ext)) {
    throw new AppError('Formato inválido — use PDF, DOC, DOCX, PNG ou JPG.', 400, null, true);
  }

  const buf = Buffer.from(`${base64Raw}`, 'base64');
  if (!buf.length) throw new AppError('Arquivo do contrato inválido.', 400, null, true);
  if (buf.length > CONTRACT_MAX_BYTES) {
    throw new AppError('Contrato excede 10 MB.', 400, null, true);
  }

  fs.mkdirSync(CONTRACTS_DIR, { recursive: true });
  const rawName = `${body.file_name || body.filename || ''}`.trim() || `contrato_${candidateId.slice(0, 8)}_${Date.now()}.${ext}`;
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
  fs.writeFileSync(path.join(CONTRACTS_DIR, safeName), buf);

  return { arquivo: `/uploads/${CONTRACTS_SUBDIR}/${safeName}`, nome: safeName };
}

async function setContract(actorId, id, body = {}, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  const stored = persistContractFile(id, body);

  const meta = { ...(row.meta || {}) };
  const onb = { ...(meta.onb || {}) };
  onb.contratoArquivo = stored.arquivo;
  onb.contratoNome = stored.nome;
  meta.onb = onb;
  await row.update({ meta });

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_STAFF_CANDIDATE_CONTRACT_SET',
    target_entity: 'JobApplication',
    target_id: id,
    new_value: { arquivo: stored.arquivo },
    httpCtx: httpCtxNormalize(httpCtx),
  });
  return candidateToFront(row);
}

async function removeContract(actorId, id, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  const meta = { ...(row.meta || {}) };
  const onb = { ...(meta.onb || {}) };
  onb.contratoArquivo = '';
  onb.contratoNome = '';
  meta.onb = onb;
  await row.update({ meta });

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_STAFF_CANDIDATE_CONTRACT_REMOVE',
    target_entity: 'JobApplication',
    target_id: id,
    httpCtx: httpCtxNormalize(httpCtx),
  });
  return candidateToFront(row);
}

/**
 * Converte o candidato em utilizador interno (staff).
 * - Fluxo simples (aprovado): cria a conta com convite de 1º acesso.
 * - Fluxo de admissão: usa os dados de `onb` (endereço, recebimento, contrato).
 * Marca o candidato como `contratado` e guarda o id do utilizador criado.
 */
async function convertToStaff(actorId, id, body = {}, httpCtx = {}) {
  // eslint-disable-next-line global-require
  const accessService = require('./admin.access.service');
  const row = await findCandidateOrThrow(id);
  const plain = row.get({ plain: true });
  const front = candidateToFront(row);
  const onb = (plain.meta || {}).onb || {};
  const dados = onb.dados || {};
  const receb = onb.receb || {};
  const contrato = onb.contrato || {};

  if (front.estado === 'contratado') {
    throw new AppError('Candidato já foi convertido em utilizador.', 409, null, true);
  }

  const email = `${body.email || onb.emailInst || front.emailPessoal || ''}`.trim();
  if (!email) {
    throw new AppError('Informe o e-mail institucional para criar o acesso.', 400, null, true);
  }

  const staffBody = {
    email,
    nome: body.nome || front.nome,
    role: body.role || body.user_role || 'ATENDENTE',
    papeis: body.papeis || body.role_ids || [],
    department_id: body.department_id || body.setorId || null,
    job_title_id: body.job_title_id || body.cargoId || null,
    g: front.g,
    avatar_initials: front.ini,
    emailPessoal: front.emailPessoal,
    whats: front.whats,
    cpf: dados.cpf || null,
    nasc: dados.nasc || front.nasc || null,
    cep: dados.cep || '',
    rua: dados.rua || '',
    num: dados.num || '',
    compl: dados.compl || '',
    bairro: dados.bairro || '',
    cidade: dados.cidade || front.cidade || '',
    uf: dados.uf || '',
    pixTipo: receb.pixTipo || '',
    pixChave: receb.pixChave || '',
    banco: receb.banco || '',
    ag: receb.ag || '',
    conta: receb.conta || '',
    vinculo: contrato.vinculo || null,
    ...body.staff,
  };

  const staff = await accessService.createStaff(actorId, staffBody, httpCtx);

  const meta = { ...(plain.meta || {}) };
  meta.funnel = { ...(readFunnel(plain)), estado: 'contratado' };
  meta.created_user_id = staff.id;
  if (meta.onb) meta.onb = { ...meta.onb, acessoLiberado: true };
  await row.update({ meta });

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_STAFF_CANDIDATE_CONVERT',
    target_entity: 'JobApplication',
    target_id: id,
    new_value: { user_id: staff.id, email },
    httpCtx: httpCtxNormalize(httpCtx),
  });

  return { staff, candidate: candidateToFront(row) };
}

module.exports = {
  listStaffCandidates,
  getStaffCandidate,
  createStaffCandidate,
  updateStaffCandidate,
  startAnalysis,
  addObservation,
  removeObservation,
  setContract,
  removeContract,
  convertToStaff,
  candidateToFront,
};
