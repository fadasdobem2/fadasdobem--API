'use strict';

/**
 * FILHO de scripts/verificar-gf-consulta-regras.js: roda contra o Postgres DESCARTÁVEL (fdb_crg_*) já migrado, com a fatia Pagamentos LIGADA
 * (saldo real). Prova pelo HTTP do gate que o SERVIDOR refaz os comandos da conferência: o registro que o FRONT REAL produziu (do ouro) é
 * ACEITO e o que fica gravado é o do servidor (instante e autor dele); o mesmo registro adulterado, ou sobre um saldo que não cobre, é
 * recusado com a frase do front; a autorização da supervisora barra o lançamento; versão velha 409; idempotência.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../../apoio-gf-banco-novo/comum');

Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true',
  GF_FATIA_CONSULTA: 'true', GF_FATIA_AGENDA: 'true', GF_FATIA_PRESENCA: 'true', GF_FATIA_PAGAMENTOS: 'true', GF_FATIA_PRECOS: 'true',
});
delete process.env.GF_LEGADO_ESCRITA_ENABLED;
const r = (p) => path.join(raiz, p);
const ouro = (nome) => require(path.join(__dirname, '..', `ouro-regras-${nome}-front.json`));
const clone = (x) => JSON.parse(JSON.stringify(x));

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const servico = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.service'));
  const store = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.store'));
  const ctx = require(r('src/gestao-fadas/features/financeiro-cliente/fin.contexto'));
  const { emTransacao } = require(r('src/gestao-fadas/novo/escritor'));
  const des = require(r('src/gestao-fadas/_comum/dominio/consulta-desfechos'));
  ctx.definirLeitorDePartida(async () => new Map());
  const todos = async () => true;
  servico.definirVerificadorDeCliente(todos);
  const u = { atend: await criarUsuario('Atendente Regras'), adm: await criarUsuario('Administradora Regras'), sup: await criarUsuario('Supervisora Regras') };
  let sessao = { userId: u.atend, role: 'atendente', displayName: 'Khloe' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-crg' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 400) };
  };
  const como = (perfil) => { const m = { atendente: [u.atend, 'Khloe'], administradora: [u.adm, 'Laya'], supervisora: [u.sup, 'Clara'] }[perfil]; sessao = { userId: m[0], role: perfil, displayName: m[1] }; };
  const n = () => { n.i = (n.i || 0) + 1; return `op-crg-${Date.now()}-${n.i}`; };
  const lerItem = async (id) => (await sequelize.query('SELECT item, version FROM gf_consultas_ext WHERE id = :id', { replacements: { id } }))[0][0];
  const revisar = (id, versao, record, chave = n()) => chamar('POST', `/consultations/${id}/revise`, { operationKey: chave, expectedVersion: versao, record });

  // Semeia o cenário do ouro numa cliente própria (ids renomeados): consultas, pagamentos, benefícios e perfil de pagamento.
  let seq = 0;
  async function semear(cen, estadoK1) {
    seq += 1; const cliente = String(900200 + seq);
    const ids = [...new Set([...cen.consultas.map((c) => c.id), ...cen.pagamentos.map((p) => p.id), ...((cen.perfil.minuteBenefits || []).map((b) => b.id)), 'XX', 'K1', 'K0', 'K2'])].sort((a, b) => b.length - a.length);
    const padrao = new RegExp(`(?<![A-Za-z0-9])(${ids.map((i) => i.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![A-Za-z0-9])`, 'g');
    const renomear = (x) => JSON.parse(JSON.stringify(x).replace(padrao, `$1s${seq}`).replace(/900100/g, cliente));
    const k1 = renomear(estadoK1 || cen.consultas.find((c) => c.id === 'K1'));
    const alvoId = estadoK1 ? estadoK1.id : 'K1';
    const consultas = cen.consultas.map((c) => (c.id === alvoId ? k1 : renomear(c)));
    const pagamentos = cen.pagamentos.map(renomear); const perfil = renomear(cen.perfil);
    await emTransacao(async (ex) => {
      for (const c of consultas) await store.inserir(ex, c, 'semente', `sem-${c.id}`);
      for (const p of pagamentos) {
        await ex.execute('INSERT INTO gf_pagamentos (id, id_cliente, status, confirmacao, valor_centavos, metodo, id_consulta, informado_em, item, version, criado_por, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
          [p.id, p.clientId, p.status, p.confirmation ?? null, Math.round(p.amount * 100), p.method, p.linkedConsultationId ?? null, p.informedAt, JSON.stringify((({ id, ...resto }) => resto)(p)), 'semente', `semp-${p.id}`]);
      }
      for (const b of perfil.minuteBenefits || []) {
        await ex.execute('INSERT INTO gf_beneficios_minutos (id, id_cliente, tipo, minutos, item, concedido_em, concedido_por, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [b.id, cliente, b.kind, b.minutes, JSON.stringify((({ id, ...resto }) => resto)(b)), b.grantedAt, 'semente', `semb-${b.id}`]);
      }
      await ex.execute('INSERT INTO gf_clientes_ext (id_cliente, perfil_pagamento, dados, atualizado_por, operation_key) VALUES (?, ?, ?, ?, ?)', [cliente, perfil.paymentProfile.startsWith('Pós') ? 'Pós-pago' : 'Pré-pago', '{}', 'semente', `semc-${cliente}`]);
    });
    return { cliente, renomear, k1, id: k1.id };
  }
  const achar = (conf, pred) => conf.casos.findIndex(pred);
  const EM = '2026-10-10T18:30:00.000Z';

  const conf = ouro('conferencia');
  const casoAprovar = (nomeCen, status) => achar(conf, (c) => c.t === 'aprovar' && c.r.ok && c.r.ok.status === 'Concluída' && c.item.status === status && conf.cenarios[c.c].nome === nomeCen && c.r.ok.audit.length > c.item.audit.length && !c.args.comBeneficios && c.args.versao === c.item.updatedAt);

  console.log('Conferência de encerramento (approveReportedFinish)');
  como('atendente');
  let versaoSalva;
  await passo('o registro que o FRONT produziu é aceito; o gravado leva o instante e o autor do SERVIDOR; o saldo real é o do banco', async () => {
    const k = casoAprovar('saldo-sobra-120', 'Finalizada pelo tarólogo'); assert.ok(k >= 0, 'sem caso no ouro');
    const c = conf.casos[k]; const s = await semear(conf.cenarios[c.c], c.item);
    const pedido = s.renomear(c.r.ok);
    const x = await revisar(s.id, s.k1.updatedAt, pedido);
    assert.equal(x.status, 200, x.t);
    const salvo = await lerItem(s.id); versaoSalva = salvo.version;
    const it = typeof salvo.item === 'string' ? JSON.parse(salvo.item) : salvo.item;
    assert.equal(it.status, 'Concluída'); assert.ok(it.finishReview && it.finishReview.result === 'approved');
    assert.notEqual(it.finishReview.at, EM, 'o instante da conferência é do servidor');
    assert.notEqual(it.updatedAt, EM); assert.equal(it.audit[it.audit.length - 1].actor, 'Khloe'); assert.notEqual(it.audit[it.audit.length - 1].createdAt, EM);
    assert.equal(it.durationSeconds, pedido.durationSeconds);
    assert.equal(Number((await sequelize.query("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'consulta.revisar'"))[0][0].n) >= 1, true);
  });
  await passo('o mesmo registro com os minutos, o estado ou o valor adulterados é recusado com 422 e nada é gravado', async () => {
    const k = casoAprovar('saldo-sobra-120', 'Finalizada pelo tarólogo'); const c = conf.casos[k]; const s = await semear(conf.cenarios[c.c], c.item);
    const pedido = s.renomear(c.r.ok);
    for (const mut of [(p) => { p.durationSeconds += 600; }, (p) => { p.performedDurationSeconds += 600; }, (p) => { p.tarologistFinishReport.minutes += 5; }, (p) => { p.finishReview.reportedMinutes = 1; }, (p) => { p.financialReview = { authorizedMinutes: 1, reportedMinutes: 99, status: 'approved', at: EM, by: 'x', note: 'x', history: [] }; }]) {
      const t = clone(pedido); mut(t);
      const x = await revisar(s.id, s.k1.updatedAt, t); assert.equal(x.status, 422, x.t); assert.equal(x.j.error.message, 'Não foi possível conferir esta alteração. Atualize a tela e tente novamente.');
    }
    assert.equal((await lerItem(s.id)).version, 1);
  });
  await passo('saldo que NÃO cobre (o banco manda, não o navegador): recusa com a frase do front', async () => {
    const k = casoAprovar('saldo-sobra-120', 'Finalizada pelo tarólogo'); const c = conf.casos[k];
    const pobre = conf.cenarios.find((x) => x.nome === 'sem-pagamento');
    const s = await semear(pobre, c.item); const pedido = s.renomear(c.r.ok);
    const x = await revisar(s.id, s.k1.updatedAt, pedido);
    assert.equal(x.status, 422, x.t); assert.match(x.j.error.message, /saldo confirmado/);
    assert.equal((await lerItem(s.id)).version, 1);
  });
  await passo('versão velha: 409 VERSION_CHANGED; mesma chave e corpo repete a resposta sem regravar', async () => {
    const k = casoAprovar('saldo-sobra-120', 'Finalizada pelo tarólogo'); const c = conf.casos[k]; const s = await semear(conf.cenarios[c.c], c.item);
    const pedido = s.renomear(c.r.ok);
    const velha = await revisar(s.id, '2000-01-01T00:00:00.000Z', pedido); assert.equal(velha.status, 409, velha.t); assert.equal(velha.j.error.code, 'VERSION_CHANGED');
    const chave = n(); const a = await revisar(s.id, s.k1.updatedAt, pedido, chave); assert.equal(a.status, 200, a.t);
    const b = await revisar(s.id, s.k1.updatedAt, pedido, chave); assert.equal(b.status, 200, b.t); assert.equal((await lerItem(s.id)).version, 2);
    const c2 = await revisar(s.id, s.k1.updatedAt, pedido, n()); assert.equal(c2.status, 409, c2.t);
  });
  await passo('decisão dos adicionais (não cobrar) e recusar correção pedida: aceitas do front, gravadas pelo servidor', async () => {
    const kd = achar(conf, (c) => c.t === 'decisao' && c.args.status === 'not-charged' && c.r.ok && c.args.nota === 'Cliente confirmou.' && c.item.status === 'Finalizada pelo tarólogo');
    assert.ok(kd >= 0); const c = conf.casos[kd]; const s = await semear(conf.cenarios[c.c], c.item);
    const x = await revisar(s.id, s.k1.updatedAt, s.renomear(c.r.ok)); assert.equal(x.status, 200, x.t);
    const it = JSON.parse(JSON.stringify((await lerItem(s.id)).item)); assert.equal(it.financialReview.status, 'not-charged'); assert.equal(it.status, 'Concluída');
    const kr = achar(conf, (c2) => c2.t === 'rejeitar' && c2.r.ok && c2.args.motivo.startsWith('Mantido') && c2.item.finishCorrections && c2.item.finishCorrections.some((f) => f.status === 'pending'));
    assert.ok(kr >= 0); const cr = conf.casos[kr]; const s2 = await semear(conf.cenarios[cr.c], cr.item);
    const y = await revisar(s2.id, s2.k1.updatedAt, s2.renomear(cr.r.ok)); assert.equal(y.status, 200, y.t);
    const it2 = JSON.parse(JSON.stringify((await lerItem(s2.id)).item)); assert.ok(it2.finishCorrections.some((f) => f.status === 'rejected'));
  });

  console.log('Desfechos e compensação');
  const dd = ouro('desfechos'); const vv = ouro('vinculos');
  await passo('cancelar por queixa (equipe) e decidir (só a administradora): aceitos do front; atendente não decide', async () => {
    const ks = achar(dd, (c) => c.t === 'solicitar' && c.r.ok && c.papel === 'atendente' && c.item.status === 'Concluída' && c.item.audit.length === 0 && c.detalhes.complaint === 'A cliente reclamou do atendimento.');
    assert.ok(ks >= 0); const c = dd.casos[ks]; const s = await semear(dd.cenarios[c.c], c.item); como('atendente');
    const pedido = s.renomear(c.r.ok); const x = await revisar(s.id, s.k1.updatedAt, pedido); assert.equal(x.status, 200, `solicitar: ${x.t}`);
    const it = JSON.parse(JSON.stringify((await lerItem(s.id)).item)); assert.equal(it.status, 'Cancelada'); assert.equal(it.cancellationReview.status, 'pending'); assert.notEqual(it.cancellationReview.requestedAt, EM);
    // decisão: o front (administradora) produziu `decidir-lista`; o servidor exige a administradora.
    const kd = achar(dd, (d) => d.t === 'decidir-lista' && d.papel === 'administradora' && d.r.ok && d.item.cancellationReview && d.item.cancellationReview.status === 'pending' && d.versao === d.item.updatedAt && !d.detalhes && d.item.audit.length === 1);
    assert.ok(kd >= 0, 'sem caso de decisão'); const cd = dd.casos[kd]; const s2 = await semear(dd.cenarios[cd.c], cd.item); const pd = s2.renomear(cd.r.ok);
    como('atendente'); const negada = await revisar(s2.id, s2.k1.updatedAt, pd); assert.ok([403, 422].includes(negada.status), `negada: ${negada.t}`); assert.match(negada.j.error.message, /administradora|função/, negada.t);
    como('administradora'); const ok = await revisar(s2.id, s2.k1.updatedAt, pd); assert.equal(ok.status, 200, `decidir: ${ok.t}`);
    const it2 = JSON.parse(JSON.stringify((await lerItem(s2.id)).item)); assert.ok(['Anulada', 'Cancelada'].includes(it2.status)); assert.equal(it2.cancellationReview.decidedBy, 'Laya'); assert.notEqual(it2.cancellationReview.decidedAt, EM);
  });
  await passo('compensação (bônus): o registro do front é aceito e adulterado (mais minutos) é recusado', async () => {
    const kc = achar(vv, (c) => c.t === 'compensacao' && c.r.ok && c.item.status === 'Concluída' && c.motivo === 'Consulta anterior cancelada' && !c.item.bonusGrant && c.item.audit.length === 0);
    assert.ok(kc >= 0); const c = vv.casos[kc]; como('atendente'); const s = await semear(vv.cenarios[c.c], c.item);
    const pedido = s.renomear(c.r.ok.next); const mut = clone(pedido); mut.bonusGrant.minutes += 1;
    const ruim = await revisar(s.id, s.k1.updatedAt, mut); assert.equal(ruim.status, 422, ruim.t);
    const x = await revisar(s.id, s.k1.updatedAt, pedido); assert.equal(x.status, 200, x.t);
    const it = JSON.parse(JSON.stringify((await lerItem(s.id)).item)); assert.equal(it.bonusGrant.minutes, c.minutos); assert.notEqual(it.bonusGrant.grantedAt, EM); assert.equal(it.bonusGrant.grantedBy, 'Khloe');
  });
  await passo('erro de lançamento: só a administradora; com motivo e detalhe; a consulta vira Erro preservada', async () => {
    const k1 = dd.cenarios[0].consultas.find((c) => c.status === 'Concluída' && !c.cancellationReview);
    const s = await semear(dd.cenarios[0], k1); const item = JSON.parse(JSON.stringify((await lerItem(s.id)).item)); item.id = s.id;
    const pedido = des.marcarErro(clone(item), { reason: 'Duplicada', detail: 'Lançada duas vezes.' }, [], [], 'Laya', '2026-10-30T12:00:00.000Z', 'administradora');
    pedido.audit = pedido.audit.map((e, i) => (i >= item.audit.length ? { ...e, id: 'audit-1761825600000-abc123' } : e));
    como('atendente'); const negada = await revisar(s.id, item.updatedAt, pedido); assert.ok([403, 422].includes(negada.status), negada.t);
    como('administradora'); const x = await revisar(s.id, item.updatedAt, pedido); assert.equal(x.status, 200, x.t);
    const it = JSON.parse(JSON.stringify((await lerItem(s.id)).item)); assert.equal(it.status, 'Erro'); assert.equal(it.errorReason, 'Duplicada');
    const novo = clone(pedido); novo.errorReason = 'Outro'; novo.updatedAt = '2026-10-30T12:05:00.000Z';
    const outra = await semear(dd.cenarios[0], k1); como('administradora');
    const ruim = clone(pedido); ruim.id = outra.id; ruim.errorReason = 'Motivo inventado'; const r2 = await revisar(outra.id, k1.updatedAt, ruim); assert.equal(r2.status, 422, r2.t);
  });

  console.log('Autorização da supervisora no lançamento');
  como('atendente');
  const lancar = (id, cliente, extra = {}) => chamar('POST', '/consultations', { operationKey: n(), record: { id, clientId: cliente, client: 'Cliente Teste', tarotId: `t${id}`.slice(0, 20), tarot: 'Osíris', paymentProfile: 'Pós-paga', channel: 'WhatsApp Áudio', observation: 'x', expectedMinutes: 30, ...extra } });
  const orientacao = (cliente, extra = {}) => sequelize.query('INSERT INTO gf_clientes_orientacoes (id_cliente, revisao, ativa, pendente, item, atualizado_por, operation_key) VALUES (:c, 1, true, false, :item, \'Clara\', :k)',
    { replacements: { c: cliente, k: `or-${cliente}`, item: JSON.stringify({ revision: 1, active: true, requiresApproval: true, pendingReview: false, reason: 'Conferir antes.', at: '2026-10-29T12:00:00.000Z', by: 'Clara', history: [{ id: 'h1', action: 'require', reason: 'Conferir antes.', at: '2026-10-29T12:00:00.000Z', by: 'Clara', role: 'supervisora' }], ...extra }) } });
  const FRASE = 'Esta cliente precisa de orientação da supervisora antes de uma nova consulta. Abra a ficha e encaminhe para revisão.';
  await passo('cliente que exige orientação, sem autorização: o lançamento é recusado (422) com a frase do front e nada é gravado', async () => {
    await orientacao('900401'); const x = await lancar('C-aut-1', '900401');
    assert.equal(x.status, 422, x.t); assert.equal(x.j.error.message, FRASE);
    assert.equal(Number((await sequelize.query("SELECT COUNT(*) AS n FROM gf_consultas_ext WHERE id = 'C-aut-1'"))[0][0].n), 0);
  });
  await passo('o histórico já concluído passa (como no front); cliente sem orientação passa', async () => {
    const hoje = new Date(Date.now() - 3600000).toISOString();
    const h = await lancar('C-aut-2', '900401', { status: 'Concluída', startedAt: new Date(Date.now() - 7200000).toISOString(), endedAt: hoje, durationSeconds: 1200, awaitingTarologistStart: false });
    assert.equal(h.status, 200, h.t);
    const l = await lancar('C-aut-3', '900402'); assert.equal(l.status, 200, l.t);
  });
  await passo('autorização de UMA consulta: o primeiro lançamento passa e consome; o segundo é recusado', async () => {
    await orientacao('900403', { approval: { id: 'A1', at: new Date(Date.now() - 1000).toISOString(), by: 'Clara', baselineConsultationIds: [] }, requiresApproval: true });
    const a = await lancar('C-aut-4', '900403'); assert.equal(a.status, 200, a.t);
    const b = await lancar('C-aut-5', '900403', { tarotId: 'outro-tarot' }); assert.equal(b.status, 422, b.t); assert.equal(b.j.error.message, FRASE);
  });
  await passo('a mesma regra vale quando a edição troca a cliente de uma consulta em curso', async () => {
    await orientacao('900404');
    const a = await lancar('C-aut-6', '900405', { tarotId: 'tar-edit' }); assert.equal(a.status, 200, a.t);
    const it = a.j.consultations[0]; const edit = clone(it); edit.clientId = '900404'; edit.client = 'Outra';
    const x = await revisar('C-aut-6', it.updatedAt, edit); assert.equal(x.status, 422, x.t); assert.equal(x.j.error.message, FRASE);
  });

  console.log('Edição de dados');
  await passo('consulta com queixa: a atendente muda a observação, não o tarólogo; a administradora muda tudo', async () => {
    const cen = dd.cenarios.find((x) => x.consultas.some((c) => c.status === 'Concluída' && !c.cancellationReview && !c.bonusGrant && c.durationSeconds >= 600)); const cons = cen.consultas.find((c) => c.status === 'Concluída' && !c.cancellationReview && !c.bonusGrant && c.durationSeconds >= 600);
    const item = { ...clone(cons), cancellationReview: { status: 'paid', readerStatus: 'Concluída', complaint: 'x', complaintReasons: [], shareComplaint: false, requestedBy: 'a', requestedAt: cons.startedAt, decidedBy: 'b', decidedAt: cons.startedAt }, status: 'Cancelada' };
    const s = await semear(cen, item); como('atendente');
    const obs = clone(item); obs.id = s.id; obs.clientId = item.clientId.replace(/900100/, s.cliente); obs.observation = 'só observação';
    const bruto = (x) => (typeof x === 'string' ? JSON.parse(x) : x);
    const a = await revisar(s.id, item.updatedAt, { ...clone(bruto((await lerItem(s.id)).item)), id: s.id, observation: 'só observação' }); assert.equal(a.status, 200, a.t);
    const v = (await lerItem(s.id)); const atual = { ...clone(bruto(v.item)), id: s.id };
    const trocar = { ...clone(atual), tarotId: 'outro', tarot: 'Outro' };
    const b = await revisar(s.id, atual.updatedAt, trocar); assert.equal(b.status, 422, b.t); assert.match(b.j.error.message, /Só a administradora pode alterar cliente, tarólogo/);
    como('administradora'); const c = await revisar(s.id, atual.updatedAt, trocar, n()); assert.equal(c.status, 200, c.t);
  });

  console.log('Resumo');
  const { ok, falhas } = resumo();
  console.log(`\nPostgres: ${ok} ok, ${falhas.length} falhas`);
  srv.close(); await sequelize.close();
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
