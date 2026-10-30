'use strict';

/**
 * Tabela de PERMISSÕES POR ROTA (Maturacao/44, matriz do doc 40 seção 2): para cada rota, a capacidade de `permissions.ts` com que o front
 * mostra ou esconde a ação (ou "so-administradora", que o front decide pela aba de Configurações). `propria`: a taróloga também age, mas só no
 * `tarotId` dela (o front a limita ao próprio perfil). O teste (`verificar-gf-regras-b.js`) chama a rota REAL pelo gate, com sessão de cada perfil,
 * e exige 403 em todo perfil que o front esconde; nenhum perfil pode ter MAIS acesso que o do front.
 */

const ADM = 'so-administradora';
const C = (metodo, caminho, cap, extra = {}) => ({ metodo, caminho, cap, ...extra });

module.exports = [
  C('GET', '/agenda', 'canViewAgenda'), C('POST', '/agenda', 'canManageConsultations'), C('PATCH', '/agenda/ag-1', 'canManageConsultations'),
  C('POST', '/agenda/ag-1/contact', 'canManageConsultations'), C('POST', '/agenda/ag-1/refund-request', 'canManageConsultations'), C('POST', '/agenda/ag-1/observations', 'canManageConsultations'),
  C('POST', '/agenda/ag-1/departures', 'canManageConsultations'), C('POST', '/agenda/ag-1/requested-wait', 'canManageConsultations'), C('POST', '/agenda/ag-1/resolution', 'canManageConsultations'),
  C('POST', '/agenda/ag-1/route-general', 'canManageConsultations'), C('POST', '/agenda/ag-1/reservation/release', 'canManageConsultations'), C('POST', '/agenda/queues/osiris/order', 'canManageConsultations'),
  C('GET', '/agenda/admissions', 'canViewAgenda'), C('POST', '/agenda/admissions', 'canManageConsultations'), C('GET', '/agenda/requests', 'canViewAgenda'),
  C('POST', '/agenda/requests', 'canViewOwnAgenda'), C('POST', '/agenda/requests/r-1/resolve', 'canManageConsultations'),
  C('GET', '/schedules', 'canViewSchedules', { propria: true }), C('PUT', '/schedules/osiris/overrides', 'canEditSchedule', { propria: 'osiris' }), C('PUT', '/schedules/osiris/weekly', 'canEditSchedule', { propria: 'osiris' }),
  C('DELETE', '/schedules/osiris/overrides/osiris@2026-11-10', 'canEditSchedule', { propria: 'osiris' }),
  C('GET', '/presence', 'canViewAgenda', { propria: true }), C('POST', '/presence/osiris/status', 'canManageConsultations', { propria: 'osiris' }),
  C('POST', '/presence/osiris/confirm', 'canManageConsultations', { propria: 'osiris' }), C('POST', '/presence/osiris/request', 'so-tarologa', { propria: 'osiris' }), C('POST', '/presence/osiris/activity', 'so-tarologa', { propria: 'osiris' }),
  C('GET', '/catalog/tarologists', 'canViewTarologists', { propria: true }), C('PUT', '/catalog/tarologists/osiris/profile', 'canEditProfessionalProfile', { propria: 'osiris' }),
  C('PUT', '/catalog/tarologists/osiris/account', ADM), C('GET', '/catalog/clients', 'canViewClients'), C('PATCH', '/catalog/clients/12345', 'canViewClients'),
  C('GET', '/accounts', ADM), C('POST', '/accounts', ADM), C('PATCH', '/accounts/11111111-1111-4111-8111-111111111111', ADM), C('POST', '/accounts/11111111-1111-4111-8111-111111111111/password', ADM),
  C('POST', '/accounts/11111111-1111-4111-8111-111111111111/active', ADM), C('PUT', '/welcome', ADM),
  C('GET', '/payments', 'canViewRecentPayments'), C('GET', '/payments/accounts', 'canViewRecentPayments'), C('POST', '/payments', 'canManageConsultations'), C('POST', '/payments/benefits', 'canManageConsultations'),
  C('POST', '/payments/p-1/revise', 'canManageConsultations'), C('POST', '/pricing/versions', 'canManageFinancialValues'), C('PUT', '/restrictions/r-1', 'canManageConsultations', { propria: true }),
  C('PUT', '/client-guidance', 'canViewClients'), C('PUT', '/client-notes', 'canViewClients'), C('GET', '/pending-routing', 'canViewConsultations'), C('PUT', '/pending-routing', 'canViewConsultations'),
  C('PUT', '/notes/n-1', 'canManageConsultations', { propria: true }), C('GET', '/operations/consultations', 'canReadRealOperations'), C('GET', '/operations/receipts', 'canReadRealOperations'),
  C('GET', '/operations/tarologists', 'canReadRealOperations'),
  C('POST', '/payouts/agreements/osiris/commission', 'canManagePayoutAgreement'), C('POST', '/payouts/openings', 'canManagePayoutOpening'),
  C('POST', '/consultations', 'canManageConsultations'), C('POST', '/consultations/c-1/revise', 'canManageConsultations'),
];
module.exports.ADM = ADM;
