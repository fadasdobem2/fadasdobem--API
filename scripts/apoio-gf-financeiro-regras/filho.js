'use strict';

/**
 * FILHO de scripts/verificar-gf-financeiro-regras.js: roda contra o Postgres DESCARTÁVEL (fdb_fnr_*) já migrado, com `GF_FINANCEIRO_REGRAS=true`.
 * Prova pelo HTTP do gate (sessão de mentira, usuários reais da A; legado MySQL falso) que o SERVIDOR refaz a função do front e grava o resultado DELE:
 * lançamento (preço escolhido e duplicidade), movimento novo e corrigido, ocorrência financeira, transferência de saldo, correção de campos, conciliação
 * de datas de migração, perfis, 409 e idempotência. O "navegador" aqui é o domínio portado (cujo resultado o ouro prova igual ao do front).
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FINANCEIRO_REGRAS: 'true',
  GF_FATIA_CONSULTA: 'true', GF_FATIA_AGENDA: 'true', GF_FATIA_PRESENCA: 'true', GF_FATIA_PRECOS: 'true', GF_FATIA_PAGAMENTOS: 'true', GF_FATIA_RESTRICOES: 'true',
});
delete process.env.GF_LEGADO_ESCRITA_ENABLED;
const r = (p) => path.join(raiz, p);
const D = (m) => require(r(`src/gestao-fadas/_comum/dominio/${m}`));

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const ciclo = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.service'));
  const agendaServico = require(r('src/gestao-fadas/features/agenda/agenda.service'));
  const pagamentos = require(r('src/gestao-fadas/features/financeiro-cliente/pagamentos.service'));
  const restricoes = require(r('src/gestao-fadas/features/financeiro-cliente/restricoes.service'));
  const contexto = require(r('src/gestao-fadas/features/financeiro-cliente/fin.contexto'));
  const { lendoNovo } = require(r('src/gestao-fadas/novo/leitura'));
  const Lc = D('pagamentos-lancamento'); const P = D('pagamentos-preco'); const M = D('pagamentos-movimento'); const CM = D('pagamentos-correcao-movimento');
  const O = D('pagamentos-ocorrencias'); const OC = D('pagamentos-ocorrencias-conciliar'); const T = D('pagamentos-transferencia'); const C = D('pagamentos-correcao'); const S = D('pagamentos-planilha');
  const B = D('financeiro-base');

  const PARTIDA = { 900013: 5000, 900014: -3000, 900016: 20000, 900017: 0, 900018: 0, 900019: 0 };
  const EXISTE = new Set(Object.keys(PARTIDA));
  contexto.definirLeitorDePartida(async (ids) => new Map(ids.filter((id) => EXISTE.has(id)).map((id) => [id, { centavos: PARTIDA[id], conhecido: true, nome: `Cliente ${id}` }])));
  // Desde 31/10/2026 a abertura vem da PLANILHA (Maturacao/55): semeia o histórico (corte em 2000) com os mesmos valores. O leitor do legado fica só para existência e nome.
  await require('../apoio-gf-migracao/semear').semear(sequelize, Object.fromEntries(Object.entries(PARTIDA).filter(([, v]) => v !== 0)));
  const existe = async (id) => EXISTE.has(id);
  pagamentos.definirVerificadorDeCliente(existe); restricoes.definirVerificadorDeCliente(existe); ciclo.definirVerificadorDeCliente(existe); agendaServico.definirVerificadorDeCliente(existe);

  const uAtend = await criarUsuario('Atendente Regras'); const uAdm = await criarUsuario('Administradora Regras'); const uAssist = await criarUsuario('Assistente Regras'); const uSup = await criarUsuario('Supervisora Regras');
  let sessao = { userId: uAtend, role: 'atendente', displayName: 'Khloe' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-fnr' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 400) };
  };
  const como = (perfil) => { const [userId, displayName] = { atendente: [uAtend, 'Khloe'], administradora: [uAdm, 'Laya'], assistente: [uAssist, 'Assist'], supervisora: [uSup, 'Sup'] }[perfil]; sessao = { userId, role: perfil, displayName }; };
  const n = () => { n.i = (n.i || 0) + 1; return `op-${Date.now()}-${n.i}`; };
  const agora = () => new Date().toISOString();
  const pegar = async (id) => { const x = await chamar('GET', '/payments?limit=1000'); const it = x.j.items.find((i) => i.id === id); return { item: it, versao: x.j.versions[id] }; };
  const lancar = (rec) => chamar('POST', '/payments', { operationKey: n(), record: rec });
  const revisar = (id, versao, rec) => chamar('POST', `/payments/${id}/revise`, { operationKey: n(), expectedVersion: versao, record: rec });
  const mensagem = (x) => (x.j && x.j.error && x.j.error.message) || x.t;
  const PRECOS = { consultations: [], profiles: {}, history: [] };
  const referencia = (valor, cliente, metodo = 'PIX') => P.referenciaDePreco(valor, cliente, agora(), B.PRECOS_PADRAO, { ...PRECOS, profiles: { [cliente]: { clientId: cliente, movements: [], paymentProfile: '', credit: PARTIDA[cliente] / 100, minuteBenefits: [] } } }, null, metodo);
  const entradaPix = (valor, cliente, extra = {}) => { const ref = referencia(Number(valor.replace(',', '.')), cliente); return { method: 'PIX', amount: valor, bank: 'Mercado Pago', payerName: 'Maria Souza', authorization: '', note: '', ...(ref.purchase ? { purchase: ref.purchase } : {}), ...(ref.cashUnitValue ? { cashUnitValue: ref.cashUnitValue } : {}), ...extra }; };
  const novo = (id, cliente, entrada, nome = 'Khloe') => Lc.criarPagamento(entrada, { clientId: cliente, client: `Cliente ${cliente}` }, nome, agora(), id, undefined, B.PRECOS_PADRAO);
  const ctxCliente = (id) => lendoNovo(async (m) => contexto.carregar(contexto.porModelos(m), id));

  console.log('Lançamento: o servidor REFAZ a função e a escolha de preço');
  como('atendente');
  await passo('lançar: refaz createPaymentRecord e grava o resultado do servidor (autor e instante dele)', async () => {
    const rec = novo('PG-R1', '900013', entradaPix('88,80', '900013'));
    const x = await lancar({ ...rec, informedAt: '2020-01-01T00:00:00.000Z', informedBy: 'Fulana' });
    assert.equal(x.status, 422, 'o navegador não escolhe quem lançou nem quando (registro adulterado)');
    const ok = await lancar(rec); assert.equal(ok.status, 200, ok.t);
    const g = await pegar('PG-R1'); assert.equal(g.item.informedBy, 'Khloe'); assert.ok(Date.parse(g.item.informedAt) >= Date.parse(rec.informedAt)); assert.equal(g.item.purchase.minutes, 30);
    assert.ok(g.item.audit.every((e) => e.actor === 'Khloe'));
  });
  await passo('preço escolhido na tela: compra ou valor do minuto trocados no navegador são recusados (422) com a tabela real', async () => {
    const compra = Lc.criarPagamento({ ...entradaPix('88,80', '900013'), purchase: { minutes: 60, amount: 88.8, table: 'custom' } }, { clientId: '900013', client: 'Cliente 900013' }, 'Khloe', agora(), 'PG-R2', undefined, B.PRECOS_PADRAO);
    const a = await lancar(compra); assert.equal(a.status, 422, a.t); assert.equal(mensagem(a), 'Confira o valor do minuto de referência.');
    const minuto = Lc.criarPagamento({ method: 'PIX', amount: '88,80', bank: 'BB', payerName: 'Maria', authorization: '', note: '', cashUnitValue: 1 }, { clientId: '900013', client: 'Cliente 900013' }, 'Khloe', agora(), 'PG-R3', undefined, B.PRECOS_PADRAO);
    const b2 = await lancar(minuto); assert.equal(b2.status, 422, b2.t); assert.equal(mensagem(b2), 'Confira o valor do minuto de referência.');
    const primeira = Lc.criarPagamento({ method: 'PIX', amount: '35,00', bank: 'BB', payerName: 'Maria', authorization: '', note: '', purchase: { minutes: 15, amount: 35, table: 'first', priceVersionId: 'VAL-001' } }, { clientId: '900013', client: 'Cliente 900013' }, 'Khloe', agora(), 'PG-R4', undefined, B.PRECOS_PADRAO);
    const c = await lancar(primeira); assert.equal(c.status, 422, 'cliente com saldo de partida não é primeira consulta: a tabela é a regular'); assert.equal(mensagem(c), 'Confira o valor do minuto de referência.');
  });
  await passo('registro que a função do front não produziria (texto da auditoria, forma e conta) é recusado com a frase do front', async () => {
    const rec = novo('PG-R5', '900013', entradaPix('44,40', '900013'));
    const a = await lancar({ ...rec, payerName: 'Outra Pessoa' }); assert.equal(a.status, 422); assert.equal(mensagem(a), 'Não foi possível identificar esta alteração.');
    const dinheiro = await lancar({ ...novo('PG-R6', '900013', { ...entradaPix('44,40', '900013'), method: 'Dinheiro', bank: 'Caixa' }), bank: 'BB' }); assert.equal(dinheiro.status, 422); assert.equal(mensagem(dinheiro), 'O pagamento em dinheiro pertence ao Caixa.');
  });
  await passo('duplicidade: mesmo valor em 15 min recusado com a frase do front; com a conferência da operadora (evento que lista o pagamento) passa; outro valor e cliente passam', async () => {
    const frase = 'Há um pagamento recente com o mesmo valor. Confira se já foi lançado ou confirme que é outro pagamento.';
    const dup = novo('PG-D1', '900013', entradaPix('88,80', '900013'));
    const a = await lancar(dup); assert.equal(a.status, 422, a.t); assert.equal(mensagem(a), frase);
    const evento = (ids, em = agora()) => ({ id: `payment-audit-${Date.now()}-x`, action: 'Duplicidade conferida', detail: `Outro recebimento confirmado após comparar os pagamentos ${ids.join(', ')}. Conferência em ${em}.`, actor: 'Khloe', createdAt: agora() });
    const errado = await lancar({ ...dup, audit: [...dup.audit, evento(['PG-OUTRO'])] }); assert.equal(errado.status, 422); assert.equal(mensagem(errado), frase);
    const ok = await lancar({ ...dup, audit: [...dup.audit, evento(['PG-R1'])] }); assert.equal(ok.status, 200, ok.t);
    assert.ok((await pegar('PG-D1')).item.audit.some((e) => e.action === 'Duplicidade conferida' && e.actor === 'Khloe'));
    assert.equal((await lancar(novo('PG-D2', '900013', entradaPix('44,40', '900013', { payerName: 'Outra' })))).status, 200, 'outro valor não é duplicidade');
    assert.equal((await lancar(novo('PG-D3', '900016', entradaPix('88,80', '900016')))).status, 200, 'outra cliente não é duplicidade');
  });

  await passo('lote colado: o front acrescenta o evento "Data conferida"; o servidor refaz, confere a data e grava o evento com autor e instante dele; data trocada é 422', async () => {
    const entrada = { ...entradaPix('62,13', '900016'), paidAt: '2026-10-29T12:00:00-03:00', payerName: 'Cliente Lote', note: 'Recebimento registrado por colagem em lote.' };
    const rec = novo('PG-LOTE-1', '900016', entrada);
    const evento = { id: `payment-audit-${Date.now()}-lote`, action: 'Pagamento informado', detail: 'Data conferida: 2026-10-29. Conferência do lote concluída.', actor: 'Khloe', createdAt: rec.informedAt };
    const ruim = await lancar({ ...rec, audit: [...rec.audit, { ...evento, detail: 'Data conferida: 2026-10-28. Conferência do lote concluída.' }] }); assert.equal(ruim.status, 422, ruim.t);
    const ok = await lancar({ ...rec, audit: [...rec.audit, evento] }); assert.equal(ok.status, 200, ok.t);
    const h = (await pegar('PG-LOTE-1')).item; assert.equal(h.audit.at(-1).detail, 'Data conferida: 2026-10-29. Conferência do lote concluída.'); assert.equal(h.audit.at(-1).actor, 'Khloe'); assert.equal(h.paidAt, '2026-10-29T12:00:00-03:00');
  });

  console.log('Movimento: novo, corrigido');
  const admin = async () => { como('administradora'); };
  await passo('movimento novo (devolução): o servidor refaz recordPaymentMovement; autor e instante do servidor; atendente 403; registro adulterado 422', async () => {
    const g = await pegar('PG-R1');
    const depois = M.registrarMovimento(g.item, { kind: 'refund', amount: 20, bankMoved: true, creditAmount: 20, note: 'Devolução à cliente.', occurredAt: agora() }, 'Laya', 'FM-1', agora());
    como('atendente'); const neg = await revisar('PG-R1', g.versao, depois); assert.equal(neg.status, 403, neg.t);
    await admin();
    const adulterado = await revisar('PG-R1', g.versao, { ...depois, movements: depois.movements.map((m) => ({ ...m, bankEffect: -5 })) }); assert.equal(adulterado.status, 422, adulterado.t); assert.equal(mensagem(adulterado), 'Não foi possível identificar esta alteração.');
    const ok = await revisar('PG-R1', g.versao, depois); assert.equal(ok.status, 200, ok.t);
    const h = (await pegar('PG-R1')).item; assert.equal(h.movements.length, 1); assert.equal(h.movements[0].actor, 'Laya'); assert.ok(h.movements[0].recordedAt && Date.parse(h.movements[0].recordedAt) >= Date.parse(depois.movements[0].recordedAt));
  });
  await passo('movimento além do valor pago: o navegador não consegue gravar (o front recusa) e o registro forçado leva 422', async () => {
    const g = await pegar('PG-R1');
    const forcado = { ...g.item, movements: [...g.item.movements, { ...g.item.movements[0], id: 'FM-9', amount: 500, bankEffect: -500, creditEffect: -500, operationSignature: JSON.stringify({ kind: 'refund', amount: 500, bankMoved: true, creditAmount: 500, note: 'x', occurredAt: agora(), actor: 'Laya' }) }], updatedAt: agora(), updatedBy: 'Laya' };
    const x = await revisar('PG-R1', g.versao, forcado); assert.equal(x.status, 422, x.t);
  });
  await passo('corrigir movimento ("Editar movimento"): aceito como o front aceita, com auditoria; valor demais e data ruim recusados; atendente 403', async () => {
    const g = await pegar('PG-R1'); const ctx = await ctxCliente('900013');
    const depois = CM.corrigirMovimento(g.item, 'FM-1', { amount: 15, occurredAt: g.item.movements[0].occurredAt, note: 'Corrigido.' }, 'Laya', agora(), ctx);
    como('atendente'); assert.equal((await revisar('PG-R1', g.versao, depois)).status, 403);
    await admin();
    const ok = await revisar('PG-R1', g.versao, depois); assert.equal(ok.status, 200, ok.t);
    const h = (await pegar('PG-R1')).item; assert.equal(h.movements[0].amount, 15); assert.equal(h.movements[0].note, 'Corrigido.');
    const ev = h.audit.at(-1); assert.equal(ev.action, 'Movimentação corrigida'); assert.equal(ev.actor, 'Laya'); assert.match(ev.detail, /Valor: 20,00 → 15,00/);
    const g2 = await pegar('PG-R1');
    const falso = { ...depois, movements: [{ ...depois.movements[0], amount: 99 }] }; const rf = await revisar('PG-R1', g2.versao, { ...falso, updatedAt: agora() }); assert.equal(rf.status, 422, rf.t);
    const passa = CM.corrigirMovimento; assert.throws(() => passa(g2.item, 'FM-1', { amount: 9999, occurredAt: g2.item.movements[0].occurredAt, note: '' }, 'Laya', agora(), ctx), /Informe um valor válido, até o total deste pagamento\./);
  });

  console.log('Ocorrência financeira e transferência de saldo');
  await passo('ocorrência (devolução com dispensa recusada se não há cobrança): assistente registra, atendente sem permissão de saída leva a recusa do front, contato é da equipe', async () => {
    como('administradora'); { const l = await lancar(novo('PG-O1', '900013', entradaPix('100,00', '900013', { payerName: 'Pessoa Um' }))); assert.equal(l.status, 200, l.t); }
    como('atendente'); // a atendente lança e a assistente confirma; aqui só a ocorrência
    const g = await pegar('PG-O1'); const ctx = await ctxCliente('900013');
    const estado = { payments: ctx.payments, consultations: ctx.consultations };
    const entrada = { id: 'OC-1', operationId: 'OPE-1', paymentId: 'PG-O1', kind: 'refund', amount: 30, note: 'Cliente pediu devolução.', initiatedBy: 'client', agreement: 'agreed', chargeDecision: 'maintain', bankMoved: true };
    const feito = O.registrarOcorrencia(estado, entrada, 'Assist', 'assistente', agora()).payments.find((p) => p.id === 'PG-O1');
    como('atendente'); const neg = await revisar('PG-O1', g.versao, feito); assert.equal(neg.status, 422, neg.t); assert.equal(mensagem(neg), 'Seu acesso não está autorizado a registrar saídas.'); // v706 (canRegisterPaymentOutgoing): sem conta com registerOutgoing a recusa de PERMISSÃO vem antes da frase da decisão (essa só alcança atendente/supervisora COM a permissão; coberta no ouro do front)
    como('assistente'); const adulterado = await revisar('PG-O1', g.versao, { ...feito, financialOccurrences: feito.financialOccurrences.map((o) => ({ ...o, amount: 99 })) }); assert.equal(adulterado.status, 422, adulterado.t);
    const ok = await revisar('PG-O1', g.versao, feito); assert.equal(ok.status, 200, ok.t);
    const h = (await pegar('PG-O1')).item; assert.equal(h.financialOccurrences.length, 1); assert.equal(h.financialOccurrences[0].createdBy, 'Assist'); assert.equal(h.movements[0].actor, 'Assist'); assert.equal(h.movements[0].occurrenceId, 'OC-1');
    const g2 = await pegar('PG-O1'); const ctx2 = await ctxCliente('900013');
    const contato = OC.contatarOcorrencia({ payments: ctx2.payments, consultations: [] }, { operationId: 'OPE-2', paymentId: 'PG-O1', occurrenceId: 'OC-1', channel: 'WhatsApp', note: 'Falei com a cliente.' }, 'Khloe', 'atendente', agora()).payments.find((p) => p.id === 'PG-O1');
    como('atendente'); const c = await revisar('PG-O1', g2.versao, contato); assert.equal(c.status, 200, c.t);
    assert.equal((await pegar('PG-O1')).item.financialOccurrences[0].contacts[0].by, 'Khloe');
  });
  await passo('movimento de ocorrência: o valor não muda pela edição de movimento (frase do front); decisão devolve 422 se o front recusa', async () => {
    const g = await pegar('PG-O1'); const ctx = await ctxCliente('900013'); const m0 = g.item.movements[0];
    assert.throws(() => CM.corrigirMovimento(g.item, m0.id, { amount: 10, occurredAt: m0.occurredAt, note: m0.note }, 'Laya', agora(), ctx), /Este movimento pertence a uma ocorrência financeira\./);
    como('administradora'); const forcado = { ...g.item, movements: [{ ...m0, amount: 10 }], updatedAt: agora(), updatedBy: 'Laya', audit: [...g.item.audit, { id: 'a-x', action: 'Movimentação corrigida', detail: 'x', actor: 'Laya', createdAt: agora() }] };
    const x = await revisar('PG-O1', g.versao, forcado); assert.equal(x.status, 422, x.t);
  });
  await passo('transferência de saldo: o servidor refaz transferClientBalance com o saldo real; atendente leva a frase do front; adulterada 422; autor e instante do servidor', async () => {
    como('assistente'); const a = novo('PG-T1', '900013', entradaPix('74,00', '900013', { payerName: 'Pessoa Tres' })); // regular 25 min
    { const l = await lancar({ ...a }); assert.equal(l.status, 200, l.t); }
    let g = await pegar('PG-T1');
    const confirmado = { ...g.item, confirmation: 'Confirmado', status: 'Informado', updatedAt: agora(), updatedBy: 'Assist', audit: [...g.item.audit, { id: 'a-c', action: 'Recebimento confirmado', detail: 'recebimento: Informado → Confirmado', actor: 'Assist', createdAt: agora() }] };
    { const l = await revisar('PG-T1', g.versao, confirmado); assert.equal(l.status, 200, l.t); }
    g = await pegar('PG-T1'); const ctx = await ctxCliente('900013');
    const estado = { payments: ctx.payments, consultations: ctx.consultations };
    const entrada = { id: 'TR-1', sourceClientId: '900013', targetClientId: '900014', amount: 20, note: 'Pedido da titular.' };
    const contextoT = (papel, nome) => ({ profiles: { 900013: ctx.profile, 900014: { ...ctx.profile, clientId: '900014', credit: -30 } }, names: { 900013: 'Cliente 900013', 900014: 'Cliente 900014' }, regularMinuteValue: 2.96, actor: nome, role: papel, at: agora() });
    const resultado = T.transferirSaldo(estado, entrada, contextoT('administradora', 'Laya')).payments;
    const feito = resultado.find((p) => (p.movements || []).some((m) => m.id === 'TR-1:1')); assert.ok(feito, 'a transferência gerou uma perna'); // o lote mais antigo é o primeiro da fila (FIFO)
    g = await pegar(feito.id);
    como('atendente'); const neg = await revisar(feito.id, g.versao, feito); assert.equal(neg.status, 422, neg.t); assert.equal(mensagem(neg), 'A transferência de saldo está disponível para administradora e assistente.');
    como('administradora');
    const adulterada = await revisar(feito.id, g.versao, { ...feito, movements: feito.movements.map((m) => ({ ...m, amount: m.amount + 1 })) }); assert.equal(adulterada.status, 422, adulterada.t);
    const clienteFalso = await revisar(feito.id, g.versao, { ...feito, movements: feito.movements.map((m) => ({ ...m, balanceTransfer: { ...m.balanceTransfer, targetClientId: '555' } })) }); assert.equal(clienteFalso.status, 422, clienteFalso.t);
    const ok = await revisar(feito.id, g.versao, feito); assert.equal(ok.status, 200, ok.t);
    const h = (await pegar(feito.id)).item; const t = h.movements.find((m) => m.kind === 'balance-transfer'); assert.equal(t.actor, 'Laya'); assert.equal(t.balanceTransfer.targetClientId, '900014'); assert.equal(t.amount, 20);
    const ctx2 = await ctxCliente('900013'); assert.throws(() => T.transferirSaldo({ payments: ctx2.payments, consultations: [] }, { ...entrada, id: 'TR-2', amount: 500 }, contextoT('administradora', 'Laya')), /O valor ultrapassa o saldo comprado regular disponível/);
  });

  console.log('Correção de campos e datas de migração');
  await passo('corrigir pagamento (diálogo): o servidor refaz correctPaymentRecord e a escolha de preço; compra adulterada recusada; atendente pode, planilha de minutos é da administração', async () => {
    como('atendente'); { const l = await lancar(novo('PG-C1', '900016', entradaPix('100,00', '900016'))); assert.equal(l.status, 200, l.t); }
    let g = await pegar('PG-C1'); const pricing = B.PRECOS_PADRAO;
    const entrada = { ...Lc.entradaDoRegistro(g.item), amount: '88,80' }; const ref = P.referenciaDePreco(88.8, '900016', g.item.paidAt, pricing, { consultations: [], profiles: {}, history: [] }, g.item, 'PIX');
    const comRef = { ...entrada, ...(ref.purchase ? { purchase: ref.purchase } : {}), ...(ref.cashUnitValue ? { cashUnitValue: ref.cashUnitValue } : {}) };
    const feito = C.corrigirPagamento(g.item, comRef, 'Khloe', agora(), pricing);
    const ok = await revisar('PG-C1', g.versao, feito); assert.equal(ok.status, 200, ok.t);
    const h = (await pegar('PG-C1')).item; assert.equal(h.amount, 88.8); assert.equal(h.purchase, undefined, 'corrigir um recibo não é uma compra nova na tabela de hoje (referência da tela)'); assert.equal(h.cashUnitValue, 2.96); assert.equal(h.audit.at(-1).action, 'Pagamento corrigido'); assert.equal(h.audit.at(-1).actor, 'Khloe');
    g = await pegar('PG-C1');
    const compraFalsa = C.corrigirPagamento(g.item, { ...Lc.entradaDoRegistro(g.item), amount: '120,00', purchase: { minutes: 90, amount: 120, table: 'custom' } }, 'Khloe', agora(), pricing);
    const x = await revisar('PG-C1', g.versao, compraFalsa); assert.equal(x.status, 422, x.t); assert.equal(mensagem(x), 'Confira o valor do minuto de referência.');
    const minutos = S.corrigirNaPlanilha({ payments: [g.item], consultations: [], role: 'administradora', paymentId: 'PG-C1', field: 'minutes', value: '25', actor: 'Laya', now: agora(), pricing, pricingHistory: [pricing], clients: {}, clientProfiles: {} });
    const y = await revisar('PG-C1', g.versao, minutos); assert.equal(y.status, 422, 'a atendente não usa a planilha de minutos'); como('administradora');
    const z = await revisar('PG-C1', g.versao, minutos); assert.equal(z.status, 200, z.t); assert.equal((await pegar('PG-C1')).item.purchase.table, 'custom');
  });
  await passo('conciliação de datas de migração: muda informedAt só quando faltava; assistente aceita, atendente leva a frase do front; data que já existe é recusada', async () => {
    const [[ex]] = await sequelize.query("SELECT id, item, version FROM gf_pagamentos WHERE id = 'PG-C1'");
    const item = typeof ex.item === 'string' ? JSON.parse(ex.item) : ex.item;
    const { informedAt: _i, audit: _a, ...legado } = item;
    await sequelize.query("INSERT INTO gf_pagamentos (id, id_cliente, status, confirmacao, valor_centavos, metodo, informado_em, item, version, criado_por, operation_key) VALUES ('PG-L1', '900017', 'Informado', NULL, 5000, 'PIX', NOW(), :item, 1, 'migracao', 'op-legado-1')", { replacements: { item: JSON.stringify({ ...legado, clientId: '900017', client: 'Cliente 900017', amount: 50, grossAmount: 50, purchase: undefined, cashUnitValue: 2.96, audit: [] }) } });
    const g = await pegar('PG-L1'); const estado = { payments: [g.item], consultations: [] };
    const depois = D('pagamentos-datas').corrigirDatasDaMigracao(estado, { id: 'PG-L1', informedAt: '2026-10-20T10:00:00-03:00', evidence: 'Extrato do banco.', registeredDisplayDate: '2026-10-20T10:00' }, 'assistente', 'Assist', agora()).payments[0];
    como('atendente'); const neg = await revisar('PG-L1', g.versao, depois); assert.equal(neg.status, 422, neg.t); assert.equal(mensagem(neg), 'Somente o Financeiro ou a Administração corrige datas.');
    como('assistente'); const ok = await revisar('PG-L1', g.versao, depois); assert.equal(ok.status, 200, ok.t);
    const h = (await pegar('PG-L1')).item; assert.equal(h.informedAt, '2026-10-20T10:00:00-03:00'); assert.equal(h.updatedBy, 'Assist'); assert.equal(h.audit.at(-1).action, 'Pagamento corrigido');
    const g2 = await pegar('PG-L1'); const outra = await revisar('PG-L1', g2.versao, { ...g2.item, informedAt: '2026-10-21T10:00:00-03:00', updatedAt: agora(), updatedBy: 'Assist' }); assert.equal(outra.status, 422, 'a data que já existe não muda'); 
  });

  console.log('Concorrência e idempotência');
  await passo('versão velha é 409 VERSION_CHANGED; a mesma chave repete a resposta sem gravar de novo', async () => {
    como('administradora'); const g = await pegar('PG-O1');
    const velho = await revisar('PG-O1', g.versao - 1, g.item); assert.equal(velho.status, 409, velho.t); assert.equal(velho.j.error.code, 'VERSION_CHANGED');
    const novoRec = novo('PG-I1', '900018', entradaPix('44,40', '900018')); const chave = n();
    const a = await chamar('POST', '/payments', { operationKey: chave, record: novoRec }); const b2 = await chamar('POST', '/payments', { operationKey: chave, record: novoRec });
    assert.equal(a.status, 200); assert.equal(b2.status, 200); assert.deepEqual(a.j.items[0].id, b2.j.items[0].id);
    const [[linhas]] = await sequelize.query("SELECT COUNT(*) AS n FROM gf_pagamentos WHERE id = 'PG-I1'"); assert.equal(Number(linhas.n), 1);
  });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres descartável: ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close();
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
