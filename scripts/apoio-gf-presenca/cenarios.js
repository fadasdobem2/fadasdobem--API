'use strict';

/**
 * Cenários de ouro da Presença: a MESMA lista alimenta o gerador (`scripts/gerar-ouro-gf-presenca.js`, que roda o código real do
 * front: `presence-confirmation-model.ts`, `staff-presence-model.ts`, `presence-return-forecast.ts`) e o verificador
 * (`scripts/verificar-gf-presenca.js`, que roda o porte do servidor). Cada cenário traz as entradas do FRONT (`front`) e as
 * entradas equivalentes do SERVIDOR (`api`), que difere só na forma (o servidor recebe a declaração de turno, não a escolha).
 * Tudo fictício; datas de 2026-11-04 (quarta) e 2026-11-05 (quinta), relógio de São Paulo (-03:00).
 */

const sp = (hhmm, dia = '2026-11-04') => Date.parse(`${dia}T${hhmm}:00-03:00`);
const iso = (ms) => new Date(ms).toISOString();
const DATA = '2026-11-04';
const MIN = 60_000;

const perfil = (extra = {}) => ({
  id: 'osiris', name: 'Osíris', official: [], today: '', note: '', status: 'Disponível', online: true, weeklySchedule: { quarta: '9h às 15h', quinta: '10h às 18h' },
  shiftStatus: 'Disponível', presenceDate: DATA, presenceConfirmedAt: iso(sp('08:50')), shiftAvailableSince: iso(sp('08:50')), presenceHistory: [], ...extra,
});
const offline = (extra = {}) => perfil({ shiftStatus: 'Offline', online: false, shiftAvailableSince: undefined, presenceConfirmedAt: undefined, ...extra });
const excecao = (extra = {}) => ({ todayHours: '9h às 12h', periods: [{ start: '09:00', end: '12:00' }], note: '', updatedAt: '2026-11-03T10:00:00', absenceType: 'Nenhuma', startDate: DATA, endDate: DATA, ...extra });
const ator = { id: 'u-1', name: 'Osíris' };
const SEM = { emAndamento: false, terminos: [] };
const EM_CURSO = { emAndamento: true, terminos: [] };
const consultaFront = [{ id: 'c1', tarotId: 'osiris', status: 'Em curso', awaitingTarologistStart: false, tarologistStartedAt: iso(sp('15:00')) }];

const avancar = (nome, p, agora, { excecoes = {}, consultas = SEM, front = [] } = {}) => ({ nome, tipo: 'avancar', perfil: p, excecoes, data: DATA, agora, consultasApi: consultas, consultasFront: front });
const pedido = (extra = {}) => ({ reason: 'inactivity', requestedAt: iso(sp('16:00')), deadlineAt: iso(sp('16:05')), idleTimeoutMs: 3_600_000, ...extra });
const mudar = (nome, p, agora, front, api, excecoes = {}) => ({ nome, tipo: 'mudar', perfil: p, excecoes, data: DATA, agora, ator, front, api });

const CENARIOS = [
  avancar('avançar: dentro do período', perfil({ presenceLastActivityAt: iso(sp('09:05')) }), sp('14:59')),
  avancar('avançar: 59 min depois do fim', perfil({ presenceLastActivityAt: iso(sp('14:00')) }), sp('15:59')),
  avancar('avançar: 60 min depois do fim abre o pedido', perfil({ presenceLastActivityAt: iso(sp('14:00')) }), sp('16:00')),
  avancar('avançar: atividade tardia adia', perfil({ presenceLastActivityAt: iso(sp('15:30')) }), sp('16:29')),
  avancar('avançar: atividade tardia, 60 min depois', perfil({ presenceLastActivityAt: iso(sp('15:30')) }), sp('16:30')),
  avancar('avançar: pedido aberto antes do prazo', perfil({ presenceConfirmation: pedido() }), sp('16:04')),
  avancar('avançar: pedido vence', perfil({ presenceConfirmation: pedido(), presenceLastActivityAt: iso(sp('14:00')) }), sp('16:05')),
  avancar('avançar: pedido vence depois de uma pausa informada', perfil({ presenceConfirmation: pedido(), pauseReason: 'Refeição', expectedReturn: iso(sp('16:30')) }), sp('16:07')),
  avancar('avançar: consulta em andamento descarta a espera', perfil({ presenceConfirmation: pedido() }), sp('16:06'), { consultas: EM_CURSO, front: consultaFront }),
  avancar('avançar: consulta em andamento não abre pedido', perfil({ presenceLastActivityAt: iso(sp('14:00')) }), sp('17:00'), { consultas: EM_CURSO, front: consultaFront }),
  avancar('avançar: consulta encerrada estende', perfil({ presenceLastActivityAt: iso(sp('14:00')) }), sp('16:40'), { consultas: { emAndamento: false, terminos: [sp('15:40')] }, front: [{ id: 'c2', tarotId: 'osiris', status: 'Concluída', endedAt: iso(sp('15:40')) }] }),
  avancar('avançar: folga não inventa o fim', perfil({ weeklySchedule: { quarta: 'Folga' }, presenceLastActivityAt: iso(sp('07:00')) }), sp('23:00')),
  avancar('avançar: pedido antigo de 15 min é refeito', perfil({ presenceLastActivityAt: iso(sp('14:00')), presenceConfirmation: pedido({ requestedAt: iso(sp('15:00')), deadlineAt: iso(sp('15:05')), idleTimeoutMs: 900_000 }) }), sp('16:00')),
  avancar('avançar: pedido de ontem offline é descartado', offline({ presenceConfirmation: { reason: 'manual', requestedAt: iso(sp('20:00', '2026-11-03')), offlineAt: iso(sp('20:00', '2026-11-03')) } }), sp('07:00')),
  avancar('avançar: retorno declarado mantém o pedido', offline({ shiftExit: 'return', expectedReturn: iso(sp('10:00')), presenceConfirmation: { reason: 'manual', requestedAt: iso(sp('20:00', '2026-11-03')), offlineAt: iso(sp('20:00', '2026-11-03')) } }), sp('07:00')),
  avancar('avançar: virada 06h usa o período de ontem', perfil({ weeklySchedule: { terca: '22h às 6h' }, presenceDate: '2026-11-03', presenceConfirmedAt: iso(sp('21:50', '2026-11-03')), shiftAvailableSince: iso(sp('21:50', '2026-11-03')), presenceLastActivityAt: iso(sp('05:30')) }), sp('07:00')),
  avancar('avançar: exceção do dia encurta o turno', perfil({ presenceLastActivityAt: iso(sp('11:00')) }), sp('13:00'), { excecoes: { 'osiris@2026-11-04': excecao() } }),
  avancar('avançar: ausência no dia', perfil({ presenceLastActivityAt: iso(sp('11:00')) }), sp('20:00'), { excecoes: { 'osiris@2026-11-04': excecao({ todayHours: 'Férias', periods: [], absenceType: 'Férias' }) } }),
  avancar('avançar: retorno informado define a janela', perfil({ shiftStatus: 'Disponível', shiftExit: 'return', expectedReturn: iso(sp('18:00')), returnUntil: iso(sp('22:00')), presenceScheduleUpdatedAt: iso(sp('15:10')), presenceLastActivityAt: iso(sp('17:00')) }), sp('23:00')),
  avancar('avançar: janela confirmada define o período', perfil({ presenceConfirmedPeriod: { date: DATA, startAt: iso(sp('18:00')), endAt: iso(sp('22:00')) }, presenceLastActivityAt: iso(sp('20:00')) }), sp('23:00')),

  { nome: 'confirmar: de offline por hoje', tipo: 'confirmar', perfil: offline({ shiftExit: 'ended', pauseReason: 'Refeição', presenceConfirmation: { reason: 'manual', requestedAt: iso(sp('08:00')), offlineAt: iso(sp('08:00')) } }), excecoes: {}, data: DATA, agora: sp('08:55'), ator },
  { nome: 'confirmar: já disponível', tipo: 'confirmar', perfil: perfil(), excecoes: {}, data: DATA, agora: sp('10:00'), ator },
  { nome: 'confirmar: com retorno informado vira janela confirmada', tipo: 'confirmar', perfil: offline({ shiftExit: 'return', expectedReturn: iso(sp('10:00')), returnUntil: iso(sp('14:00')), presenceScheduleUpdatedAt: iso(sp('08:00')) }), excecoes: {}, data: DATA, agora: sp('10:05'), ator },

  mudar('mudar: pausa Refeição 30 min', perfil(), sp('10:00'), { choice: 'pause', pause: { minutes: 30, reason: 'Refeição' } }, { shiftStatus: 'Em pausa', pauseReason: 'Refeição', expectedReturn: iso(sp('10:00') + 30 * MIN), confirmation: 'none' }),
  mudar('mudar: pausa Não disse', perfil(), sp('10:00'), { choice: 'pause', pause: { minutes: 30, reason: 'Não disse' } }, { shiftStatus: 'Em pausa', pauseReason: 'Não disse', confirmation: 'none' }),
  mudar('mudar: pausa sem previsão', perfil(), sp('10:00'), { choice: 'pause', pause: { reason: 'Volta logo' } }, { shiftStatus: 'Em pausa', pauseReason: 'Volta logo', confirmation: 'none' }),
  mudar('mudar: offline pela equipe', perfil(), sp('15:10'), { choice: 'offline' }, { shiftStatus: 'Offline', shiftExit: 'shift-ended', confirmation: 'manual' }),
  mudar('mudar: encerrou o dia', perfil(), sp('15:10'), { choice: 'ended' }, { shiftStatus: 'Offline', shiftExit: 'ended', confirmation: 'manual' }),
  mudar('mudar: sumiu', perfil(), sp('15:10'), { choice: 'missing' }, { shiftStatus: 'Offline', shiftExit: 'missing', confirmation: 'manual' }),
  mudar('mudar: volta às 18h até 22h', perfil(), sp('15:10'), { choice: 'return', returnTime: '18:00', endTime: '22:00' }, { shiftStatus: 'Offline', shiftExit: 'return', expectedReturn: iso(sp('18:00')), returnUntil: iso(sp('22:00')), confirmation: 'manual' }),
  mudar('mudar: de offline com retorno informado para disponível (janela confirmada)', offline({ shiftExit: 'return', expectedReturn: iso(sp('10:00')), returnUntil: iso(sp('14:00')), presenceDate: DATA }), sp('11:00'), { choice: 'available' }, { shiftStatus: 'Disponível', confirmation: 'none' }),
  mudar('mudar: pausa para disponível mantém o desde quando', perfil({ shiftStatus: 'Em pausa', pauseReason: 'Refeição', expectedReturn: iso(sp('10:30')), shiftAvailableSince: undefined }), sp('10:20'), { choice: 'available' }, { shiftStatus: 'Disponível', confirmation: 'none' }),

  { nome: 'retorno: próximo turno', tipo: 'retorno', perfil: perfil(), excecoes: {}, data: DATA, agora: sp('16:00'), entrada: { kind: 'next-shift' } },
  { nome: 'retorno: próximo turno com exceção e término', tipo: 'retorno', perfil: perfil(), excecoes: { 'osiris@2026-11-05': excecao({ startDate: '2026-11-05', endDate: '2026-11-05', todayHours: '13h às 19h', periods: [{ start: '13:00', end: '19:00' }] }) }, data: DATA, agora: sp('16:00'), entrada: { kind: 'next-shift', endTime: '18:00' } },
  { nome: 'retorno: exata com término', tipo: 'retorno', perfil: perfil(), excecoes: {}, data: DATA, agora: sp('16:00'), entrada: { kind: 'exact', date: DATA, time: '19:00', endTime: '22:00' } },
  { nome: 'retorno: exata na madrugada', tipo: 'retorno', perfil: perfil(), excecoes: {}, data: DATA, agora: sp('16:00'), entrada: { kind: 'exact', date: DATA, time: '02:00', endTime: '05:00' } },
  { nome: 'retorno: aproximada', tipo: 'retorno', perfil: perfil(), excecoes: {}, data: DATA, agora: sp('16:00'), entrada: { kind: 'approximate', date: '2026-11-05', time: '09:30' } },
  { nome: 'retorno: à tarde e à noite', tipo: 'retorno', perfil: perfil(), excecoes: {}, data: DATA, agora: sp('16:00'), entrada: { kind: 'afternoon', date: '2026-11-05', endTime: '20:00' } },
  { nome: 'retorno: horário que já passou', tipo: 'retorno', perfil: perfil(), excecoes: {}, data: DATA, agora: sp('16:00'), entrada: { kind: 'exact', date: DATA, time: '15:00' } },
  { nome: 'retorno: data passada', tipo: 'retorno', perfil: perfil(), excecoes: {}, data: DATA, agora: sp('16:00'), entrada: { kind: 'exact', date: '2026-11-03', time: '19:00' } },
  { nome: 'retorno: término antes do retorno', tipo: 'retorno', perfil: perfil(), excecoes: {}, data: DATA, agora: sp('16:00'), entrada: { kind: 'exact', date: DATA, time: '19:00', endTime: '18:00' } },
  { nome: 'retorno: tarde de hoje já passou', tipo: 'retorno', perfil: perfil(), excecoes: {}, data: DATA, agora: sp('19:00'), entrada: { kind: 'afternoon', date: DATA } },
];

module.exports = { CENARIOS, DATA, sp, iso };
