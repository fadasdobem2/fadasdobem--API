'use strict';

/**
 * Verificação das fatias Agenda e Ordem da fila (Maturacao/28 seção 2; padrão em Maturacao/29).
 *   1) OFFLINE (sempre): domínio contra o OURO gerado do front (impressão `queue-v1`, item encerrado, foto do contato, próxima
 *      posição), regras com as mensagens do front, grupos de campos, decisão da ordem (supervisão vence atendente), validação das
 *      entradas, flag da fatia, gate desligado = 404, 401 sem sessão, 405 com Allow, formato de erro da B.
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): cria `fdb_agd_<aleatório>` em localhost:5432, migra por run-migrations, roda
 *      scripts/apoio-gf-agenda/filho.js (HTTP do gate, idempotência, 409, ordem, auditoria, perfis) e apaga o banco no fim.
 *      DB_* só no ambiente dos filhos; nunca lê o .env nem toca em outro banco.
 *   npm run verificar:gf-agenda            (completo)       node scripts/verificar-gf-agenda.js --offline   (sem banco; entra em verificar:legado)
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
  try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 260)}`); }
}
const lanca = (fn, tipo, mensagem) => assert.throws(fn, (e) => e instanceof tipo && (mensagem === undefined || e.message === mensagem), `esperava ${tipo.name} ${mensagem || ''}`);
const rejeita = (fn, status, codigo) => assert.throws(fn, (e) => e.statusCode === status && e.dados.codigo === codigo, `esperava ${status} ${codigo}`);

async function offline() {
  const contato = r('src/gestao-fadas/_comum/dominio/agenda-contato');
  const ordem = r('src/gestao-fadas/_comum/dominio/agenda-ordem');
  const delta = r('src/gestao-fadas/_comum/dominio/agenda-delta');
  const regras = r('src/gestao-fadas/_comum/dominio/agenda-regras');
  const val = r('src/gestao-fadas/features/agenda/agenda.validacao');
  const ouro = require('./apoio-gf-agenda/ouro-agenda.json');
  const item = (extra = {}) => ({ id: 'ag-1', tarotId: 'osiris', clientId: '900013', client: 'Cliente', date: '2026-11-10', time: '10:00', channel: 'WhatsApp', position: 1, response: 'Aguardando resposta', contact: { attempt: 1, date: '2026-11-10', tags: [] }, ...extra });
  const ator = { nome: 'Khloe', id: 'u1', perfil: 'atendente' };

  console.log('Ouro do front (30 filas)');
  await passo('queue-v1: a impressão sai IGUAL à do front em todos os casos', () => {
    ouro.casos.forEach((c, i) => assert.equal(ordem.revisaoDaFila(c.itens, c.tarotId), c.revisao, `caso ${i}`));
  });
  await passo('item encerrado, foto do contato e próxima posição saem IGUAIS ao front', () => {
    ouro.casos.forEach((c, i) => {
      c.itens.forEach((it, j) => {
        assert.equal(contato.encerrado(it), c.encerrados[j], `caso ${i} item ${j}`);
        assert.deepEqual(contato.limpar(contato.fotoDoContato(it)), contato.limpar(c.fotos[j]), `foto ${i}/${j}`);
      });
      assert.equal(contato.proximaPosicao(c.itens, c.tarotId, '2026-11-10', '2026-11-10'), c.proximaPosicao, `posição ${i}`);
    });
  });
  await passo('a revisão ignora contato e dinheiro e muda com posição, sobreposição e comando', () => {
    const a = item(); const b = item({ id: 'ag-2', position: 2 });
    const base = ordem.revisaoDaFila([a, b], 'osiris');
    assert.equal(ordem.revisaoDaFila([{ ...a, contact: { attempt: 3, date: '2026-11-11', tags: ['Avisada'] }, paymentPending: true }, b], 'osiris'), base);
    assert.notEqual(ordem.revisaoDaFila([{ ...a, position: 5 }, b], 'osiris'), base);
    assert.notEqual(ordem.revisaoDaFila([{ ...a, positionOverrides: { 'explicit:queue:osiris': 1 } }, b], 'osiris'), base);
    assert.notEqual(ordem.revisaoDaFila([{ ...a, orderCommand: { id: 'c1', queueKey: 'queue:osiris' } }, b], 'osiris'), base);
    assert.equal(ordem.revisaoDaFila([{ ...a, agendaOutcome: 'Cancelada' }, b], 'osiris'), ordem.revisaoDaFila([b], 'osiris'));
  });

  console.log('Ordem da fila: quem vence');
  const fila = [item({ id: 'a', position: 1 }), item({ id: 'b', position: 2 }), item({ id: 'c', position: 3 })];
  const comando = (extra) => ({ id: 'cmd', baseRevision: ordem.revisaoDaFila(fila, 'osiris'), actorRole: 'atendente', ...extra });
  const aplicada = (papel, id, base, lineage) => fila.map((i) => ({ ...i, orderCommand: { id, queueKey: 'queue:osiris', baseRevision: base, at: '2026-11-10T10:00:00.000Z', actorRole: papel, beforeIds: [], afterIds: [], ...(lineage ? { lineage } : {}) } }));
  await passo('revisão de base igual à atual: aplica (atendente ou gestão)', () => {
    assert.deepEqual(ordem.decidirOrdem(fila, 'osiris', comando()), { acao: 'aplicar' });
    assert.deepEqual(ordem.decidirOrdem(fila, 'osiris', comando({ actorRole: 'supervisora' })), { acao: 'aplicar' });
  });
  const base0 = ordem.revisaoDaFila(fila, 'osiris');
  const aposAtendente = aplicada('atendente', 'c-at', base0);
  await passo('atendente moveu antes; a SUPERVISÃO parte da mesma base e vence (substitui o da atendente)', () => {
    const d = ordem.decidirOrdem(aposAtendente, 'osiris', { id: 'c-sup', baseRevision: base0, actorRole: 'supervisora' });
    assert.equal(d.acao, 'aplicar'); assert.equal(d.substitui.id, 'c-at');
  });
  const aposSupervisao = aplicada('supervisora', 'c-sup', base0);
  await passo('supervisão moveu antes; a ATENDENTE parte da mesma base e é recusada (authority)', () => {
    assert.deepEqual(ordem.decidirOrdem(aposSupervisao, 'osiris', { id: 'c-at2', baseRevision: base0, actorRole: 'atendente' }), { acao: 'recusar', motivo: 'authority' });
  });
  await passo('duas atendentes na mesma base: a segunda é recusada (concurrent); duas da gestão também', () => {
    assert.deepEqual(ordem.decidirOrdem(aposAtendente, 'osiris', { id: 'c2', baseRevision: base0, actorRole: 'atendente' }), { acao: 'recusar', motivo: 'concurrent' });
    assert.equal(ordem.decidirOrdem(aposSupervisao, 'osiris', { id: 'c3', baseRevision: base0, actorRole: 'administradora' }).motivo, 'concurrent');
  });
  await passo('ordem POSTERIOR da atendente sobre a revisão atual (depois da supervisão) é aceita', () => {
    const atual = ordem.revisaoDaFila(aposSupervisao, 'osiris');
    assert.deepEqual(ordem.decidirOrdem(aposSupervisao, 'osiris', { id: 'c4', baseRevision: atual, actorRole: 'atendente' }), { acao: 'aplicar' });
  });
  await passo('revisão velha sem concorrência (fila andou) é recusada como stale; linhagem que desce da atual passa', () => {
    const outra = aplicada('supervisora', 'c-x', 'queue-v1:0:z');
    assert.equal(ordem.decidirOrdem(outra, 'osiris', { id: 'c5', baseRevision: 'queue-v1:9:velha', actorRole: 'atendente' }).motivo, 'stale');
    const atual = ordem.revisaoDaFila(outra, 'osiris');
    assert.equal(ordem.decidirOrdem(outra, 'osiris', { id: 'c6', baseRevision: 'queue-v1:9:velha', lineage: [{ id: 'p', baseRevision: atual }], actorRole: 'atendente' }).acao, 'aplicar');
  });

  console.log('Regras (mensagens do front)');
  await passo('prazo combinado: 1 a 1440, item aberto, só acrescenta, expectedLatestId confere', () => {
    const novo = (minutes, extra = {}) => ({ append: { requestedWaitHistory: [{ id: 'wait-1', minutes, at: '2026-11-10T10:00:00.000Z', by: 'x', attempt: 1, afterEventId: '', ...extra }] } });
    const ok1 = delta.aplicarDelta(item(), novo(30), 'prazo', ator);
    assert.equal(ok1.item.requestedWaitHistory[0].by, 'Khloe');
    assert.equal(ok1.eventos[0].tipo, 'prazo');
    lanca(() => delta.aplicarDelta(item(), novo(0), 'prazo', ator), regras.ErroDeRegra, 'Informe entre 1 e 1440 minutos.');
    lanca(() => delta.aplicarDelta(item(), novo(1441), 'prazo', ator), regras.ErroDeRegra, 'Informe entre 1 e 1440 minutos.');
    lanca(() => delta.aplicarDelta(item({ agendaOutcome: 'Cancelada' }), novo(30), 'prazo', ator), regras.ErroDeRegra, 'Este agendamento não está mais aguardando.');
    lanca(() => delta.aplicarDelta(item({ requestedWaitHistory: [{ id: 'w0', minutes: 10, at: 'x', by: 'y' }] }), novo(30), 'prazo', ator), regras.ErroDeVersao);
    lanca(() => delta.aplicarDelta(item({ requestedWaitHistory: [{ id: 'wait-1', minutes: 10, at: 'x', by: 'y' }] }), { ...novo(30), expectedLatestId: 'wait-1' }, 'prazo', ator), regras.ErroDeRegra, 'Esta ação já foi registrada.');
  });
  await passo('contato: etiqueta desconhecida recusada; encerrado só aceita "Pediu estorno"; expectedContact desatualizado é 409', () => {
    const ev = (tag, extra = {}) => ({ id: `e-${tag}`, actor: 'x', at: '2026-11-10T10:00:00.000Z', date: '2026-11-10', attempt: 1, tag, active: true, before: [], after: [tag], ...extra });
    const avisar = { set: { contact: { attempt: 1, date: '2026-11-10', tags: ['Avisada'] }, workflowStatus: 'Avisada' }, append: { contactHistory: [ev('Avisada')] } };
    const r1 = delta.aplicarDelta(item(), avisar, 'contato', ator);
    assert.equal(r1.item.contactHistory[0].actor, 'Khloe'); assert.deepEqual(r1.item.contact.tags, ['Avisada']);
    lanca(() => delta.aplicarDelta(item(), { append: { contactHistory: [ev('Inventada')] } }, 'contato', ator), regras.ErroDeRegra);
    const fechado = item({ agendaOutcome: 'Cancelada', contact: { attempt: 1, date: '2026-11-10', tags: ['Cancelada'] } });
    lanca(() => delta.aplicarDelta(fechado, avisar, 'contato', ator), regras.ErroDeRegra, 'Este agendamento já foi encerrado.');
    delta.aplicarDelta(fechado, { set: { refundRequest: { id: 'r', tarotId: 'osiris', actor: 'x', at: '2026-11-10T10:00:00.000Z' } }, append: { contactHistory: [ev('Pediu estorno')] } }, 'contato', ator);
    const foto = contato.fotoDoContato(item());
    delta.aplicarDelta(item(), { ...avisar, expectedContact: foto }, 'contato', ator);
    lanca(() => delta.aplicarDelta(item({ contact: { attempt: 2, date: '2026-11-10', tags: [] } }), { ...avisar, expectedContact: foto }, 'contato', ator), regras.ErroDeVersao);
    lanca(() => delta.aplicarDelta(item({ contact: { attempt: 3, date: '2026-11-10', tags: [] } }), { set: { contact: { attempt: 2, date: '2026-11-10', tags: [] } } }, 'contato', ator), regras.ErroDeRegra);
  });
  await passo('observações: add/edit/delete/restore na ordem do front; texto vazio e nota já mudada recusados', () => {
    const nota = (extra = {}) => ({ id: 'o1', text: 'Chamar às 20h', createdAt: '2026-11-10T10:00:00.000Z', createdBy: 'x', ...extra });
    const evento = (action, extra = {}) => ({ id: `ev-${action}`, observationId: 'o1', action, at: '2026-11-10T10:00:00.000Z', actor: 'x', ...extra });
    const add = delta.aplicarDelta(item(), { set: { observation: 'Chamar às 20h', observations: [nota()] }, append: { observationHistory: [evento('add', { after: 'Chamar às 20h' })] } }, 'observacoes', ator);
    assert.equal(add.item.observationHistory[0].actor, 'Khloe'); assert.equal(add.eventos[0].tipo, 'observacao');
    lanca(() => delta.aplicarDelta(item(), { set: { observations: [nota({ text: '  ' })] }, append: { observationHistory: [evento('add')] } }, 'observacoes', ator), regras.ErroDeRegra, 'Escreva a observação antes de salvar.');
    lanca(() => delta.aplicarDelta(add.item, { set: { observations: [nota()] }, append: { observationHistory: [evento('add', { id: 'outro' })] } }, 'observacoes', ator), regras.ErroDeRegra, 'Esta observação já existe.');
    lanca(() => delta.aplicarDelta(add.item, { set: { observations: [nota({ deletedAt: 'x' })] }, append: { observationHistory: [evento('restore', { id: 'r1' })] } }, 'observacoes', ator), regras.ErroDeRegra, 'Esta observação já mudou.');
    lanca(() => delta.aplicarDelta(add.item, { set: { observations: [] }, append: { observationHistory: [evento('delete', { id: 'd1' })] } }, 'observacoes', ator), regras.ErroDeRegra);
  });
  await passo('saídas: motivo e incidente da lista; transferência pede o tarólogo novo; remarcação pede o dia; cancelamento fecha o item', () => {
    const saida = (extra) => ({ id: 'd1', tarotId: 'osiris', date: '2026-11-10', originDate: '2026-11-10', actor: 'x', at: '2026-11-10T10:00:00.000Z', ...extra });
    const cancelar = { set: { agendaOutcome: 'Cancelada', contact: { attempt: 2, date: '2026-11-10', tags: ['Cancelada'] } }, append: { departures: [saida({ action: 'cancel', reason: 'Desistiu' })] } };
    assert.equal(delta.aplicarDelta(item(), cancelar, 'saidas', ator).item.departures[0].actor, 'Khloe');
    lanca(() => delta.aplicarDelta(item(), { ...cancelar, append: { departures: [saida({ action: 'cancel', reason: 'Remarcou amanhã' })] } }, 'saidas', ator), regras.ErroDeRegra, 'Escolha o resultado do cancelamento.');
    lanca(() => delta.aplicarDelta(item(), { append: { departures: [saida({ action: 'transfer', reason: 'Pediu outro tarólogo' })] } }, 'saidas', ator), regras.ErroDeRegra, 'Escolha o que o tarólogo verá.');
    lanca(() => delta.aplicarDelta(item(), { append: { departures: [saida({ action: 'reschedule', reason: 'Reagendou' })] } }, 'saidas', ator), regras.ErroDeRegra, 'Escolha uma data válida.');
    lanca(() => delta.aplicarDelta(item(), { append: { departures: [saida({ action: 'cancel', reason: 'Desistiu', incident: 'Inventado' })] } }, 'saidas', ator), regras.ErroDeRegra);
    const comCancel = item({ agendaOutcome: 'Cancelada', departures: [saida({ action: 'cancel', reason: 'Desistiu' })] });
    const rest = delta.aplicarDelta(comCancel, { restoreDepartures: ['d1'], unset: ['agendaOutcome'], set: { contact: { attempt: 2, date: '2026-11-10', tags: [] } } }, 'saidas', ator);
    assert.equal(rest.item.departures[0].restored, true); assert.ok(!('agendaOutcome' in rest.item));
  });
  await passo('resolução: só decisões manuais; as que vêm da consulta ainda não existem nesta fatia', () => {
    const res = (action) => ({ append: { resolutionHistory: [{ id: `r-${action}`, action, consultationId: 'c1', actor: 'x', createdAt: '2026-11-10T10:00:00.000Z', detail: 'd' }] } });
    delta.aplicarDelta(item(), res('Agendamento mantido'), 'resolucao', ator);
    delta.aplicarDelta(item(), res('Correspondência ignorada'), 'resolucao', ator);
    lanca(() => delta.aplicarDelta(item(), res('Agendamento concluído'), 'resolucao', ator), regras.ErroDeRegra);
  });
  await passo('grupos: campo fora do grupo, reservado ou obrigatório apagado é recusado; combinado de contato validado', () => {
    lanca(() => delta.aplicarDelta(item(), { set: { client: 'x' } }, 'contato', ator), regras.ErroDeRegra);
    lanca(() => delta.aplicarDelta(item(), { set: { publicNumber: 9 } }, 'agendamento', ator), regras.ErroDeRegra);
    lanca(() => delta.aplicarDelta(item(), { set: { positionOverrides: { 'explicit:queue:osiris': 1 } } }, 'agendamento', ator), regras.ErroDeRegra);
    lanca(() => delta.aplicarDelta(item(), { unset: ['date'] }, 'agendamento', ator), regras.ErroDeRegra);
    lanca(() => delta.aplicarDelta(item(), { set: { contactPlan: { who: 'staff', timing: 'exact' } } }, 'agendamento', ator), regras.ErroDeRegra, 'Informe um horário válido, como 20:00.');
    lanca(() => delta.aplicarDelta(item(), { set: { contactPlan: { who: 'ninguem', timing: 'none' } } }, 'agendamento', ator), regras.ErroDeRegra, 'Confira o combinado de contato.');
    const ok2 = delta.aplicarDelta(item(), { set: { contactPlan: { who: 'staff', timing: 'exact', time: '8h' }, scheduledTime: '08:00', tarotId: 'nyx', date: '2026-11-11' }, unset: ['positionOverrides'] }, 'agendamento', ator);
    assert.equal(ok2.item.contactPlan.time, '08:00'); assert.equal(ok2.item.tarotId, 'nyx');
    lanca(() => delta.aplicarDelta(item(), { append: { contactHistory: [{ id: 'x' }] } }, 'saidas', ator), regras.ErroDeRegra);
  });

  console.log('Validação das entradas');
  await passo('corpo de comando: operationKey 8 a 128, expectedVersion inteira, delta com forma certa', () => {
    val.corpoComando({ operationKey: 'chave-0001', expectedVersion: 1, set: { client: 'x' } });
    rejeita(() => val.corpoComando({ operationKey: 'curta', expectedVersion: 1 }), 400, 'INVALID_INPUT');
    rejeita(() => val.corpoComando({ operationKey: 'chave-0001' }), 400, 'INVALID_INPUT');
    rejeita(() => val.corpoComando({ operationKey: 'chave-0001', expectedVersion: 1, set: [] }), 400, 'INVALID_INPUT');
    rejeita(() => val.corpoComando({ operationKey: 'chave-0001', expectedVersion: 1, append: { contactHistory: 'x' } }), 400, 'INVALID_INPUT');
  });
  await passo('criação: id, tarólogo, cliente e dia obrigatórios; ordem: ranks e comando obrigatórios', () => {
    val.corpoCriacao({ operationKey: 'chave-0001', id: 'ag-1', tarotId: 'osiris', clientId: '900013', client: 'Cliente', date: '2026-11-10' });
    rejeita(() => val.corpoCriacao({ operationKey: 'chave-0001', id: 'ag-1', tarotId: 'osiris', clientId: '900013', client: 'Cliente', date: '2026-02-30' }), 400, 'INVALID_INPUT');
    rejeita(() => val.corpoCriacao({ operationKey: 'chave-0001', id: 'ag 1', tarotId: 'osiris', clientId: '900013', client: 'Cliente', date: '2026-11-10' }), 400, 'INVALID_INPUT');
    val.corpoOrdem({ operationKey: 'chave-0001', commandId: 'c', baseRevision: 'queue-v1:0:x', beforeIds: ['a'], afterIds: ['a'], ranks: { a: { 'explicit:queue:osiris': 1 } } });
    rejeita(() => val.corpoOrdem({ operationKey: 'chave-0001', commandId: 'c', baseRevision: 'x', beforeIds: [], afterIds: [], ranks: { a: { k: 0 } } }), 400, 'INVALID_INPUT');
    rejeita(() => val.corpoOrdem({ operationKey: 'chave-0001', baseRevision: 'x', beforeIds: [], afterIds: [], ranks: {} }), 400, 'INVALID_INPUT');
    assert.deepEqual(val.consulta({ includeClosed: 'false' }).incluirEncerrados, false);
    rejeita(() => val.consulta({ from: '2026-01-01', to: '2026-12-31' }), 400, 'INVALID_INPUT');
  });

  console.log('Gate');
  const { criarGate } = r('src/gestao-fadas/gate');
  const { agendaLigada } = r('src/gestao-fadas/gate/rotas-agenda');
  let sessao = { status: 'absent' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => sessao }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const chamar = async (metodo, p, corpoJson) => {
    const resp = await fetch(`http://127.0.0.1:${srv.address().port}/api${p}`, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpoJson === undefined ? undefined : JSON.stringify(corpoJson) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, h: resp.headers };
  };
  const antes = process.env.GF_FATIA_AGENDA;
  try {
    await passo('flag lida de GF_FATIA_AGENDA (só "true" liga)', () => {
      assert.equal(agendaLigada({ GF_FATIA_AGENDA: 'true' }), true);
      assert.equal(agendaLigada({ GF_FATIA_AGENDA: '1' }), false);
      assert.equal(agendaLigada({}), false);
    });
    delete process.env.GF_FATIA_AGENDA;
    await passo('fatia desligada: /agenda responde 404 NOT_FOUND no formato da B, antes da sessão', async () => {
      const x = await chamar('GET', '/agenda');
      assert.equal(x.status, 404); assert.equal(x.j.error.code, 'NOT_FOUND'); assert.equal(x.h.get('cache-control'), 'no-store');
      assert.equal((await chamar('POST', '/agenda/queues/osiris/order', {})).status, 404);
    });
    process.env.GF_FATIA_AGENDA = 'true';
    await passo('ligada, sem sessão: 401 SESSION_REQUIRED; método errado: 405 com Allow (antes da sessão)', async () => {
      const a = await chamar('GET', '/agenda');
      assert.equal(a.status, 401); assert.equal(a.j.error.code, 'SESSION_REQUIRED');
      assert.equal((await chamar('POST', '/agenda')).status, 401);
      const b = await chamar('DELETE', '/agenda');
      assert.equal(b.status, 405); assert.equal(b.h.get('allow'), 'GET, POST');
      const c = await chamar('GET', '/agenda/ag-1/contact');
      assert.equal(c.status, 405); assert.equal(c.h.get('allow'), 'POST');
      assert.equal((await chamar('PUT', '/agenda/ag-1')).h.get('allow'), 'PATCH');
    });
    await passo('taróloga (agenda própria é outra tela): 403 ACCESS_DENIED na leitura e na gravação', async () => {
      sessao = { status: 'identity', identity: { userId: 'u-1', role: 'tarologa', displayName: 'Osíris', tarotId: 'osiris' }, sessionId: 's1' };
      assert.equal((await chamar('GET', '/agenda')).status, 403);
      const g = await chamar('POST', '/agenda', { operationKey: 'chave-0001' });
      assert.equal(g.status, 403); assert.equal(g.j.error.code, 'ACCESS_DENIED');
    });
  } finally {
    if (antes === undefined) delete process.env.GF_FATIA_AGENDA; else process.env.GF_FATIA_AGENDA = antes;
    srv.close();
  }
}

async function comBanco() {
  const banco = pg.nomeBanco('agd');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-agenda', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_agd_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_agd_* restante).');
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
