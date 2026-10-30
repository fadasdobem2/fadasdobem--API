'use strict';

/**
 * Verificação da fatia Presença (Maturacao/28 seção 5; padrão em Maturacao/29).
 *   1) OFFLINE (sempre): domínio puro com relógio simulado (60+5 do `advancePresenceConfirmation`, nunca durante consulta, virada 06h,
 *      retorno informado, confirmação, histórico "Sistema"), prazos por env (só fora de produção), validação das entradas, flag da fatia,
 *      gate desligado = 404, 401 sem sessão, 405 com Allow, formato de erro da B, `tarotId` na sessão nativa.
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): cria `fdb_prs_<aleatório>` em localhost:5432, migra por run-migrations,
 *      roda scripts/apoio-gf-presenca/filho.js (HTTP do gate, idempotência, 409, auditoria, perfis, JOB com relógio simulado) e apaga o banco no fim.
 *      DB_* só no ambiente dos filhos; nunca lê o .env nem toca em outro banco.
 *   npm run verificar:gf-presenca            (completo)       node scripts/verificar-gf-presenca.js --offline   (sem banco; entra em verificar:legado)
 */

const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const express = require('express');
const pg = require('./apoio-esquema/pg');

const raiz = path.join(__dirname, '..');
const r = (p) => require(path.join(raiz, p));
let ok = 0;
const falhas = [];
async function passo(nome, fn) {
  try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 240)}`); }
}
const rejeita = (fn, status, codigo) => assert.throws(fn, (e) => e.statusCode === status && e.dados.codigo === codigo, `esperava ${status} ${codigo}`);

/** Instante em milissegundos de um horário de São Paulo (-03:00) de 2026-11-04 (quarta-feira, dia operacional 2026-11-04). */
const sp = (hhmm, dia = '2026-11-04') => Date.parse(`${dia}T${hhmm}:00-03:00`);
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000;

async function offline() {
  const dom = r('src/gestao-fadas/_comum/dominio/presenca');
  const ret = r('src/gestao-fadas/_comum/dominio/presenca-retorno');
  const val = r('src/gestao-fadas/features/presenca/presenca.validacao');
  const DATA = '2026-11-04';
  const base = (extra = {}) => ({ id: 'osiris', weeklySchedule: { quarta: '9h às 15h' }, shiftStatus: 'Disponível', online: true, status: 'Disponível', presenceDate: DATA, presenceConfirmedAt: iso(sp('08:50')), shiftAvailableSince: iso(sp('08:50')), presenceHistory: [], ...extra });
  const avanca = (p, agora, consultas) => dom.avancarConfirmacao(p, consultas, {}, DATA, agora);

  console.log('Domínio: confirmação 60+5 (relógio simulado)');
  await passo('prazos padrão 60 e 5 minutos; env encurta só fora de produção', () => {
    assert.deepEqual(dom.prazos({}), { ociosoMs: 3_600_000, confirmacaoMs: 300_000 });
    assert.deepEqual(dom.prazos({ GF_PRESENCA_IDLE_MS: '90000', GF_PRESENCA_CONFIRM_MS: '30000', FADAS_ENVIRONMENT: 'test' }), { ociosoMs: 90_000, confirmacaoMs: 30_000 });
    assert.deepEqual(dom.prazos({ GF_PRESENCA_IDLE_MS: '90000', FADAS_ENVIRONMENT: 'production' }), { ociosoMs: 3_600_000, confirmacaoMs: 300_000 });
  });
  await passo('dentro do período da escala nada acontece, nem com horas sem atividade', () => {
    const p = base({ presenceLastActivityAt: iso(sp('09:05')) });
    assert.equal(avanca(p, sp('14:59')), p);
  });
  await passo('59 minutos depois do fim do período: nada; 60 minutos: abre o pedido com 5 minutos (prazo = agora + 5 min)', () => {
    const p = base({ presenceLastActivityAt: iso(sp('14:00')) });
    assert.equal(avanca(p, sp('15:59')), p);
    const q = avanca(p, sp('16:00'));
    assert.notEqual(q, p);
    assert.deepEqual(q.presenceConfirmation, { reason: 'inactivity', requestedAt: iso(sp('16:00')), deadlineAt: iso(sp('16:05')), idleTimeoutMs: 3_600_000 });
    assert.equal(q.shiftStatus, 'Disponível');
  });
  await passo('atividade depois do fim do período adia o pedido (60 min contados da atividade mais recente)', () => {
    const p = base({ presenceLastActivityAt: iso(sp('15:30')) });
    assert.equal(avanca(p, sp('16:29')), p);
    assert.ok(avanca(p, sp('16:30')).presenceConfirmation);
  });
  await passo('pedido aberto: antes do prazo nada muda; no prazo vira Offline, limpa pausa/retorno e grava histórico "Sistema"', () => {
    const aberto = avanca(base({ presenceLastActivityAt: iso(sp('14:00')) }), sp('16:00'));
    assert.equal(avanca(aberto, sp('16:04')), aberto);
    const q = avanca(aberto, sp('16:05'));
    assert.equal(q.shiftStatus, 'Offline'); assert.equal(q.online, false); assert.equal(q.shiftAvailableSince, undefined); assert.equal(q.shiftExit, undefined);
    assert.deepEqual(q.presenceConfirmation, { ...aberto.presenceConfirmation, offlineAt: iso(sp('16:05')) });
    const h = q.presenceHistory.at(-1);
    assert.equal(h.actorId, 'system-presence'); assert.equal(h.actorName, 'Sistema'); assert.equal(h.after, 'Offline · aguardando confirmação de disponibilidade');
    assert.equal(h.id, `presence-idle-osiris-${aberto.presenceConfirmation.requestedAt}`);
    assert.equal(avanca(q, sp('16:30')), q, 'já offline: nada mais acontece');
  });
  await passo('nunca durante consulta em andamento: a espera automática anterior é descartada e nenhuma nova abre', () => {
    const aberto = avanca(base({ presenceLastActivityAt: iso(sp('14:00')) }), sp('16:00'));
    assert.equal(avanca(aberto, sp('16:06'), { emAndamento: true, terminos: [] }).presenceConfirmation, undefined);
    const p = base({ presenceLastActivityAt: iso(sp('14:00')) });
    assert.equal(avanca(p, sp('17:00'), { emAndamento: true, terminos: [] }), p);
  });
  await passo('consulta encerrada estende o período conhecido: 60 min contados do término', () => {
    const p = base({ presenceLastActivityAt: iso(sp('14:00')) });
    const c = { emAndamento: false, terminos: [sp('15:40')] };
    assert.equal(avanca(p, sp('16:39'), c), p);
    assert.ok(avanca(p, sp('16:40'), c).presenceConfirmation);
  });
  await passo('sem período conhecido (folga) não inventa o fim da escala', () => {
    const p = base({ weeklySchedule: { quarta: 'Folga' }, presenceLastActivityAt: iso(sp('07:00')) });
    assert.equal(avanca(p, sp('23:00')), p);
  });
  await passo('pedido antigo de 15 minutos não é executado: é refeito pela regra de 60', () => {
    const velho = base({ presenceLastActivityAt: iso(sp('14:00')), presenceConfirmation: { reason: 'inactivity', requestedAt: iso(sp('15:00')), deadlineAt: iso(sp('15:05')), idleTimeoutMs: 900_000 } });
    const q = avanca(velho, sp('16:00'));
    assert.equal(q.shiftStatus, 'Disponível'); assert.equal(q.presenceConfirmation.idleTimeoutMs, 3_600_000); assert.equal(q.presenceConfirmation.requestedAt, iso(sp('16:00')));
  });
  await passo('virada 06h: quem ficou offline com pedido de ontem não precisa reconfirmar turno que não começou hoje; retorno declarado mantém', () => {
    const ontem = base({ shiftStatus: 'Offline', online: false, presenceConfirmation: { reason: 'manual', requestedAt: iso(sp('20:00', '2026-11-03')), offlineAt: iso(sp('20:00', '2026-11-03')) } });
    assert.equal(dom.avancarConfirmacao(ontem, undefined, {}, DATA, sp('07:00')).presenceConfirmation, undefined);
    const volta = { ...ontem, shiftExit: 'return', expectedReturn: iso(sp('10:00')) };
    assert.ok(dom.avancarConfirmacao(volta, undefined, {}, DATA, sp('07:00')).presenceConfirmation);
  });
  await passo('virada 06h sem confirmar: o perfil de ontem ainda usa a escala de ontem (terça: 22h às 6h)', () => {
    const p = base({ weeklySchedule: { terca: '22h às 6h' }, presenceDate: '2026-11-03', presenceConfirmedAt: iso(sp('21:50', '2026-11-03')), shiftAvailableSince: iso(sp('21:50', '2026-11-03')), presenceLastActivityAt: iso(sp('05:30')) });
    assert.equal(dom.avancarConfirmacao(p, undefined, {}, DATA, sp('06:30')), p, 'antes de 60 min do fim do turno (06:00)');
    assert.ok(dom.avancarConfirmacao(p, undefined, {}, DATA, sp('07:00')).presenceConfirmation);
  });
  await passo('exceção do dia vence a escala semanal (turno encurtado antecipa o pedido)', () => {
    const exc = { 'osiris@2026-11-04': { todayHours: '9h às 12h', periods: [{ start: '09:00', end: '12:00' }], note: '', updatedAt: '2026-11-03T10:00:00', absenceType: 'Nenhuma', startDate: DATA, endDate: DATA } };
    const p = base({ presenceLastActivityAt: iso(sp('11:00')) });
    assert.equal(dom.avancarConfirmacao(p, undefined, exc, DATA, sp('12:59')), p);
    assert.ok(dom.avancarConfirmacao(p, undefined, exc, DATA, sp('13:00')).presenceConfirmation);
  });

  console.log('Domínio: declaração de turno e confirmação');
  const ator = { id: 'u-1', name: 'Osíris' };
  await passo('confirmar presença: Disponível, carimbos do servidor, limpa pausa/retorno/pedido e acrescenta histórico', () => {
    const off = base({ shiftStatus: 'Offline', online: false, shiftAvailableSince: undefined, presenceConfirmedAt: undefined, shiftExit: 'ended', pauseReason: 'Refeição', presenceConfirmation: { reason: 'manual', requestedAt: iso(sp('08:00')), offlineAt: iso(sp('08:00')) } });
    const q = dom.confirmarPresenca(off, DATA, ator, sp('08:55'));
    assert.equal(q.shiftStatus, 'Disponível'); assert.equal(q.presenceConfirmation, undefined); assert.equal(q.shiftExit, undefined); assert.equal(q.pauseReason, undefined);
    assert.equal(q.presenceConfirmedAt, iso(sp('08:55'))); assert.equal(q.shiftAvailableSince, iso(sp('08:55'))); assert.equal(q.presenceLastActivityAt, iso(sp('08:55')));
    const h = q.presenceHistory.at(-1);
    assert.deepEqual([h.actorId, h.actorName, h.date, h.before, h.after], ['u-1', 'Osíris', DATA, 'Offline · Offline · atendimento após confirmar disponibilidade', 'Disponível · Disponível para atender']);
  });
  await passo('confirmar de novo quem já está Disponível mantém o "desde quando"', () => {
    const p = base();
    assert.equal(dom.confirmarPresenca(p, DATA, ator, sp('10:00')).shiftAvailableSince, p.shiftAvailableSince);
  });
  await passo('pausa com motivo e retorno previsto; "Não disse" não prevê retorno; pausa longa demais é recusada', () => {
    const agora = sp('10:00');
    const a = dom.mudarPresenca(base(), { shiftStatus: 'Em pausa', pauseReason: 'Refeição', expectedReturn: iso(agora + 30 * MIN), confirmation: 'none' }, DATA, ator, agora);
    assert.equal(a.shiftStatus, 'Em pausa'); assert.equal(a.pauseReason, 'Refeição'); assert.equal(a.expectedReturn, iso(agora + 30 * MIN)); assert.equal(a.shiftAvailableSince, undefined);
    assert.match(a.presenceHistory.at(-1).after, /^Pausa · Refeição · retorno previsto às \d{2}:\d{2}$/);
    const b = dom.mudarPresenca(base(), { shiftStatus: 'Em pausa', pauseReason: 'Não disse', expectedReturn: iso(agora + 30 * MIN), confirmation: 'none' }, DATA, ator, agora);
    assert.equal(b.expectedReturn, undefined);
    assert.throws(() => dom.mudarPresenca(base(), { shiftStatus: 'Em pausa', pauseReason: 'Refeição', expectedReturn: iso(agora + 2000 * MIN), confirmation: 'none' }, DATA, ator, agora), (e) => e instanceof ret.RegraPresencaError && /entre 1 e 1440/.test(e.message));
  });
  await passo('Offline com saída "return" guarda retorno e janela; pedido manual da equipe vs próprio', () => {
    const agora = sp('15:10');
    const eq = dom.mudarPresenca(base(), { shiftStatus: 'Offline', shiftExit: 'return', expectedReturn: iso(sp('18:00')), returnUntil: iso(sp('22:00')), confirmation: 'manual' }, DATA, ator, agora);
    assert.equal(eq.shiftStatus, 'Offline'); assert.equal(eq.shiftExit, 'return'); assert.equal(eq.presenceScheduleUpdatedAt, iso(agora));
    assert.deepEqual(eq.presenceConfirmation, { reason: 'manual', requestedAt: iso(agora), offlineAt: iso(agora) });
    const proprio = dom.mudarPresenca(base(), { shiftStatus: 'Offline', shiftExit: 'ended', confirmation: 'none' }, DATA, ator, agora);
    assert.equal(proprio.presenceConfirmation, undefined); assert.equal(proprio.presenceHistory.at(-1).after, 'Offline por hoje · Offline · atendimento após confirmar disponibilidade');
  });
  await passo('informar retorno mantém o pedido pendente já offline (confirmation "keep")', () => {
    const pend = base({ presenceConfirmation: { reason: 'inactivity', requestedAt: iso(sp('16:00')), deadlineAt: iso(sp('16:05')), idleTimeoutMs: 3_600_000 } });
    const q = dom.mudarPresenca(pend, { shiftStatus: 'Offline', shiftExit: 'return', expectedReturn: iso(sp('19:00')), confirmation: 'keep' }, DATA, ator, sp('16:02'));
    assert.equal(q.presenceConfirmation.reason, 'inactivity'); assert.equal(q.presenceConfirmation.offlineAt, iso(sp('16:02')));
  });
  await passo('previsão de retorno: próximo turno, exata, hoje já passou e término antes do retorno (mensagens do front)', () => {
    const p = base({ weeklySchedule: { quarta: '9h às 15h', quinta: '10h às 18h' } });
    const prox = ret.resolverRetorno(p, {}, DATA, sp('16:00'), { kind: 'next-shift' });
    assert.deepEqual(prox.forecast, { kind: 'next-shift', date: '2026-11-05', scheduleDate: '2026-11-05', time: '10:00', endTime: '18:00', endDate: '2026-11-05' });
    assert.equal(prox.expectedReturn, iso(sp('10:00', '2026-11-05')));
    const ex = ret.resolverRetorno(p, {}, DATA, sp('16:00'), { kind: 'exact', date: DATA, time: '19:00', endTime: '22:00' });
    assert.equal(ex.expectedReturn, iso(sp('19:00'))); assert.equal(ex.returnUntil, iso(sp('22:00')));
    assert.throws(() => ret.resolverRetorno(p, {}, DATA, sp('16:00'), { kind: 'exact', date: DATA, time: '15:00' }), /Esse horário já passou\. Confira a data e informe um horário futuro\./);
    assert.throws(() => ret.resolverRetorno(p, {}, DATA, sp('16:00'), { kind: 'exact', date: DATA, time: '19:00', endTime: '18:00' }), /O término deve ser depois do retorno\./);
    assert.equal(ret.resumoDoRetorno(prox.forecast), 'Volta no próximo turno, às 10h · 05/11/2026 · atende até 18h');
  });

  console.log('Ouro gerado do código do front (scripts/gerar-ouro-gf-presenca.js)');
  const { CENARIOS } = r('scripts/apoio-gf-presenca/cenarios');
  const ouro = r('scripts/apoio-gf-presenca/ouro-presenca-front.json').cenarios;
  const CAMPOS = ['shiftStatus', 'shiftExit', 'pauseReason', 'expectedReturn', 'returnUntil', 'returnForecast', 'presenceDate', 'presenceLastActivityAt', 'presenceConfirmedAt',
    'presenceScheduleUpdatedAt', 'presenceConfirmedPeriod', 'presenceConfirmation', 'shiftAvailableSince', 'presenceHistory'];
  const recorte = (p) => {
    const o = Object.fromEntries(CAMPOS.filter((c) => p[c] !== undefined).map((c) => [c, p[c]]));
    if (o.presenceHistory) o.presenceHistory = o.presenceHistory.map((h) => ({ ...h, id: h.id.startsWith('presence-idle-') ? h.id : '#' }));
    return JSON.parse(JSON.stringify(o));
  };
  await passo(`o porte reproduz os ${CENARIOS.length} cenários do front (avançar, confirmar, mudar, previsão de retorno), com as mesmas recusas`, () => {
    assert.equal(ouro.length, CENARIOS.length, 'ouro desatualizado: rode scripts/gerar-ouro-gf-presenca.js');
    CENARIOS.forEach((c, i) => {
      const esperado = ouro[i];
      assert.equal(esperado.nome, c.nome);
      let obtido;
      try {
        if (c.tipo === 'avancar') obtido = { perfil: recorte(dom.avancarConfirmacao(c.perfil, c.consultasApi, c.excecoes, c.data, c.agora)) };
        else if (c.tipo === 'confirmar') obtido = { perfil: recorte(dom.confirmarPresenca(c.perfil, c.data, c.ator, c.agora)) };
        else if (c.tipo === 'mudar') obtido = { perfil: recorte(dom.mudarPresenca(c.perfil, c.api, c.data, c.ator, c.agora, c.excecoes)) };
        else obtido = { retorno: JSON.parse(JSON.stringify(ret.resolverRetorno(c.perfil, c.excecoes, c.data, c.agora, c.entrada))) };
      } catch (e) { obtido = { erro: e.message }; }
      const { nome: _nome, ...resto } = esperado;
      assert.deepEqual(obtido, resto, `cenário "${c.nome}"`);
    });
  });

  console.log('Validação');
  const corpo = (extra = {}) => ({ operationKey: 'chave-0001', expectedRevision: '0', shiftStatus: 'Offline', ...extra });
  await passo('aceita as declarações de turno do front e recusa o que contradiz o estado', () => {
    val.corpoStatus(corpo());
    val.corpoStatus(corpo({ shiftStatus: 'Em pausa', pauseReason: 'Volta logo', expectedReturn: '2026-11-04T18:00:00.000Z' }));
    val.corpoStatus(corpo({ shiftExit: 'return', expectedReturn: '2026-11-04T18:00:00.000Z', returnUntil: '2026-11-04T22:00:00.000Z', returnForecast: { kind: 'next-shift', date: '2026-11-05', time: '10:00', endTime: '18:00' }, confirmation: 'keep' }));
    rejeita(() => val.corpoStatus(corpo({ shiftStatus: 'Sumiu' })), 400, 'INVALID_INPUT');
    rejeita(() => val.corpoStatus(corpo({ shiftStatus: 'Disponível', shiftExit: 'ended' })), 400, 'INVALID_INPUT');
    rejeita(() => val.corpoStatus(corpo({ pauseReason: 'Refeição' })), 400, 'INVALID_INPUT');
    rejeita(() => val.corpoStatus(corpo({ expectedReturn: 'amanhã' })), 400, 'INVALID_INPUT');
    rejeita(() => val.corpoStatus(corpo({ operationKey: 'curta' })), 400, 'INVALID_INPUT');
    rejeita(() => val.corpoStatus(corpo({ expectedRevision: undefined })), 400, 'INVALID_INPUT');
    rejeita(() => val.corpoStatus(corpo({ shiftExit: 'return', expectedReturn: '2026-11-04T18:00:00.000Z', returnUntil: '2026-11-04T17:00:00.000Z' })), 422, 'RULE_VIOLATION');
  });
  await passo('o cliente não escolhe ator, histórico nem carimbos: campos extras são ignorados', () => {
    const c = val.corpoStatus(corpo({ presenceHistory: [{ id: 'x' }], presenceConfirmedAt: '2020-01-01T00:00:00.000Z', actorName: 'Outro' }));
    assert.deepEqual(Object.keys(c).sort(), ['confirmation', 'expectedRevision', 'operationKey', 'shiftStatus']);
  });

  console.log('Gate e sessão');
  const { criarGate } = r('src/gestao-fadas/gate');
  const { presencaLigada } = r('src/gestao-fadas/gate/rotas-presenca');
  let sessao = { status: 'absent' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => sessao }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const url = (p) => `http://127.0.0.1:${srv.address().port}/api${p}`;
  const chamar = async (metodo, p, corpoJson) => {
    const resp = await fetch(url(p), { method: metodo, headers: { 'content-type': 'application/json' }, body: corpoJson === undefined ? undefined : JSON.stringify(corpoJson) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, h: resp.headers };
  };
  const antes = process.env.GF_FATIA_PRESENCA;
  try {
    await passo('flag lida de GF_FATIA_PRESENCA (só "true" liga)', () => {
      assert.equal(presencaLigada({ GF_FATIA_PRESENCA: 'true' }), true);
      assert.equal(presencaLigada({ GF_FATIA_PRESENCA: '1' }), false);
      assert.equal(presencaLigada({}), false);
    });
    delete process.env.GF_FATIA_PRESENCA;
    await passo('fatia desligada: /presence responde 404 NOT_FOUND no formato da B, antes da sessão', async () => {
      const x = await chamar('GET', '/presence');
      assert.equal(x.status, 404); assert.equal(x.j.error.code, 'NOT_FOUND'); assert.equal(x.h.get('cache-control'), 'no-store');
    });
    process.env.GF_FATIA_PRESENCA = 'true';
    await passo('ligada, sem sessão: 401 SESSION_REQUIRED; método errado: 405 com Allow (antes da sessão)', async () => {
      const a = await chamar('GET', '/presence');
      assert.equal(a.status, 401); assert.equal(a.j.error.code, 'SESSION_REQUIRED');
      const b = await chamar('POST', '/presence');
      assert.equal(b.status, 405); assert.equal(b.h.get('allow'), 'GET');
      const c = await chamar('GET', '/presence/osiris/status');
      assert.equal(c.status, 405); assert.equal(c.h.get('allow'), 'POST');
    });
    await passo('taróloga sem tarotId na sessão (sem Specialist com slug): 403 ACCESS_DENIED na leitura', async () => {
      sessao = { status: 'identity', identity: { userId: 'u-1', role: 'tarologa', displayName: 'Osíris' }, sessionId: 's1' };
      const a = await chamar('GET', '/presence');
      assert.equal(a.status, 403); assert.equal(a.j.error.code, 'ACCESS_DENIED');
    });
  } finally {
    if (antes === undefined) delete process.env.GF_FATIA_PRESENCA; else process.env.GF_FATIA_PRESENCA = antes;
    srv.close();
  }

  await passo('sessão nativa: tarotId da taróloga vem do slug do Specialist (e só dela); realFeatures.presence só com a flag', async () => {
    const { criarProvedorNativo } = r('src/gestao-fadas/gate/sessao-nativa');
    const jwt = require('jsonwebtoken');
    const { ACCESS_COOKIE } = r('src/features/auth/auth.cookies.helper');
    const { jwtVerifyOptions } = r('src/config/auth.config');
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste-presenca-1234567890-abcdef';
    const usuarios = { 't-1': { id: 't-1', email: 'osiris@x.test', role: 'TAROLOGA', is_active: true }, 'a-1': { id: 'a-1', email: 'adm@x.test', role: 'GESTORA', is_active: true } };
    const servicos = {
      buscarUsuario: async (id) => usuarios[id], temSessaoViva: async () => true,
      carregarContexto: async (id) => ({ roleIds: id === 'a-1' ? ['admin'] : [], staffProfile: null }),
      buscarTarotId: async (id) => (id === 't-1' ? 'osiris' : 'nao-deveria'),
    };
    const opcoes = jwtVerifyOptions();
    const token = (sub) => jwt.sign({ sub, token_use: 'access', account_type: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h', ...(opcoes.issuer ? { issuer: opcoes.issuer } : {}), ...(opcoes.audience ? { audience: opcoes.audience } : {}) });
    const req = (sub) => ({ headers: { cookie: `${ACCESS_COOKIE}=${token(sub)}` } });
    const lig = criarProvedorNativo({ servicos, env: { GF_FATIA_PRESENCA: 'true' } });
    const t = await lig.sessao(req('t-1'));
    assert.equal(t.status, 200, t.corpo);
    const corpoT = JSON.parse(t.corpo);
    assert.equal(corpoT.identity.tarotId, 'osiris'); assert.equal(corpoT.realFeatures.presence, true);
    assert.equal((await lig.validar(req('t-1'))).identity.tarotId, 'osiris');
    const corpoA = JSON.parse((await lig.sessao(req('a-1'))).corpo);
    assert.ok(!('tarotId' in corpoA.identity), 'equipe não tem tarotId');
    const desl = criarProvedorNativo({ servicos, env: { GATE_SESSAO: 'nativa' } });
    const corpoD = JSON.parse((await desl.sessao(req('t-1'))).corpo);
    assert.ok(!('presence' in corpoD.realFeatures), 'sem a flag o campo não aparece');
  });
}

async function comBanco() {
  const banco = pg.nomeBanco('prs');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-presenca', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_prs_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_prs_* restante).');
  }
  return codigo;
}

(async () => {
  await offline();
  console.log(`\nOffline: ${ok} ok, ${falhas.length} falhas`);
  if (falhas.length) process.exit(1);
  if (process.argv.includes('--offline')) process.exit(0);
  process.exit(await comBanco());
})().catch((e) => { console.error(e); process.exit(2); });
