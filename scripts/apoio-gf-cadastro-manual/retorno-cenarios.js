'use strict';
// Dados sintéticos determinísticos. O ouro é produzido pelo código do front, não pelo agregado da API.
const AGORA = '2026-11-11T13:10:00.000Z';
const novo = (id, clientId = '100', tarotId = '500', extra = {}) => ({ id, clientId, tarotId, client: 'Cliente fictícia', tarot: 'Profissional fictícia',
  status: 'Concluída', durationSeconds: 600, startedAt: '2026-11-10T13:00:00.000Z', endedAt: '2026-11-10T13:10:00.000Z',
  channel: 'Telefone', paymentProfile: 'Pós-paga', attendant: 'Equipe', observation: '', audit: [], ...extra });
const antigo = (id, inicio = '2026-11-10 10:00:00', fim = '2026-11-10 10:10:00', extra = {}) => ({
  idConsulta: id, idUsuario: 100, idTarologo: 500, iniConsulta: inicio, fimConsulta: fim, tmpConsulta: 10, ...extra,
});
const base = novo('raiz');
const extensao = novo('extensao', '100', '500', { startedAt: '2026-11-10T13:10:00.000Z', endedAt: '2026-11-10T13:20:00.000Z', continuation: { kind: 'extension', sourceConsultationId: 'raiz' } });
function cenarios() {
  const casos = [
    { nome: 'sem sessões', atuais: [], antigas: [] },
    { nome: 'retorno no mesmo dia após fim confirmado', atuais: [base, novo('volta', '100', '500', { startedAt: '2026-11-10T14:00:00.000Z', endedAt: '2026-11-10T14:10:00.000Z' })], antigas: [] },
    { nome: 'sobreposição não é retorno', atuais: [base, novo('sobreposta', '100', '500', { startedAt: '2026-11-10T13:05:00.000Z' })], antigas: [] },
    { nome: 'continuação é uma sessão', atuais: [base, extensao], antigas: [] },
    { nome: 'complemento é uma sessão', atuais: [base, { ...extensao, continuation: undefined, coverage: { kind: 'Complemento', sourceConsultationId: 'raiz' } }], antigas: [] },
    { nome: 'origem anulada não cria sessão autônoma', atuais: [{ ...base, status: 'Anulada' }, extensao], antigas: [] },
    { nome: 'vínculo de outra cliente não agrupa', atuais: [base, { ...extensao, clientId: '101' }], antigas: [] },
    { nome: 'ciclo de continuações descartado', atuais: [{ ...base, continuation: { kind: 'extension', sourceConsultationId: 'extensao' } }, extensao], antigas: [] },
    { nome: 'legado voltou e está em curso', atuais: [], antigas: [antigo(1), antigo(2, '2026-11-11 10:00:00', null, { tmpConsulta: null })] },
    { nome: 'legado futuro sem início decorrido', atuais: [], antigas: [antigo(1), antigo(2, '2026-11-12 10:00:00', null, { tmpConsulta: null })] },
    { nome: 'espelho explícito anulado vence legado', atuais: [{ ...base, status: 'Anulada', legacyConsultationId: '1' }], antigas: [antigo(1)] },
    { nome: 'mesmo par e minuto sem vínculo', atuais: [base], antigas: [antigo(1), antigo(1)] },
    { nome: 'representação original do instante segue fallback do front', atuais: [{ ...base, startedAt: '2026-11-10T10:00:00-03:00', endedAt: '2026-11-10T10:10:00-03:00' }], antigas: [antigo(1)] },
    { nome: 'antigo horário de verão', atuais: [], antigas: [antigo(1, '2018-12-01 10:00:00', '2018-12-01 10:10:00'), antigo(2, '2018-12-01 11:00:00', '2018-12-01 11:10:00')] },
    { nome: 'virada de meia-noite e duração negativa do legado', atuais: [], antigas: [antigo(1, '2026-11-09 23:55:00', '2026-11-09 00:05:00'), antigo(2, '2026-11-10 10:00:00', '2026-11-10 10:10:00', { tmpConsulta: -1 })] },
  ];
  let seed = 715;
  const pick = (xs) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return xs[seed % xs.length]; };
  for (let c = 0; c < 60; c++) {
    const atuais = [];
    for (let i = 0; i < 24; i++) {
      const start = Date.parse('2026-11-10T12:00:00Z') + i * 900000;
      atuais.push(novo(`caso${c}-${i}`, pick(['100', '101', '102']), pick(['500', '501']), {
        status: pick(['Concluída', 'Em curso', 'Anulada', 'Devolvida', 'Erro', 'Finalizada pelo tarólogo']),
        awaitingTarologistStart: pick([false, false, false, true]), durationSeconds: pick([0, 600, 900, 1200]),
        startedAt: new Date(start).toISOString(), endedAt: pick([undefined, new Date(start + 600000).toISOString()]),
        ...(i && pick([true, false]) ? { continuation: { kind: 'extension', sourceConsultationId: atuais[i - 1].id } } : {}),
      }));
    }
    casos.push({ nome: `combinação determinística ${c + 1}`, atuais, antigas: [antigo(1), antigo(2, undefined, undefined, { idUsuario: 101, idTarologo: 501 })] });
  }
  return casos.map((caso) => ({ ...caso, agora: AGORA }));
}
function linhasNovas(itens) {
  return itens.map((item) => ({ id: item.id, id_cliente: item.clientId, id_tarologo: item.tarotId, id_consulta_legado: item.legacyConsultationId || null,
    status: item.status, aguardando_inicio: item.awaitingTarologistStart === true, duracao_segundos: item.durationSeconds,
    iniciada_em: item.startedAt, encerrada_em: item.endedAt, consulta_origem_id: item.continuation?.sourceConsultationId, item }));
}
module.exports = { cenarios, linhasNovas, AGORA };
