'use strict';

/** Cenários do ouro de Valores/Preços e Restrições (Maturacao/29 seção 10). Determinísticos: sem relógio e sem aleatoriedade do ambiente. */

const PADRAO = {
  id: 'VAL-001', pixKey: 'pix@fadasdobem.com.br', regularMinuteValue: 2.96, minimumMinutes: 15, firstConsultationWindowHours: 24,
  regularPrices: [{ minutes: 15, price: 44.4 }, { minutes: 20, price: 59.2 }, { minutes: 25, price: 74 }, { minutes: 30, price: 88.8 }, { minutes: 40, price: 118.4 }, { minutes: 60, price: 159.9, referencePrice: 177.6 }],
  firstConsultationPrices: [{ minutes: 15, price: 35 }, { minutes: 20, price: 46 }, { minutes: 30, price: 67, label: 'O mais pedido' }, { minutes: 60, price: 120, label: 'Ideal para leituras mais detalhadas' }],
  createdAt: '2026-09-01T10:39:00-03:00', effectiveAt: '2026-09-01T10:39:00-03:00', createdBy: 'Laya',
};
const AGORA = '2026-10-30T15:00:00.000Z';
const SECOES = { minute: ['regularMinuteValue'], first: ['firstConsultationPrices', 'firstConsultationWindowHours'], regular: ['regularPrices', 'minimumMinutes'], pix: ['pixKey'] };
const copia = (v) => JSON.parse(JSON.stringify(v));

function precos() {
  const casos = [];
  const v2 = { ...copia(PADRAO), id: 'VAL-a', regularMinuteValue: 3.1, createdAt: '2026-10-01T12:00:00.000Z', effectiveAt: '2026-10-02T12:00:00.000Z', createdBy: 'Laya', changedFields: ['regularMinuteValue'] };
  const v3 = { ...copia(PADRAO), id: 'VAL-b', pixKey: 'nova@pix.com', createdAt: '2026-10-03T12:00:00.000Z', effectiveAt: '2026-11-20T12:00:00.000Z', createdBy: 'Khloe', changedFields: ['pixKey'] };
  const antigaAgendada = { ...copia(PADRAO), id: 'VAL-old', regularMinuteValue: 3, createdAt: '2026-10-04T12:00:00.000Z', effectiveAt: '2026-12-01T12:00:00.000Z', createdBy: 'Laya' };
  for (const [historico, em] of [[[], AGORA], [[v2], AGORA], [[v2, v3], AGORA], [[v2, v3], '2026-12-01T00:00:00.000Z'], [[antigaAgendada, v2], '2026-12-05T00:00:00.000Z'], [[antigaAgendada, v2], AGORA], [[v3, v2], '2026-09-15T00:00:00.000Z']]) {
    casos.push({ tipo: 'vigente', historico, em });
  }
  casos.push({ tipo: 'normalizar', historico: [antigaAgendada, v2, v3], agora: AGORA });
  // Criar versão: o que o front monta (draft, original, seção) e o que o servidor recebe.
  const modificar = (secao, ajuste) => { const d = copia(PADRAO); ajuste(d); return { tipo: 'versao', historico: [], draft: d, original: copia(PADRAO), secao, ator: 'Khloe', efetivaEm: '2026-11-05T12:00:00.000Z', agora: AGORA, id: `VAL-novo-${casos.length}` }; };
  casos.push(modificar('minute', (d) => { d.regularMinuteValue = 3.2; }));
  casos.push(modificar('minute', (d) => { d.regularMinuteValue = 3.205; }));
  casos.push(modificar('minute', (d) => { d.regularMinuteValue = 0; }));
  casos.push(modificar('minute', () => {}));
  casos.push(modificar('pix', (d) => { d.pixKey = '  chave nova  '; }));
  casos.push(modificar('pix', (d) => { d.pixKey = '   '; }));
  casos.push(modificar('pix', (d) => { d.pixKey = 'x'.repeat(201); }));
  casos.push(modificar('first', (d) => { d.firstConsultationPrices = [{ minutes: 30, price: 70 }, { minutes: 15, price: 40 }]; }));
  casos.push(modificar('first', (d) => { d.firstConsultationPrices = [{ minutes: 30, price: 70 }, { minutes: 30, price: 40 }]; }));
  casos.push(modificar('first', (d) => { d.firstConsultationWindowHours = 0; }));
  casos.push(modificar('first', (d) => { d.firstConsultationPrices = []; }));
  casos.push(modificar('regular', (d) => { d.regularPrices = [{ minutes: 20, price: 60, referencePrice: 80 }]; d.minimumMinutes = 20; }));
  casos.push(modificar('regular', (d) => { d.regularPrices = [{ minutes: 20, price: 60, referencePrice: 50 }]; }));
  casos.push(modificar('regular', (d) => { d.regularPrices = [{ minutes: 20, price: 60.123 }]; }));
  casos.push(modificar('regular', (d) => { d.minimumMinutes = 1.5; }));
  casos.push(modificar('all', (d) => { d.regularMinuteValue = 3; d.pixKey = 'tudo@pix'; d.minimumMinutes = 10; }));
  const { precoVigente } = require('../../src/gestao-fadas/_comum/dominio/financeiro-base');
  const comHistorico = (historico, secao, ajuste, efetivaEm) => {
    const original = copia(precoVigente(historico, AGORA)); const draft = copia(original); ajuste(draft);
    return { tipo: 'versao', historico, draft, original, secao, ator: 'Khloe', efetivaEm, agora: AGORA, id: `VAL-hist-${casos.length}` };
  };
  casos.push(comHistorico([v2, v3], 'regular', (d) => { d.regularPrices = [{ minutes: 20, price: 61 }]; }, '2026-12-10T12:00:00.000Z'));
  casos.push(comHistorico([antigaAgendada, v2], 'minute', (d) => { d.regularMinuteValue = 3.3; }, '2026-11-01T12:00:00.000Z'));
  casos.push(comHistorico([v2, v3], 'pix', (d) => { d.pixKey = 'outra@pix'; }, '2026-11-25T12:00:00.000Z'));
  for (const valor of [35, 44.4, 46, 59.2, 67, 88.8, 120, 159.9, 177.6, 50, 0, 15.5]) casos.push({ tipo: 'compra', valor, preco: copia(PADRAO) });
  casos.push({ tipo: 'compra', valor: 100, preco: { ...copia(PADRAO), firstConsultationPrices: [{ minutes: 20, price: 100 }], regularPrices: [{ minutes: 30, price: 100 }] } });
  return casos;
}

const R = (id, clientId, tarotId, requestedBy, active = true, extra = {}) => ({
  id, clientId, tarotId, ...(requestedBy ? { requestedBy } : {}), reason: 'Motivo', active, createdAt: '2026-10-20T12:00:00.000Z', createdBy: 'Laya', updatedAt: '2026-10-20T12:00:00.000Z', updatedBy: 'Laya',
  history: [{ action: 'created', at: '2026-10-20T12:00:00.000Z', actor: 'Laya', reason: 'Motivo' }], ...extra,
});

function restricoes() {
  const casos = [];
  const base = [R('r1', '900100', '9001', 'tarologist'), R('r2', '900100', '9002', 'client'), R('r3', '900101', '9001', undefined, false)];
  const perfis = ['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'];
  for (const role of perfis) {
    for (const [quem, remove, cliente, tarot] of [['tarologist', false, '900100', '9001'], ['tarologist', true, '900100', '9001'], ['client', false, '900100', '9002'], ['client', true, '900100', '9002'], ['tarologist', false, '900300', '9003'], ['tarologist', true, '900300', '9003'], ['tarologist', true, '900100', '9002']]) {
      casos.push({ tipo: 'alterar', linhas: base, entrada: { role, ownTarotId: role === 'tarologa' ? '9001' : undefined, clientId: cliente, tarotId: tarot, reason: ' Cliente pediu ', actor: 'Khloe', at: '2026-10-30T12:00:00.000Z', id: 'novo-id', remove, requestedBy: quem } });
    }
  }
  casos.push({ tipo: 'alterar', linhas: base, entrada: { role: 'atendente', clientId: '900400', tarotId: '9001', reason: 'x'.repeat(1001), actor: 'Khloe', at: '2026-10-30T12:00:00.000Z', id: 'n', requestedBy: 'tarologist' } });
  casos.push({ tipo: 'alterar', linhas: base, entrada: { role: 'atendente', clientId: ' ', tarotId: '9001', reason: 'x', actor: 'Khloe', at: '2026-10-30T12:00:00.000Z', id: 'n' } });
  casos.push({ tipo: 'alterar', linhas: base, entrada: { role: 'atendente', clientId: '900400', tarotId: '9001', reason: 'x', actor: ' ', at: '2026-10-30T12:00:00.000Z', id: 'n' } });
  casos.push({ tipo: 'alterar', linhas: base, entrada: { role: 'atendente', clientId: '900400', tarotId: '9001', reason: 'x', actor: 'K', at: 'ontem', id: 'n' } });
  casos.push({ tipo: 'alterar', linhas: base, entrada: { role: 'atendente', clientId: '900400', tarotId: '9001', reason: 'x', actor: 'K', at: '2026-10-30T12:00:00.000Z', id: 'n', requestedBy: 'outro' } });
  const consulta = (id, clientId, tarotId, rev) => ({ id, clientId, tarotId, ...(rev ? { cancellationReview: rev } : {}) });
  const rev = { requestedAt: '2026-10-29T10:00:00.000Z', requestedBy: 'Laya' };
  casos.push({ tipo: 'queixas', linhas: [], consultas: [consulta('C1', '900100', '9001', rev), consulta('C2', '900100', '9001', rev), consulta('C3', '900200', '9002'), consulta('C4', '900100', '9002', rev)] });
  casos.push({ tipo: 'queixas', linhas: base, consultas: [consulta('C1', '900100', '9002', rev)] });
  casos.push({ tipo: 'queixas', linhas: [R('x', '900100', '9001', 'client', true, { complaintConsultationIds: ['C1'] })], consultas: [consulta('C1', '900100', '9001', rev)] });
  for (const role of perfis) casos.push({ tipo: 'visiveis', linhas: base, role, ownTarotId: '9001' });
  for (const [c, t] of [['900100', '9001'], ['900100', '9002'], ['900101', '9001'], ['900999', '9001'], [undefined, '9001'], ['900100', undefined], [' 900100 ', '9001']]) casos.push({ tipo: 'restrita', linhas: base, clientId: c, tarotId: t });
  return casos;
}

function gerarCenariosPrecosRestricoes() { return [...precos(), ...restricoes()]; }

module.exports = { gerarCenariosPrecosRestricoes, PADRAO, AGORA };
