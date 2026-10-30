'use strict';

/**
 * HTTP do gate sobre o banco novo (repete scripts/ensaiar-gestao-fadas-http.js no Postgres): percentual, calendário,
 * abertura criar/confirmar, history-access, exportação, idempotência e 409; primeiro DENTRO de um ensaio (ROLLBACK, contagens
 * iguais) e depois CONFIRMANDO, para provar que o leitor lê o que a gravação escreveu. Também a conta assinante da sessão nativa.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz } = require('./comum');

const r = (p) => path.join(raiz, p);

async function rodar({ conferir, passo, criarUsuario, contagens, TABELAS_GF, sequelize }) {
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const escritor = require(r('src/gestao-fadas/novo/escritor'));
  const { entregarExportacao } = require(r('src/gestao-fadas/_comum/exportacao'));
  const { resolverContaAssinante } = require(r('src/gestao-fadas/gate/sessao-nativa'));
  const uid = await criarUsuario('Administradora HTTP');
  let perfil = 'administradora';
  const provedor = { validar: async () => ({ status: 'identity', identity: { userId: uid, role: perfil, displayName: 'Administradora HTTP' }, sessionId: 'sessao-banco-novo' }) };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: provedor, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((ok) => srv.once('listening', ok));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null;
    try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 160) };
  };
  const post = (p, c) => chamar('POST', p, c);
  const base0 = Date.now();
  const k = (x) => `http-${base0}-${x}`; // chave estável dentro do arquivo: a repetição precisa da MESMA chave
  const tarotId = '7';

  async function fluxo(prefixo, confirma) {
    const k2 = (x) => k(`${prefixo}-${x}`);
    let r1 = await post(`/payouts/agreements/${tarotId}/commission`, { operationKey: k2('c'), rate: '35.00', reason: 'ensaio http' });
    conferir(`${prefixo}: POST commission (administradora) responde 201`, r1.status === 201, `${r1.status} ${r1.t}`);
    await new Promise((x) => setTimeout(x, 1100)); // a vigência é o segundo atual: chaves diferentes no mesmo segundo batem no único
    const dup = k2('dup');
    const a = await post(`/payouts/agreements/${tarotId}/commission`, { operationKey: dup, rate: '36.00', reason: 'x' });
    const b = await post(`/payouts/agreements/${tarotId}/commission`, { operationKey: dup, rate: '36.00', reason: 'x' });
    conferir(`${prefixo}: commission repetido com a mesma chave: mesmo status e corpo`, a.status === 201 && a.status === b.status && JSON.stringify(a.j) === JSON.stringify(b.j), `${a.status}/${b.status}`);
    r1 = await post(`/payouts/agreements/${tarotId}/commission`, { operationKey: dup, rate: '40.00', reason: 'x' });
    conferir(`${prefixo}: mesma chave com corpo diferente: 409`, r1.status === 409, `${r1.status} ${r1.t}`);
    r1 = await post(`/payouts/agreements/${tarotId}/schedule`, { operationKey: k2('s'), schedule: { kind: 'monthdays', days: [5, 20], weekendPolicy: 'next-business-day' }, reason: null });
    conferir(`${prefixo}: POST schedule responde 201`, r1.status === 201, `${r1.status} ${r1.t}`);
    r1 = await post('/payouts/openings', { operationKey: k2('o'), tarotId, lastPayment: { paidOn: '2026-10-01', amount: '100.00', sheetRef: 'L12' }, settledThrough: '2026-10-02T06:00:00', remainingBalance: '50.00', migrationCut: '2026-10-05T06:00:00', rate: '30', openAdjustments: [], debts: [], differences: [] });
    conferir(`${prefixo}: POST openings responde 201 com a abertura`, r1.status === 201 && r1.j && (r1.j.id || r1.j.opening || r1.j.openingId), `${r1.status} ${r1.t}`);
    const aberturaId = r1.j && (r1.j.id || (r1.j.opening && r1.j.opening.id));
    if (aberturaId) {
      r1 = await post(`/payouts/openings/${aberturaId}/confirm`, { operationKey: k2('cf') });
      conferir(`${prefixo}: POST confirm responde 200`, r1.status === 200, `${r1.status} ${r1.t}`);
      r1 = await post(`/payouts/openings/${aberturaId}/correct`, { operationKey: k2('cr'), tarotId, lastPayment: { paidOn: '2026-10-01', amount: '100.00', sheetRef: 'L12' }, settledThrough: '2026-10-02T06:00:00', remainingBalance: '55.00', migrationCut: '2026-10-05T06:00:00', rate: '30', openAdjustments: [], debts: [], differences: [], reason: 'corrigindo' });
      conferir(`${prefixo}: POST correct responde 201`, r1.status === 201, `${r1.status} ${r1.t}`);
    }
    r1 = await post(`/payouts/agreements/${tarotId}/commission`, { operationKey: k2('bad'), rate: 'abc' });
    conferir(`${prefixo}: corpo inválido: 400`, r1.status === 400, `${r1.status} ${r1.t}`);
    perfil = 'assistente';
    r1 = await post(`/payouts/agreements/${tarotId}/commission`, { operationKey: k2('ast'), rate: '35.00', reason: 'x' });
    conferir(`${prefixo}: assistente não altera acordo: 403`, r1.status === 403, `${r1.status} ${r1.t}`);
    perfil = 'supervisora';
    r1 = await post('/operations/clients/900013/history-access', { operationKey: k2('h'), reason: 'ensaio http' });
    conferir(`${prefixo}: history-access (supervisora) responde 201 com grant`, r1.status === 201 && r1.j && r1.j.grant, `${r1.status} ${r1.t}`);
    const h2 = await post('/operations/clients/900013/history-access', { operationKey: k2('h'), reason: 'ensaio http' });
    conferir(`${prefixo}: history-access repetido devolve a mesma liberação`, h2.status === 201 && h2.j.grant.id === r1.j.grant.id, `${h2.status}`);
    const h3 = await post('/operations/clients/900013/history-access', { operationKey: k2('h'), reason: 'outro motivo' });
    conferir(`${prefixo}: history-access com a mesma chave e outro motivo: 409`, h3.status === 409, `${h3.status} ${h3.t}`);
    perfil = 'atendente';
    r1 = await post('/operations/clients/900013/history-access', { operationKey: k2('h2'), reason: 'ensaio http' });
    conferir(`${prefixo}: history-access (atendente): 403`, r1.status === 403, `${r1.status} ${r1.t}`);
    r1 = await post('/operations/clients/111/history-access', { operationKey: k2('h4'), reason: 'ensaio http' });
    conferir(`${prefixo}: history-access (atendente) em cliente inexistente continua 403 (função vem antes)`, r1.status === 403, `${r1.status}`);
    perfil = 'administradora';
    if (confirma) {
      const ac = await chamar('GET', `/payouts/agreements/${tarotId}`);
      const dados = ac.j && (ac.j.dados || ac.j);
      conferir('GET acordo lê do Postgres o que o POST gravou (36.00 vigente, nome de quem registrou)', ac.status === 200 && /36\.00/.test(JSON.stringify(dados)) && /Administradora HTTP/.test(JSON.stringify(dados)), `${ac.status} ${ac.t}`);
      const ab = await chamar('GET', `/payouts/openings/${tarotId}`);
      conferir('GET aberturas lê do Postgres as 2 revisões', ab.status === 200 && JSON.stringify(ab.j).includes('"revision":2'), `${ab.status} ${ab.t}`);
    }
    // Exportação: a auditoria entra no Postgres ANTES do arquivo seguir.
    // No ensaio a transação ainda não confirmou: só a conexão do ensaio enxerga; por isso a contagem passa pelo escritor.
    const contar = async () => Number((await escritor.executarAvulso('SELECT COUNT(*) AS n FROM gf_auditoria'))[0][0].n);
    const antesAud = await contar();
    let corpoRes = null;
    const res = { status() { return this; }, set() { return this; }, end(b) { corpoRes = b; } };
    await entregarExportacao(res, { accountId: uid, role: 'administradora' }, {
      screen: 'consultas', cut: { periodo: 'teste' },
      sheet: { filename: 'x.xlsx', sheetName: 'S', headers: ['A'], rows: [['x']], widths: [10], options: { summaryRow: ['T'], subtitle: 's' } },
    });
    const depoisAud = await contar();
    conferir(`${prefixo}: exportação: xlsx (zip) entregue e auditoria gravada no Postgres`, corpoRes && Buffer.from(corpoRes).slice(0, 2).toString() === 'PK' && depoisAud === antesAud + 1, `${antesAud}->${depoisAud}`);
  }

  // 1) Ensaio: tudo numa transação que nunca confirma.
  const antes = await contagens(sequelize, TABELAS_GF);
  await escritor.emEnsaio(() => fluxo('ensaio', false));
  conferir('ensaio HTTP: ROLLBACK confirmado, contagens iguais', JSON.stringify(await contagens(sequelize, TABELAS_GF)) === JSON.stringify(antes));
  // 2) Confirmando, para o leitor ver.
  await fluxo('real', true);
  srv.close();

  await passo('sessão nativa: a conta assinante é o usuário da A (sem GESTAO_FADAS_ESCRITA_CONTA_ID); modo mysql mantém a conta de serviço', async () => {
    assert.equal(resolverContaAssinante({ id: uid }, { GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ESCRITA_CONTA_ID: 'servico' }), uid);
    assert.equal(resolverContaAssinante({ id: uid }, { GF_NOVOS_DADOS: 'mysql', GESTAO_FADAS_ESCRITA_CONTA_ID: 'servico' }), 'servico');
  });
  await passo('tarólogos: extensão gf_tarologos_ext lida do Postgres (sem JOIN entre bancos)', async () => {
    const { GfTarologosExt } = require(r('src/models'));
    await GfTarologosExt.create({ id_tarologo: 7, foto_atual_ref: 'f.png', situacao_turno: 'ativa' });
    const { modelosNovos } = require(r('src/gestao-fadas/novo/leitura'));
    const linha = (await modelosNovos().GfTarologosExt.findAll({ where: { id_tarologo: 7 }, raw: true }))[0];
    assert.equal(linha.foto_atual_ref, 'f.png');
  });
}

module.exports = { rodar };
