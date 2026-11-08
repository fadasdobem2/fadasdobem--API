'use strict';

/** Chave Pix (ausente/presente, demo nunca), `complete` por falha/limite/tipo de evento, dia operacional 06h-06h, privacidade e registro. */

module.exports = async ({ r, sequelize, snap, body, legado, conferir, passo, consulta, definirFontes }) => {
  const { chavePixVigente } = require(r('src/gestao-fadas/features/lilly/contexto/montador.configuracao'));
  const servico = require(r('src/gestao-fadas/features/lilly/contexto/contexto.servico'));
  const { SENSIVEL } = require('./legado-simulado');
  const J = JSON.stringify;
  const DEMO = 'pix@fadasdobem.com.br';
  const versao = (id, quando, campos, pixKey) => sequelize.query(
    'INSERT INTO gf_precos_versoes (id, vigente_desde, item, criado_por, operation_key) VALUES (?, ?, ?::jsonb, ?, ?)',
    { replacements: [id, quando, J({ id, effectiveAt: quando, createdAt: quando, createdBy: 'teste', ...(campos ? { changedFields: campos } : {}), pixKey }), 'teste', `k-${id}`], logging: false },
  );

  console.log('Chave Pix');
  await passo('sem versão de valores gravada: financialSettings AUSENTE (o seed VAL-001 nunca é lido como configuração)', async () => {
    const x = await snap(body());
    conferir('ausente', x.snapshot.financialSettings === undefined);
    conferir('o valor de demonstração não aparece em lugar nenhum', !J(x.snapshot).includes(DEMO));
    conferir('assunto coberto (ausência não é falha)', x.snapshot.complete === true);
  });
  await passo('versão que mudou OUTRO campo e carrega a chave de demonstração: continua ausente', async () => {
    await versao('VAL-OUTRO', '2026-10-01T00:00:00Z', ['regularMinuteValue'], DEMO);
    const x = await snap(body());
    conferir('ausente e sem demo', x.snapshot.financialSettings === undefined && !J(x.snapshot).includes(DEMO));
  });
  await passo('demonstração gravada de propósito na lista de campos alterados: NUNCA sai', async () => {
    await versao('VAL-DEMO', '2026-10-02T00:00:00Z', ['pixKey'], DEMO.toUpperCase());
    const x = await snap(body());
    conferir('ausente', x.snapshot.financialSettings === undefined && !J(x.snapshot).toLowerCase().includes(DEMO));
  });
  await passo('chave real em versão vigente: sai com o id da versão; versão FUTURA não é adiantada; a mais nova vigente vence', async () => {
    await versao('VAL-REAL', '2026-10-10T00:00:00Z', ['pixKey'], '  chave-real-de-teste  ');
    await versao('VAL-FUTURA', '2026-12-01T00:00:00Z', ['pixKey'], 'chave-futura');
    let x = await snap(body());
    conferir('chave real, aparada', x.snapshot.financialSettings.pixKey === 'chave-real-de-teste' && x.snapshot.financialSettings.versionId === 'VAL-REAL');
    conferir('vigência', x.snapshot.financialSettings.effectiveAt === '2026-10-10T00:00:00.000Z');
    await versao('VAL-NOVA', '2026-11-01T00:00:00Z', ['pixKey', 'regularMinuteValue'], 'chave-nova');
    x = await snap(body());
    conferir('a mais nova vigente', x.snapshot.financialSettings.pixKey === 'chave-nova' && x.snapshot.financialSettings.versionId === 'VAL-NOVA');
    conferir('instantâneo antigo (sem changedFields) com demo apaga a chave', chavePixVigente([{ item: { id: 'a', effectiveAt: '2026-01-01T00:00:00Z', pixKey: 'x' } }, { item: { id: 'b', effectiveAt: '2026-02-01T00:00:00Z', pixKey: DEMO } }], new Date('2026-11-07T00:00:00Z')) === null);
    const demo = await snap(body(), { trocas: { precosVersoes: async () => [{ item: { id: 'v', effectiveAt: '2026-01-01T00:00:00Z', changedFields: ['pixKey'], pixKey: DEMO } }] } });
    conferir('mesmo vindo da fonte, a demonstração é cortada', demo.snapshot.financialSettings === undefined);
  });

  console.log('Dia operacional 06h-06h');
  await passo('05:00 em São Paulo ainda é o dia anterior; 06:30 já é o novo; a fila e as escalas seguem o dia', async () => {
    const cedo = await snap(body(), { agora: new Date('2026-11-08T08:00:00Z') });
    conferir('05:00 -> 2026-11-07', cedo.snapshot.operationalDate === '2026-11-07' && cedo.snapshot.operationalStartHour === 6);
    conferir('turno 22h-02h do dia 07 vai até 02h de 08', cedo.snapshot.schedules.find((s) => s.id === '9001@2026-11-07#1').endsAt === '2026-11-08T02:00:00-03:00');
    conferir('agendamento de amanhã (ag-4, 08) ainda fora da fila', !cedo.snapshot.appointments.some((a) => a.id === 'ag-4'));
    const tarde = await snap(body(), { agora: new Date('2026-11-08T09:30:00Z') });
    conferir('06:30 -> 2026-11-08', tarde.snapshot.operationalDate === '2026-11-08');
    conferir('ag-4 (data 08) agora na fila do dia', tarde.snapshot.appointments.some((a) => a.id === 'ag-4'));
    conferir('as escalas passam a hoje=08 e amanhã=09', tarde.snapshot.schedules.some((s) => s.date === '2026-11-08') && tarde.snapshot.schedules.every((s) => ['2026-11-08', '2026-11-09'].includes(s.date)));
  });
  await passo('horário de madrugada (00h às 04h) do dia operacional cai no calendário do dia seguinte', async () => {
    const t = require(r('src/gestao-fadas/features/lilly/contexto/contexto.tempo'));
    const p = t.periodoOperacional('2026-11-07', '00:00', '04:00');
    conferir('00h-04h de 07 = 08/00h a 08/04h', p.startsAt === '2026-11-08T00:00:00-03:00' && p.endsAt === '2026-11-08T04:00:00-03:00');
    const q = t.periodoOperacional('2026-11-07', '18:00', '00:00');
    conferir('18h-00h termina à meia-noite do dia seguinte', q.endsAt === '2026-11-08T00:00:00-03:00');
  });

  console.log('complete e cobertura');
  await passo('falha parcial: pagamentos do legado fora do ar => payments vazio, complete:false; o resto do snapshot é entregue', async () => {
    legado.estado.falhas.add('pagamentos');
    const x = await snap(body());
    legado.estado.falhas.delete('pagamentos');
    conferir('payments vazio', x.snapshot.payments.length === 0 && x.snapshot.complete === false);
    conferir('cobertura diz qual', /^incompleto/.test(x.cobertura.resumo().payments) && x.cobertura.resumo().links === 'ok:2');
    conferir('os outros assuntos seguem', x.snapshot.appointments.length >= 3 && x.snapshot.messages.length === 5 && x.snapshot.clients.length > 0);
  });
  await passo('legado de clientes fora do ar: clients vazio e complete:false (nunca lista parcial)', async () => {
    legado.estado.falhas.add('usuarios');
    const x = await snap(body());
    legado.estado.falhas.delete('usuarios');
    conferir('clients vazio, complete:false', x.snapshot.clients.length === 0 && x.snapshot.complete === false && /^incompleto/.test(x.cobertura.resumo().clients));
  });
  await passo('Postgres de um assunto falha (agenda): só esse assunto some', async () => {
    const x = await snap(body(), { trocas: { agenda: async () => { throw new Error('agenda fora'); } } });
    conferir('appointments vazio, complete:false, consultas intactas', x.snapshot.appointments.length === 0 && x.snapshot.complete === false && x.snapshot.consultations.length === 5);
  });
  await passo('mais mensagens que o limite: messages VAZIO e incompleto (não entrega janela cortada)', async () => {
    await consulta(`INSERT INTO gf_lilly_eventos (id, source, at, conversation_id, message_id, actor, internal, data)
      SELECT 'umbler:LOTE' || g, 'umbler', TIMESTAMPTZ '2026-11-07 14:00:00+00' + (g || ' seconds')::interval, 'chat-LOTE', 'm' || g, 'client', false, '{}'::jsonb FROM generate_series(1, 501) g`);
    const x = await snap(body({ conversationId: 'chat-LOTE' }));
    conferir('messages vazio', x.snapshot.messages.length === 0 && x.snapshot.complete === false && /limite/.test(x.cobertura.resumo().messages));
  });
  await passo('relógio (timer): conversas dos avisos entram; capacityCheck exige métricas SEM FONTE => complete:false', async () => {
    const t = (extra) => ({ event: { type: 'timer', at: '2026-11-07T15:00:00Z', noticeReferences: [{ conversationId: 'chat-A', messageId: 'm-av', noticeAt: '2026-11-07T13:30:00Z' }], ...extra } });
    const a = await snap(t({ capacityCheck: false }));
    conferir('sem capacityCheck: completo, com a conversa do aviso', a.snapshot.complete === true && a.snapshot.notices.length === 1 && a.snapshot.links.length === 2);
    const b = await snap(t({ capacityCheck: true }));
    conferir('com capacityCheck: incompleto (queueDurationMetrics sem fonte)', b.snapshot.complete === false && /sem-fonte/.test(b.cobertura.resumo().queueDurationMetrics) && b.snapshot.queueDurationMetrics === undefined);
  });
  await passo('revisão da manhã (morningReview) é SEM FONTE: complete:false e sem a chave', async () => {
    const x = await snap({ event: { type: 'morning_review_page', mode: 'index', date: '2026-11-07', limit: 50 } });
    conferir('incompleto e sem morningReview', x.snapshot.complete === false && x.snapshot.morningReview === undefined && /sem-fonte/.test(x.cobertura.resumo().morningReview));
  });
  await passo('evento sem conversa nem cliente (action_result só com actionId): não há de onde escopar => complete:false', async () => {
    const x = await snap({ event: { type: 'action_result', actionId: 'a1' } });
    conferir('incompleto', x.snapshot.complete === false && x.snapshot.messages.length === 0);
    const y = await snap({ event: { type: 'action_result', actionId: 'a1', clientId: '900101', conversationId: 'chat-A' } });
    conferir('com cliente e conversa (depois do cadastro): completo', y.snapshot.complete === true && y.snapshot.clients.some((c) => c.id === '900101'));
  });

  console.log('Privacidade');
  await passo('nenhuma coluna sensível do legado (senha, CPF, e-mail, nascimento, endereço) nem texto livre sai no snapshot', async () => {
    const x = await snap(body({ conversationId: 'chat-C' }, { id: 'chat-C', contact: { id: 'ct-C', phoneNumber: '+5511998887777' } }));
    const todos = J(x.snapshot);
    for (const [campo, valor] of Object.entries(SENSIVEL)) conferir(`sem ${campo}`, !todos.includes(valor) && !todos.includes(`"${campo}"`));
    for (const marca of ['OBSERVACAO-NAO-PODE-SAIR', 'MOTIVO-PESSOAL-NAO-PODE-SAIR', 'OBS-CONSULTA-NAO-PODE-SAIR', 'MOTIVO-FOLGA-NAO-PODE-SAIR']) conferir(`sem texto livre ${marca.slice(0, 10)}`, !todos.includes(marca));
    conferir('cliente só com os campos do contrato', x.snapshot.clients.every((c) => Object.keys(c).every((k) => ['id', 'name', 'identificationName', 'treatAs', 'phone', 'whatsapp', 'phones', 'phoneMatch', 'contactId', 'paymentType', 'postpaid', 'balance', 'lastConsultationAt', 'profileUrl',
      // Lilly v708: só para a cliente que o fluxo de cadastro da Lilly já tocou (situação não nula); cadastro antigo continua sem eles (ver casos do v708)
      'situacao_cadastral', 'fullName', 'birthDate', 'email', 'noEmail'].includes(k))));
  });
  await passo('registro: só tipo, complete, assuntos e contagens (nenhum telefone, nome ou texto)', async () => {
    const x = await snap(body({ conversationId: 'chat-A' }, { id: 'chat-A', contact: { id: 'ct-A', phoneNumber: '+5511998887777' } }));
    const linhas = [];
    servico.registrar('message', x.snapshot, x.cobertura, (...a) => linhas.push(a.join(' ')));
    const saida = linhas.join('\n');
    conferir('uma linha com os assuntos', linhas.length === 1 && saida.includes('"clients":"ok:') && saida.includes('"complete":true'));
    conferir('sem dados pessoais', !/Ana|Aninha|99888|texto umbler|ct-A|chat-A|Nome Completo/.test(saida));
  });
  definirFontes({ ...legado.fontes });
};
