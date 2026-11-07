'use strict';

/** Semeia o Postgres descartável com dados FICTÍCIOS para o snapshot. Dia operacional de referência: 2026-11-07 (sábado), `AGORA` = 12:00 em São Paulo. */

const AGORA = new Date('2026-11-07T15:00:00Z');
const HOJE = '2026-11-07';
const J = JSON.stringify;

async function semear({ sequelize, r, avulso }) {
  const q = (sql, valores = []) => sequelize.query(sql, { replacements: valores, logging: false });
  const vinculos = require(r('src/gestao-fadas/features/lilly/dados/vinculos.repo'));
  const eventos = require(r('src/gestao-fadas/features/lilly/dados/eventos.repo'));
  const cotacoes = require(r('src/gestao-fadas/features/lilly/dados/cotacoes.repo'));
  const avisos = require(r('src/gestao-fadas/features/lilly/dados/avisos.repo'));
  const notas = require(r('src/gestao-fadas/features/lilly/dados/notas-horario.repo'));
  const refs = require(r('src/gestao-fadas/features/lilly/dados/pagamento-refs.repo'));

  // Vínculos: Ana na conversa A (vigente) e também na B (inativa) = conflito 1:1 que precisa ir junto; conversa C sem vínculo (busca por telefone).
  await vinculos.salvarVinculo(avulso, { clientId: '900101', contactId: 'ct-A', conversationId: 'chat-A', verified: true, active: true, attribution: { kind: 'ad', verified: true }, firstContact: true });
  await vinculos.salvarVinculo(avulso, { clientId: '900101', contactId: 'ct-B', conversationId: 'chat-B', verified: true, active: false });

  // Eventos resolvidos da conversa A.
  const ev = (id, at, extra) => eventos.gravarEvento(avulso, { id, source: 'umbler', at, conversationId: 'chat-A', contactId: 'ct-A', messageId: `m-${id}`, actor: 'client', internal: false, clientId: '900101', text: `texto ${id}`, data: {}, ...extra });
  await ev('umbler:E1', '2026-11-07T14:00:00Z', { data: { intent: 'client_message' } });
  await ev('umbler:E2', '2026-11-07T14:05:00Z', { actor: 'staff', internal: true, clientId: null, text: 'Nota da equipe' });
  await ev('umbler:E3', '2026-11-07T14:10:00Z', { actor: 'lilly', internal: false });
  await ev('umbler:E4', '2026-11-07T14:20:00Z', { actor: 'system', data: { automated: true } });
  await ev('umbler:ATIV', '2026-11-07T14:30:00Z', { actor: 'system', messageId: null, text: '', data: { activityCode: 'close' } });
  await ev('site:S1', '2026-11-07T14:40:00Z', { source: 'site', actor: 'system', messageId: null, text: '' });
  await ev('umbler:VELHO', '2026-11-03T10:00:00Z', {});
  await ev('umbler:E5', '2026-11-07T14:50:00Z', { text: '', data: { messageType: 'audio' } }); // áudio sem texto

  // Cotação, aviso e nota do horário (com texto livre que NÃO pode sair).
  await cotacoes.gravarCotacao(avulso, { id: 'Q1', conversationId: 'chat-A', clientId: '900101', createdAt: '2026-11-07T13:00:00Z', amountCentavos: 8880, minutes: 30 });
  await avisos.gravarAviso(avulso, { id: 'av1', conversationId: 'chat-A', clientId: '900101', appointmentId: 'ag-1', messageId: 'm-av', sentAt: '2026-11-07T13:30:00Z', autor: 'Lilly' });
  await notas.gravarNota(avulso, { id: 'nota-1', tarologistId: '9001', date: HOJE, status: 'waiting', text: 'MOTIVO-PESSOAL-NAO-PODE-SAIR', at: '2026-11-07T14:00:00Z', expectedAt: '2026-11-07T18:00:00Z' });

  // Agenda: aberta de hoje, fila geral em standby, encerrada de hoje, futura (amanhã) de outra cliente, e uma cancelada de ontem.
  const ag = (id, n, tarot, cli, data, pos, outcome, item) => q(
    'INSERT INTO gf_agenda (id, numero_publico, id_tarologo, id_cliente, data_operacional, posicao, agenda_outcome, item, criado_por, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)',
    [id, n, tarot, cli, data, pos, outcome, J(item), 'teste', `k-${id}`],
  );
  await ag('ag-1', 1, '9001', '900101', HOJE, 1, null, { tarotId: '9001', clientId: '900101', date: HOJE, position: 1, scheduledTime: '15:30', observation: 'OBSERVACAO-NAO-PODE-SAIR', contactPlan: { who: 'tarologist', timing: 'exact', time: '15:30', segredo: 'x' } });
  await ag('ag-2', 2, 'afila', '900102', '2026-11-07', 1, null, { tarotId: 'afila', clientId: '900102', standbyDate: HOJE, position: 1 });
  await ag('ag-3', 3, '9001', '900101', HOJE, 2, 'Concluída', { tarotId: '9001', clientId: '900101', date: HOJE, position: 2, agendaOutcome: 'Concluída', resolvedByConsultationId: 'c-3' });
  await ag('ag-4', 4, '9002', '900103', '2026-11-08', 1, null, { tarotId: '9002', clientId: '900103', date: '2026-11-08', position: 1 });
  await ag('ag-5', 5, '9002', '900103', '2026-11-06', 1, 'Cancelada', { tarotId: '9002', clientId: '900103', date: '2026-11-06', position: 1, agendaOutcome: 'Cancelada' });

  // Consultas: preparada (canal do painel recusado pela Lilly), em andamento, concluída, finalizada pelo tarólogo, anulada.
  const co = (id, tarot, cli, status, aguardando, iniciada, extra = {}) => q(
    `INSERT INTO gf_consultas_ext (id, id_tarologo, id_cliente, id_agenda, status, canal, comissao_percentual, aguardando_inicio, iniciada_em, encerrada_em, tarologo_iniciou_em, duracao_segundos, item, criado_por, operation_key)
     VALUES (?, ?, ?, ?, ?, ?, 40, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)`,
    [id, tarot, cli, extra.agenda || null, status, extra.canal || null, aguardando, iniciada, extra.fim || null, extra.tarologoIniciou || null, extra.duracao || 0, J(extra.item || {}), 'teste', `k-${id}`],
  );
  await co('c-1', '9001', '900101', 'Em curso', true, '2026-11-07T14:45:00Z', { canal: 'WhatsApp Áudio', agenda: 'ag-1', item: { expectedMinutes: 30, sentToTarologistAt: '2026-11-07T14:46:00Z', observation: 'OBS-CONSULTA-NAO-PODE-SAIR' } });
  await co('c-2', '9002', '900103', 'Em curso', false, '2026-11-07T14:00:00Z', { canal: 'WhatsApp Ligação', tarologoIniciou: '2026-11-07T14:02:00Z', item: { timeLimit: { kind: 'maximum', minutes: 20 }, pauseHistory: [{ startedAt: '2026-11-07T14:10:00Z', endedAt: '2026-11-07T14:12:00Z' }] } });
  await co('c-3', '9001', '900102', 'Concluída', false, '2026-11-07T10:00:00Z', { canal: 'PABX', fim: '2026-11-07T10:30:00Z', duracao: 1800, tarologoIniciou: '2026-11-07T10:01:00Z', item: { expectedMinutes: 30 } });
  await co('c-4', '9001', '900104', 'Finalizada pelo tarólogo', false, '2026-11-07T11:00:00Z', { canal: 'Telefone', fim: '2026-11-07T11:20:00Z', duracao: 1200, item: { tarologistFinishReport: { minutes: 20, endedAt: '2026-11-07T11:20:00Z' } } });
  await co('c-5', '9002', '900105', 'Anulada', false, '2026-11-07T09:00:00Z', { canal: 'Chat', fim: '2026-11-07T09:05:00Z' });

  // Presença, escala semanal e exceções.
  await q("INSERT INTO gf_presenca_estado (id_tarologo, shift_status) VALUES ('9001', 'Disponível'), ('9002', 'Em pausa')");
  await q("INSERT INTO gf_escalas_semanais (id_tarologo, weekday, hours) VALUES ('9001', 'sabado', '22h às 02h'), ('9001', 'domingo', '14h às 18h'), ('9002', 'sabado', '10h às 14h'), ('9002', 'domingo', '10h às 14h')");
  await q("INSERT INTO gf_horarios_excecoes (id, id_tarologo, data_inicio, data_fim, absence_type, today_hours, observacao, updated_at_texto, operation_key) VALUES ('ex-1', '9002', ?, ?, 'Folga estendida', 'Folga', 'MOTIVO-FOLGA-NAO-PODE-SAIR', 'x', 'k-ex-1')", [HOJE, HOJE]);

  // Pagamentos lançados no Postgres (com referência do provedor) e restrição/divergência.
  const pgto = (id, cli, status, conf, centavos, extra = {}) => q(
    'INSERT INTO gf_pagamentos (id, id_cliente, status, confirmacao, valor_centavos, metodo, id_consulta, informado_em, item, criado_por, operation_key, legado_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?)',
    [id, cli, status, conf, centavos, 'PIX', extra.consulta || null, extra.em || '2026-11-07T13:00:00Z', J({ paidAt: '2026-11-07T12:50:00Z', ...(extra.item || {}) }), 'teste', `k-${id}`, extra.legado || null],
  );
  await pgto('pg-1', '900101', 'Informado', 'Confirmado', 8880, { consulta: 'c-1' });
  await pgto('pg-2', '900101', 'Cancelado', null, 5000);
  await pgto('pg-3', '900101', 'Informado', null, 14800, { legado: '502' });
  await refs.gravarRefs(avulso, { paymentId: 'pg-3', reference: 'REF-1', mpPaymentId: 'mp-1', endToEndId: 'E2E-1', sourceEventId: 'umbler:E1' });
  await q("INSERT INTO gf_restricoes (id, id_cliente, id_tarologo, solicitante, ativa, item, criado_por, operation_key) VALUES ('rs-1', '900101', '9002', 'client', true, '{}'::jsonb, 'teste', 'k-rs-1'), ('rs-2', '900101', '9001', 'tarologist', false, '{}'::jsonb, 'teste', 'k-rs-2')");
  await q("INSERT INTO gf_divergencias (id, tipo, area, situacao, id_cliente, id_tarologo, id_consulta, item, criado_por, operation_key) VALUES ('dv-1', 'Operacional', 'Consulta', 'Pendente', '900102', '9001', 'c-3', '{}'::jsonb, 'teste', 'k-dv-1')");
  // Extensão do cadastro: Gabi (900107) editou o WhatsApp na ficha; Ana é Pós-pago.
  await q("INSERT INTO gf_clientes_ext (id_cliente, perfil_pagamento, dados, atualizado_por, operation_key) VALUES ('900107', 'Pré-pago', ?::jsonb, 'teste', 'k-ext-1'), ('900101', 'Pós-pago', '{}'::jsonb, 'teste', 'k-ext-2')", [J({ whatsapp: '(11) 95555-4321' })]);
}

module.exports = { semear, AGORA, HOJE };
