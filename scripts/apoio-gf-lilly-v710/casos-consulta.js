'use strict';

/**
 * close_consultation e open_continuation: flags DESLIGADAS por padrão; cotações reais no contexto; o código REAL da Lilly (processConsultationClosing) emite a ação, a API
 * a executa pelos serviços existentes (término da equipe, lançamento de continuação) e a Lilly confere o resultado; idempotência, recusas e consulta intocada nas recusas.
 */

module.exports = async (c) => {
  const { r, sequelize, exec, validar, conciliar, contexto, evento, consulta, contar, conferir, passo, chave, igual, lilly, vincular, gate, como, presenca, n } = c;
  const v = require(r('src/gestao-fadas/features/lilly/v710/comum'));
  console.log('close_consultation / open_continuation');
  const closing = await lilly('consultation-closing.mjs');
  if (!closing) { conferir('clone da Lilly indisponível: casos de fechamento pulados', true); return; }
  await vincular('900103', 'chat-3');
  await sequelize.query("INSERT INTO gf_clientes_ext (id_cliente, perfil_pagamento, atualizado_por, operation_key) VALUES ('900103', 'Pós-pago', 'teste', 'k-ext-900103') ON CONFLICT (id_cliente) DO UPDATE SET perfil_pagamento = 'Pós-pago'", { logging: false });
  const lancada = await gate('POST', '/consultations', { operationKey: n(), record: { id: 'C-L1', clientId: '900103', client: 'Cliente 900103', tarotId: 'osiris', tarot: 'Osíris', paymentProfile: 'Pós-paga', channel: 'WhatsApp', observation: 'x', expectedMinutes: 30 } });
  conferir('consulta lançada (200)', lancada.status === 200, lancada.t);
  como('osiris'); const ini = await gate('POST', '/consultations/C-L1/start', { operationKey: n() }); como('atendente');
  conferir('consulta iniciada pela taróloga (200)', ini.status === 200, ini.t);
  const instante = (min) => new Date(Date.now() - min * 60000).toISOString();
  await sequelize.query("UPDATE gf_consultas_ext SET iniciada_em = :a, tarologo_iniciou_em = :b, item = item || :i::jsonb WHERE id = 'C-L1'", { replacements: { a: instante(32), b: instante(31), i: JSON.stringify({ startedAt: instante(32), sentToTarologistAt: instante(32), tarologistStartedAt: instante(31) }) }, logging: false });

  const fim = new Date().toISOString();
  const endEvent = { id: 'end-1', messageId: 'end-1-m', actor: 'tarologist', internal: false, conversationId: 'osiris-chat', tarologistId: 'osiris', at: fim, text: 'Encerrei. Foram 30 minutos.', data: { intent: 'consultation_ended', minutes: 30 } };
  await evento('end-1', { conversationId: 'osiris-chat', actor: 'tarologist', internal: false });
  const aumentar = (s, config) => ({ ...s, complete: true, siteUrl: 'https://gestao.exemplo.test/', clientProfileBaseUrl: 'https://gestao.exemplo.test/', config: { enabled: true, consultationActions: config },
    tarologists: s.tarologists.map((t) => (t.id === 'osiris' ? { ...t, conversationId: 'osiris-chat' } : t)) });
  const fixture = () => {
    const state = { enabled: true, actions: {}, conversations: {}, timers: {} }; const actions = [];
    const api = { emit(s, a, e, kind, payload, suffix, target = {}) { const id = `${e.id}:${suffix}:${target.conversationId || e.conversationId}`; if (s.actions[id]) return s.actions[id];
      const x = { id, idempotencyKey: id, kind, status: 'pending', createdAt: e.at, conversationId: e.conversationId, clientId: e.clientId || '', tarologistId: e.tarologistId || '', ...target, payload }; s.actions[id] = x; a.push(x); return x; },
    note(s, a, e, text, suffix, target) { return api.emit(s, a, e, 'note', { text }, suffix, target); }, attention(s, a, e, target) { return api.emit(s, a, e, 'mark_attention', { unread: true }, 'attention', target); }, repeatNextReadyNote() {} };
    return { state, actions, api };
  };
  const contextoDoFechamento = async () => aumentar(await contexto({ conversationId: 'osiris-chat', tarologistId: 'osiris', clientId: '900103', at: fim, data: endEvent.data }), { closeEnabled: true, continuationEnabled: true });

  let acaoFecha;
  await passo('contexto: cotação de FECHAMENTO derivada das regras reais (término da equipe + saldo) e o código REAL da Lilly emite close_consultation com ela', async () => {
    const s = await contextoDoFechamento();
    const q = s.consultationClosingQuotes.find((x) => x.consultationId === 'C-L1');
    conferir('cotação: current, revisão do snapshot, minutos apurados, automática, coberta, sem conferência, expiração futura', q && q.current === true && q.revision === s.revision && q.minutes === 30 && q.canCloseAutomatically === true && q.covered === true && q.requiresReview === false && Date.parse(q.expiresAt) > Date.now(), JSON.stringify(q));
    const curto = aumentar(await contexto({ conversationId: 'osiris-chat', tarologistId: 'osiris', clientId: '900103', at: fim, data: { minutes: 20 } }), { closeEnabled: true });
    const qc = curto.consultationClosingQuotes.find((x) => x.consultationId === 'C-L1');
    conferir('término ANTES do previsto (20 de 30): a regra real pede motivo => cotação exige conferência, não é automática', qc && qc.canCloseAutomatically === false && qc.requiresReview === true && qc.minutes === 20);
    const fc = fixture(); closing.processConsultationClosing(fc.state, fc.actions, { ...endEvent, data: { intent: 'consultation_ended', minutes: 20 } }, curto, fc.api);
    conferir('e a Lilly REAL só escreve a Nota de conferência (nenhuma close_consultation)', !fc.actions.some((a) => a.kind === 'close_consultation'));
    const f = fixture();
    const emitiu = closing.processConsultationClosing(f.state, f.actions, endEvent, s, f.api);
    acaoFecha = f.actions.find((a) => a.kind === 'close_consultation');
    conferir('Lilly REAL emitiu close_consultation (e nenhuma Nota de conferência)', emitiu === true && Boolean(acaoFecha) && !f.actions.some((a) => /Precisamos conferir|Ainda preciso/.test((a.payload && a.payload.text) || '')), JSON.stringify(f.actions.map((a) => a.payload.text || a.kind)));
    const val = closing.validateClosingAction(acaoFecha, s, f.state, fim);
    conferir(`Lilly REAL valida a ação contra o contexto da API (${val.allowed ? 'allowed' : val.reason})`, val.allowed === true);
  });
  const consultaAntes = async () => JSON.stringify((await consulta('SELECT status, version, item FROM gf_consultas_ext WHERE id = :i', { i: 'C-L1' }))[0]);
  await passo('flag GF_LILLY_FECHAR_CONSULTA_ENABLED DESLIGADA (padrão): validate nega, execute recusa 403 definitivo e a consulta não muda', async () => {
    const estado = await consultaAntes();
    conferir('validate: allowed false', (await validar(acaoFecha)).corpo.allowed === false);
    const x = await exec(acaoFecha, acaoFecha.idempotencyKey);
    conferir('403 LILLY_CLOSE_DISABLED', x.status === 403 && x.corpo.error.code === 'LILLY_CLOSE_DISABLED', x.t);
    conferir('consulta intocada', (await consultaAntes()) === estado);
  });
  process.env.GF_LILLY_FECHAR_CONSULTA_ENABLED = 'true';
  await passo('recusas 4xx com a flag ligada, consulta intocada: revisão velha, impressão velha, cotação velha, tempo adulterado, evento de origem inexistente, cliente/tarólogo errados', async () => {
    const estado = await consultaAntes();
    const t = async (nome, a, status, code) => { const x = await exec(a, chave('fec')); conferir(`${nome}: ${status} ${code || ''}`, x.status === status && (!code || x.corpo.error.code === code), x.t); };
    const mut = (p, extra = {}) => ({ ...acaoFecha, ...extra, payload: { ...acaoFecha.payload, ...p } });
    await t('revisão velha', mut({ expectedRevision: 5 }), 409, 'LILLY_REVISION_CHANGED');
    await t('impressão da consulta velha', mut({ expectedConsultation: 'x'.repeat(64) }), 409, 'LILLY_CONSULTATION_CHANGED');
    await t('cotação diferente', mut({ quoteId: 'cq-outra' }), 409, 'LILLY_QUOTE_CHANGED');
    await t('tempo adulterado (minutos a mais)', mut({ timing: { ...acaoFecha.payload.timing, minutes: acaoFecha.payload.timing.minutes + 3, durationSeconds: acaoFecha.payload.timing.durationSeconds + 180 } }), 409, 'LILLY_TIMING_CHANGED');
    await t('evento de origem inexistente', mut({ triggerEventId: 'nao-existe' }), 422, 'LILLY_SOURCE_MISSING');
    await t('tarólogo errado', mut({}, { tarologistId: 'nyx' }), 422);
    await t('sem revisão', mut({ expectedRevision: undefined }), 422, 'INVALID_INPUT');
    conferir('consulta intocada', (await consultaAntes()) === estado);
  });
  let rFecha; let kFecha;
  await passo('com a flag ligada: close_consultation grava o término pelo serviço da equipe (Concluída), committed:true; repetição não duplica; GET concilia', async () => {
    kFecha = chave('fec'); rFecha = await exec(acaoFecha, kFecha);
    conferir('200 committed', rFecha.status === 200 && rFecha.corpo.committed === true, rFecha.t);
    const res = rFecha.corpo.result;
    conferir('resultado: consulta, status completed, minutos, versão nova e revisão', res.consultationId === 'C-L1' && res.status === 'completed' && Math.abs(res.minutes - acaoFecha.payload.timing.minutes) < 1e-9 && res.version >= 3 && Number.isSafeInteger(res.revision));
    const l = (await consulta('SELECT status, duracao_segundos, encerrada_em FROM gf_consultas_ext WHERE id = :i', { i: 'C-L1' }))[0];
    conferir('banco: Concluída com a duração apurada', l.status === 'Concluída' && Number(l.duracao_segundos) === acaoFecha.payload.timing.durationSeconds && l.encerrada_em);
    const eventos = await contar('gf_consultas_eventos', "id_consulta = 'C-L1' AND tipo = 'termino'");
    const rep = await exec(acaoFecha, kFecha);
    conferir('mesma chave: mesmo corpo e nenhum evento novo', rep.status === 200 && igual(rep.corpo, rFecha.corpo) && (await contar('gf_consultas_eventos', "id_consulta = 'C-L1' AND tipo = 'termino'")) === eventos);
    conferir('GET committed', (await conciliar(kFecha)).corpo.committed === true);
    conferir('auditoria da Lilly', (await contar('gf_auditoria', "acao = 'lilly.close_consultation' AND entidade_id = 'C-L1'")) === 1);
    const s = await contexto({ conversationId: 'chat-3', clientId: '900103' });
    conferir('o contexto seguinte mostra a consulta fechada (completed) com a duração', s.consultations.find((x) => x.id === 'C-L1').status === 'completed');
  });
  await passo('fechar uma consulta que já não está em andamento: 409 (nada acontece de novo)', async () => {
    const x = await exec(acaoFecha, chave('fec'));
    conferir('409/422 definitivo', [409, 422].includes(x.status), x.t);
  });

  // Continuação
  const maisEvent = { id: 'more-1', messageId: 'more-1-m', actor: 'client', internal: false, conversationId: 'chat-3', clientId: '900103', tarologistId: 'osiris', at: new Date().toISOString(), text: 'Quero mais 15 minutos.', data: { intent: 'request_more_time', minutes: 15 } };
  await evento('more-1', { conversationId: 'chat-3', clientId: '900103', actor: 'client' });
  const contextoDaContinuacao = async () => aumentar(await contexto({ conversationId: 'chat-3', clientId: '900103', tarologistId: 'osiris', at: maisEvent.at, data: maisEvent.data }), { closeEnabled: true, continuationEnabled: true });
  let acaoAbre;
  await passo('contexto: cotação de CONTINUAÇÃO (consulta anterior, minutos pedidos, cobertura real) e o código REAL da Lilly emite open_continuation', async () => {
    const s = await contextoDaContinuacao();
    const q = s.consultationQuotes.find((x) => x.sourceConsultationId === 'C-L1');
    conferir('cotação: current, minutos 15, coberta, pode lançar, sem conferência', q && q.current === true && q.minutes === 15 && q.covered === true && q.canLaunch === true && q.requiresReview === false && q.revision === s.revision, JSON.stringify(q));
    const f = fixture();
    closing.processConsultationClosing(f.state, f.actions, maisEvent, s, f.api);
    acaoAbre = f.actions.find((a) => a.kind === 'open_continuation');
    conferir('Lilly REAL emitiu open_continuation', Boolean(acaoAbre), JSON.stringify(f.actions.map((a) => (a.payload && a.payload.text) || a.kind)));
    const val = closing.validateClosingAction(acaoAbre, s, f.state, maisEvent.at);
    conferir(`Lilly REAL valida a ação contra o contexto da API (${val.allowed ? 'allowed' : val.reason})`, val.allowed === true);
  });
  let kAbre;
  const filhas = async () => contar('gf_consultas_ext', "consulta_origem_id = 'C-L1'");
  await passo('flag GF_LILLY_CONTINUACAO_ENABLED DESLIGADA (padrão): 403 definitivo, nenhuma consulta nova', async () => {
    const x = await exec(acaoAbre, acaoAbre.idempotencyKey);
    conferir('403 LILLY_CONTINUATION_DISABLED, sem consulta nova', x.status === 403 && x.corpo.error.code === 'LILLY_CONTINUATION_DISABLED' && (await filhas()) === 0, x.t);
    conferir('validate: allowed false', (await validar(acaoAbre)).corpo.allowed === false);
  });
  process.env.GF_LILLY_CONTINUACAO_ENABLED = 'true';
  await passo('recusas 4xx com a flag ligada, nada criado: revisão, impressão, cadeia, cotação, minutos, conversa da cliente sem vínculo, origem inexistente', async () => {
    const t = async (nome, p, status, code, extra = {}) => { const x = await exec({ ...acaoAbre, ...extra, payload: { ...acaoAbre.payload, ...p } }, chave('abr')); conferir(`${nome}: ${status} ${code || ''}`, x.status === status && (!code || x.corpo.error.code === code), x.t); };
    await t('revisão velha', { expectedRevision: 3 }, 409, 'LILLY_REVISION_CHANGED');
    await t('impressão da anterior velha', { expectedConsultation: 'x'.repeat(64) }, 409, 'LILLY_CONSULTATION_CHANGED');
    await t('cadeia adulterada', { expectedChain: 'y'.repeat(64) }, 409, 'LILLY_CHAIN_CHANGED');
    await t('cotação diferente', { quoteId: 'cc-outra' }, 409, 'LILLY_QUOTE_CHANGED');
    await t('minutos diferentes dos cotados', { minutes: 40 }, 409, 'LILLY_QUOTE_CHANGED');
    await t('conversa da cliente de outra cliente', { sourceConversationId: 'chat-1' }, 422);
    await t('evento de origem inexistente', { triggerEventId: 'nao-existe' }, 422, 'LILLY_SOURCE_MISSING');
    await t('minutos zero', { minutes: 0 }, 422, 'INVALID_INPUT');
    conferir('nenhuma consulta nova', (await filhas()) === 0);
  });
  await passo('com a flag ligada: open_continuation abre OUTRA consulta ligada à anterior pelo lançamento existente; a anterior fica intacta; repetição não cria outra', async () => {
    const anterior = JSON.stringify((await consulta('SELECT status, version, duracao_segundos, encerrada_em, item FROM gf_consultas_ext WHERE id = :i', { i: 'C-L1' }))[0]);
    kAbre = chave('abr'); const x = await exec(acaoAbre, kAbre);
    conferir('200 committed', x.status === 200 && x.corpo.committed === true, x.t);
    const res = x.corpo.result;
    const nova = (await consulta("SELECT id, id_cliente, id_tarologo, status, consulta_origem_id, aguardando_inicio, item FROM gf_consultas_ext WHERE consulta_origem_id = 'C-L1'"))[0];
    conferir('consulta nova: mesma cliente e tarólogo, ligada à anterior (continuation), minutos pedidos, preparada', nova && nova.id === res.consultationId && nova.id_cliente === '900103' && nova.id_tarologo === 'osiris' && nova.item.continuation.sourceConsultationId === 'C-L1' && nova.item.expectedMinutes === 15 && nova.aguardando_inicio === true && res.status === 'prepared');
    conferir('a consulta anterior ficou EXATAMENTE como estava', JSON.stringify((await consulta('SELECT status, version, duracao_segundos, encerrada_em, item FROM gf_consultas_ext WHERE id = :i', { i: 'C-L1' }))[0]) === anterior);
    const rep = await exec(acaoAbre, kAbre);
    conferir('repetição: mesmo corpo e UMA só consulta nova', rep.status === 200 && igual(rep.corpo, x.corpo) && (await filhas()) === 1);
    conferir('auditoria', (await contar('gf_auditoria', "acao = 'lilly.open_continuation'")) === 1);
    const s = await contexto({ conversationId: 'chat-3', clientId: '900103' });
    conferir('o contexto seguinte traz a nova com continuation.sourceConsultationId', s.consultations.some((y) => y.id === res.consultationId && y.continuation && y.continuation.sourceConsultationId === 'C-L1'));
    const outra = await exec(acaoAbre, chave('abr'));
    conferir('segunda continuação da mesma origem: 409 (já tem filha)', outra.status === 409, outra.t);
  });
  delete process.env.GF_LILLY_FECHAR_CONSULTA_ENABLED; delete process.env.GF_LILLY_CONTINUACAO_ENABLED;
  void presenca; void v;
};
