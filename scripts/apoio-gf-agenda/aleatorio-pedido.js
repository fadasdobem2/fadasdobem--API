'use strict';

/** Dados fictícios e determinísticos para o ouro do pedido de agendamento (v706). Nada real. */
let semente = 20261107;
const alea = () => { semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0; return semente / 4294967296; };
const sorteio = (l) => l[Math.floor(alea() * l.length)];
const chance = (p) => alea() < p;
const iso = (ms) => new Date(ms).toISOString();
const soma = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const FONES = ['+5511987654321', '11 98765-4321', '(21) 3456-7890', '+55 11 98765-4321', '5511987654321', '0011987654321', '+351912345678', '+1 415 555 0132', '11111111111', '1234', '', 'abc', '+5511999999999', '011 98765-4321', '+441234567890'];
const IDS = ['', ' ', '900001', '900002', '900003', '900004'];

function item(extra = {}) {
  return {
    id: `ag-${Math.floor(alea() * 1e5)}`, tarotId: sorteio(['osiris', 'nyx']), clientId: '900001', client: 'Ana', date: '2026-11-09', time: '10:00', channel: 'WhatsApp Áudio', position: 1,
    response: 'Aguardando resposta', contact: { attempt: 1, date: '2026-11-09', tags: chance(0.15) ? [sorteio(['Cancelada', 'Concluída', 'Avisada'])] : [] }, ...extra,
  };
}
function contato(i, extra = {}) {
  return {
    id: `lead-${i}`, name: sorteio(['Ana', 'Bia', 'Carla']), whatsapp: sorteio(FONES), source: 'staff', referral: chance(0.3), createdAt: iso(Date.parse('2026-11-01T10:00:00Z') + i * 3600000),
    classification: sorteio(['lead', 'lead', 'identification_pending', 'client']), history: [], ...(chance(0.15) ? { clientId: sorteio(['900001', '900002']) } : {}),
    ...(chance(0.2) ? { displayCode: sorteio(['IL 0001', 'IC 0007', 'IL 0012', 'il 3']) } : {}), ...(chance(0.15) ? { archived: true, archiveReason: 'x' } : {}), ...extra,
  };
}
function pedido(i, extra = {}) {
  const base = {
    id: `rq-${i}`, tarotId: sorteio(['osiris', 'nyx']), clientId: chance(0.5) ? sorteio(['900001', '900002']) : '', client: sorteio(['Ana', 'Bia', '']), date: sorteio(['2026-11-09', '2026-11-10']),
    at: '2026-11-08T12:00:00.000Z', note: chance(0.1) ? 'Exemplo de demonstração: pedido de consulta informado por Osíris.' : 'nota', ...(chance(0.6) ? { contactId: `lead-${Math.floor(alea() * 4)}` } : {}),
    ...(chance(0.5) ? { stage: sorteio(['ask', 'asked', 'confirmed', 'descheduled']) } : {}), ...(chance(0.5) ? { submittedIdentity: { clientId: sorteio(IDS), name: sorteio(['Ana', '', 'Bia']), whatsapp: sorteio(FONES) } } : {}),
    ...(chance(0.2) ? { agendaId: 'ag-1' } : {}), ...(chance(0.2) ? { referral: true } : {}), ...(chance(0.2) ? { readerInquiry: sorteio(['ask_reader', 'asked_reader', 'not_located']) } : {}),
    ...(chance(0.15) ? { identityNotFound: true } : {}), ...(chance(0.3) ? { requestedTime: sorteio(['10:00', '21:30']) } : {}), ...(chance(0.3) ? { channel: 'PABX', requestedMinutes: 30 } : {}),
    ...(chance(0.3) ? { queuePlacement: { beforeAgendaId: sorteio(['a1', 'a2', 'zz', undefined]), afterAgendaId: sorteio(['a1', 'a3', undefined]), order: Math.floor(alea() * 5) } } : {}),
  };
  return { ...base, ...extra };
}
module.exports = { alea, sorteio, chance, iso, soma, FONES, IDS, item, contato, pedido };
