'use strict';

/** A ficha: projeção por perfil e leitoras da cliente (fatia de clientes.model.js). */

const { buildRealConsultationsCut } = require('./helpers/consultas');
const { reconcileReceipts } = require('./helpers/recebimentos');
const { localOperationalDateKey } = require('./helpers/valores');
const { canViewCivilIdentity, canViewFullRegistration, clientRolePolicy, permissionsFor } = require('./helpers/perfis');
const { WHOLE_HISTORY, newestFirst } = require('./clientes.model.comum');
const { readRealClientRow } = require('./clientes.model.cadastro');

/** Partes da ficha aprovada sem fonte (FR-050). Login e senha pertencem aos dados adicionais. */
const PROFILE_NOT_INTEGRATED = ['login', 'password', 'modality', 'consultationSettings', 'registrationSource', 'contactHistory',
  'notes', 'restrictions', 'bonuses', 'cancellations', 'account', 'occurrences'];
const ADDITIONAL_NOT_INTEGRATED = new Set(['login', 'password']);
const ADDITIONAL_ISSUES = new Set(['birthTime']);

/** Consultas de uma cliente como a tela Consultas as lê (R4, D10), a mais nova primeiro. Linha de outra cliente fica fora. */
function clientConsultations(clientId, rows, nowLocal) {
  const own = rows.filter((row) => row.clientId === clientId);
  const cut = buildRealConsultationsCut({ rows: own, range: WHOLE_HISTORY, nowLocal });
  return { own, items: [...cut.inProgress, ...cut.finished].sort(newestFirst) };
}

const clientReceipts = (clientId, sources) => reconcileReceipts(sources).filter((item) => item.clientId === clientId);

/** Cada leitora do par, da história inteira qualquer que seja o alcance do perfil (v398), a relação mais recente primeiro. */
function tarologistsOf(newestFirstItems) {
  const byTarot = new Map();
  for (const item of newestFirstItems) {
    // Consulta sem data (A4a) conta para a leitora; sem data, a última relação fica '' (a tela só ordena por ela).
    if (item.tarotId === null || (item.startedAtLocal === null && !item.undatedStart)) continue;
    // Só os minutos de consulta finalizada são somados, como nos totais de Consultas (D10).
    const minutes = item.situation === 'finalizada' ? item.recordedMinutes ?? 0 : 0;
    const seen = byTarot.get(item.tarotId);
    if (seen) { seen.consultations += 1; seen.recordedMinutes += minutes; }
    else byTarot.set(item.tarotId, { tarotId: item.tarotId, tarotName: item.tarotName, consultations: 1, recordedMinutes: minutes, lastStartedAtLocal: item.startedAtLocal ?? '' });
  }
  return [...byTarot.values()];
}

function projectProfile(record, role) {
  const full = canViewFullRegistration(role);
  const civil = canViewCivilIdentity(role); // A2: nome completo, CPF e nascimento só de quem a regra do perfil libera
  return {
    id: record.id, name: record.name, nameMissing: record.name === null, treatAs: record.treatAs, fullName: civil ? record.fullName : null,
    phones: full ? record.phones : { home: record.phones.home },
    whatsapp: record.whatsapp, email: record.email, cpf: civil ? record.cpf : null, birthDate: civil ? record.birthDate : null,
    createdAtLocal: record.createdAtLocal, linkedValidId: record.linkedValidId,
    ...(full ? {
      email2: record.email2, cpfStatus: record.cpfStatus, cpfResult: record.cpfResult, birthTime: record.birthTime,
      birthCity: record.birthCity, birthState: record.birthState, birthCountry: record.birthCountry, address: record.address,
    } : {}),
    ...(clientRolePolicy(role).canSeeBalance ? { oldBalance: record.oldBalance } : {}),
    notIntegrated: PROFILE_NOT_INTEGRATED.filter((part) => full || !ADDITIONAL_NOT_INTEGRATED.has(part)),
    // A pendência de um campo que não vem também não vem.
    issues: record.issues.filter((issue) => full || !ADDITIONAL_ISSUES.has(issue.field)).map((issue) => issue.message),
  };
}

/**
 * A ficha, ou null quando a linha não é cliente (404 CLIENT_NOT_FOUND, igual a um ID desconhecido) ou o perfil não lê.
 * `input` = { role, nowLocal, row, consultations, receipts, catalogos? }.
 */
function buildRealClientProfile(input) {
  if (!permissionsFor(input.role).canReadRealClients) return null;
  const record = readRealClientRow(input.row, input.catalogos);
  if (!record) return null;
  const today = localOperationalDateKey(input.nowLocal);
  const { items } = clientConsultations(record.id, input.consultations, input.nowLocal);
  return {
    today, client: projectProfile(record, input.role),
    current: items.find((item) => item.situation === 'em-curso' && item.operationalDate === today) ?? null,
    tarologists: tarologistsOf(items),
    // A v608 mostra os contadores das abas só à administradora; o servidor não os manda a mais ninguém.
    ...(input.role === 'administradora' ? { counts: { consultations: items.length, receipts: clientReceipts(record.id, input.receipts).length } } : {}),
  };
}

module.exports = {
  buildRealClientProfile,
  clientConsultations,
  clientReceipts,
  projectProfile,
};
