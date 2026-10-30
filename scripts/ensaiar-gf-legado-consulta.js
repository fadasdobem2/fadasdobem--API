'use strict';

/**
 * ENSAIO do espelho de `tbl_consultas` no banco de DEV (fadasdobem01), numa transação que NUNCA confirma (ROLLBACK no fim).
 * Recusa qualquer banco que não seja de desenvolvimento (nome terminando em 01/dev/teste, e nunca `fadasdobem`).
 *
 * ACHADO que molda o ensaio: `tbl_consultas` é MyISAM (inclusive no dev) e o ROLLBACK não desfaz escrita em MyISAM. Por isso o
 * adaptador (`emEnsaio`) coloca, SÓ nesta sessão, uma cópia TEMPORÁRIA InnoDB no lugar da tabela; a tabela de verdade não recebe
 * nada. O ensaio prova isso por uma SEGUNDA conexão (contagem, maior id e próximo AUTO_INCREMENT iguais antes e depois) e faz
 * INSERT, UPDATE, leitura de volta e ROLLBACK. O interruptor GF_LEGADO_ESCRITA_ENABLED NÃO é ligado (e não precisa).
 *
 *   node scripts/ensaiar-gf-legado-consulta.js --cnf=<arquivo.cnf> --secao=client-dev
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const mysql = require('mysql2/promise');
const raiz = path.join(__dirname, '..');
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);

const cfg = (function configurar() {
  let sec; const c = {};
  for (const l of fs.readFileSync(arg('cnf'), 'utf8').split('\n')) {
    const m = l.match(/^\[(.+)\]$/); if (m) { sec = m[1]; c[sec] = {}; continue; }
    const k = l.match(/^\s*(\w+)\s*=\s*(.*)$/); if (k && sec) c[sec][k[1]] = k[2].trim().replace(/^["']|["']$/g, '');
  }
  const d = c[arg('secao') || 'client-dev'];
  if (!d) { console.error('Seção não encontrada'); process.exit(2); }
  if (!/(01|dev|teste)$/i.test(d.database) || /^fadasdobem$/i.test(d.database)) { console.error('Recusado: não é banco de desenvolvimento.'); process.exit(2); }
  Object.assign(process.env, { LEGADO_DB_HOST: d.host, LEGADO_DB_PORT: d.port, LEGADO_DB_NAME: d.database, LEGADO_DB_USER: d.user, LEGADO_DB_PASSWORD: d.password });
  delete process.env.GF_LEGADO_ESCRITA_ENABLED;
  return d;
}());

const legado = require(path.join(raiz, 'src/gestao-fadas/legado-escrita'));
const { CENARIOS, T, base, iniciada } = require('./apoio-gf-consulta/cenarios');
void CENARIOS;

let ok = 0; const falhas = [];
async function passo(nome, fn) {
  try { const r = await fn(); ok += 1; console.log(`  ok  ${nome}${r ? ` (${r})` : ''}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${e.codigo || e.name}: ${String(e.message).slice(0, 220)}`); }
}

/** Segunda conexão, de LEITURA: a visão de quem não está dentro do ensaio. */
async function fotografia() {
  const x = await mysql.createConnection({ host: cfg.host, port: Number(cfg.port || 3306), user: cfg.user, password: cfg.password, database: cfg.database, dateStrings: true });
  try {
    const [[n]] = await x.query('SELECT COUNT(*) AS n, COALESCE(MAX(idConsulta), 0) AS max FROM tbl_consultas');
    const [[t]] = await x.query("SELECT auto_increment AS a, engine AS e FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'tbl_consultas'");
    const [[u]] = await x.query('SELECT COUNT(*) AS n FROM usuarios WHERE id = 900013');
    const [tar] = await x.query('SELECT idTarologo FROM tbl_tarologos ORDER BY idTarologo LIMIT 1');
    return { total: Number(n.n), maior: Number(n.max), proximo: Number(t.a), engine: t.e, cliente: Number(u.n), tarologo: tar[0] && Number(tar[0].idTarologo) };
  } finally { await x.end(); }
}

(async () => {
  const antes = await fotografia();
  console.log(`Banco de dev ${cfg.database}. tbl_consultas: ${antes.total} linhas, maior id ${antes.maior}, próximo AUTO_INCREMENT ${antes.proximo}, engine ${antes.engine}. Cliente 900013: ${antes.cliente}. Tarólogo de teste: ${antes.tarologo}`);
  assert.equal(antes.cliente, 1, 'cliente 900013 não existe no dev'); assert.ok(antes.tarologo);
  const agora = new Date(T(60));
  const itemAberto = base({ clientId: '900013', tarotId: String(antes.tarologo), observation: 'ensaio 🔮 nota interna', attendant: 'Atendente Ensaio', paymentProfile: 'Pré-paga' });

  let dentro = null;
  await legado.emEnsaio(async (ex) => {
    const estrutura = (await ex.execute('SELECT COUNT(*) AS n FROM tbl_consultas', []))[0][0].n;
    await passo('o ensaio roda numa cópia TEMPORÁRIA InnoDB vazia (a tabela de verdade é MyISAM e não desfaria o rollback)', async () => {
      assert.equal(Number(estrutura), 0, 'a cópia deveria começar vazia');
      const por = await fotografia(); assert.equal(por.total, antes.total, 'a segunda conexão não pode ver nada do ensaio');
      return `engine real ${antes.engine}`;
    });
    await passo('resolve o tarólogo por código numérico; login que não existe volta null (nunca chuta)', async () => {
      assert.equal(await legado.consultas.resolverTarologo(ex, String(antes.tarologo)), antes.tarologo);
      assert.equal(await legado.consultas.resolverTarologo(ex, 'login-que-nao-existe'), null);
    });
    let id;
    await passo('INSERT da consulta ABERTA: fimConsulta zerado, tmp 0, vlDesconto 0 (percentual), pré-paga = 8, sem emoji, varchar(25)', async () => {
      id = await legado.consultas.inserir(ex, itemAberto, antes.tarologo, agora);
      const l = await legado.consultas.ler(ex, id);
      assert.equal(l.idUsuario, 900013); assert.equal(l.idTarologo, antes.tarologo); assert.equal(l.fimConsulta, '0000-00-00 00:00:00'); assert.equal(Number(l.tmpConsulta), 0);
      assert.equal(Number(l.vlDesconto), 0); assert.equal(Number(l.vlBonus), 0); assert.equal(Number(l.idFormaPagto), 8); assert.equal(Number(l.idFormaConsulta), 6);
      assert.equal(l.obsConsulta, 'ensaio  nota interna'); assert.equal(l.nmuAtendente, 'Atendente Ensaio'); assert.equal(l.valor_consulta, '0.00'); assert.equal(Number(l.IDProdutoConsulta), 1);
      assert.match(l.iniConsulta, /^2026-11-10 11:00:00$/); return `idConsulta ${id}`;
    });
    await passo('UPDATE ao iniciar: iniConsulta passa para o horário do tarólogo; continua aberta', async () => {
      const n = await legado.consultas.atualizar(ex, id, { ...itemAberto, awaitingTarologistStart: false, tarologistStartedAt: T(2), startedAt: T(2) }, antes.tarologo, agora);
      assert.equal(n, 1); const l = await legado.consultas.ler(ex, id); assert.equal(l.iniConsulta, '2026-11-10 11:02:00'); assert.equal(l.fimConsulta, '0000-00-00 00:00:00');
    });
    await passo('"Finalizada pelo tarólogo" NÃO fecha a linha no legado (sem repasse até a conferência)', async () => {
      await legado.consultas.atualizar(ex, id, { ...itemAberto, awaitingTarologistStart: false, startedAt: T(2), tarologistStartedAt: T(2), status: 'Finalizada pelo tarólogo', endedAt: T(32), durationSeconds: 1800 }, antes.tarologo, agora);
      assert.equal((await legado.consultas.ler(ex, id)).fimConsulta, '0000-00-00 00:00:00');
    });
    await passo('UPDATE ao conferir (Concluída): fimConsulta, tmpConsulta em MINUTOS inteiros (ceil), valor_consulta decimal em texto, atendenteFinalizou', async () => {
      const fechada = { ...itemAberto, awaitingTarologistStart: false, startedAt: T(2), tarologistStartedAt: T(2), status: 'Concluída', endedAt: T(32), durationSeconds: 1801, minuteValue: 2.5, finishReview: { at: T(40), by: 'Khloe', reportSubmittedAt: T(32), reportedMinutes: 30, result: 'approved' } };
      assert.equal(await legado.consultas.atualizar(ex, id, fechada, antes.tarologo, agora), 1);
      const l = await legado.consultas.ler(ex, id);
      assert.equal(l.fimConsulta, '2026-11-10 11:32:00'); assert.equal(Number(l.tmpConsulta), 31); assert.equal(l.valor_consulta, '77.50'); assert.equal(l.atendenteFinalizou, 'Khloe');
      // Repetir é inofensivo (idempotência do UPDATE): mesmo estado, mesma linha.
      assert.equal(await legado.consultas.atualizar(ex, id, fechada, antes.tarologo, agora), 1);
      assert.deepEqual(await legado.consultas.ler(ex, id), l);
    });
    await passo('correção de tempo: UPDATE de tmpConsulta e fimConsulta; valor_consulta sem total novo mantém o do legado', async () => {
      const corrigida = { ...itemAberto, awaitingTarologistStart: false, startedAt: T(2), tarologistStartedAt: T(2), status: 'Concluída', endedAt: T(27), durationSeconds: 1500 };
      await legado.consultas.atualizar(ex, id, corrigida, antes.tarologo, agora);
      const l = await legado.consultas.ler(ex, id); assert.equal(Number(l.tmpConsulta), 25); assert.equal(l.fimConsulta, '2026-11-10 11:27:00'); assert.equal(l.valor_consulta, '77.50');
    });
    await passo('Devolvida: fecha a linha com 0 minutos e marca [Devolvida] na observação (o legado não tem coluna de situação)', async () => {
      const dev = await legado.consultas.inserir(ex, base({ id: 'c-ensaio-2', clientId: '900013', tarotId: String(antes.tarologo), observation: 'x', status: 'Devolvida', awaitingTarologistStart: false, endedAt: T(5), durationSeconds: 120 }), antes.tarologo, agora);
      const l = await legado.consultas.ler(ex, dev); assert.equal(Number(l.tmpConsulta), 0); assert.equal(l.obsConsulta, '[Devolvida] x'); assert.notEqual(l.fimConsulta, '0000-00-00 00:00:00');
    });
    await passo('UPDATE de outra cliente não acha a linha (WHERE idConsulta E idUsuario): 0 linhas mudadas', async () => {
      assert.equal(await legado.consultas.atualizar(ex, id, { ...itemAberto, clientId: '900014' }, antes.tarologo, agora), 0);
    });
    await passo('datas ruins são recusadas ANTES do SQL: ano 1999, ano 2999, texto inválido', async () => {
      for (const ruim of ['1999-01-01T00:00:00.000Z', '2999-01-01T00:00:00.000Z', 'ontem']) await assert.rejects(() => legado.consultas.inserir(ex, { ...itemAberto, startedAt: ruim, tarologistStartedAt: undefined, sentToTarologistAt: undefined }, antes.tarologo, agora), legado.mapeamento.MapeamentoError);
    });
    await passo('a allowlist recusa DELETE, DDL, UPDATE sem WHERE da cliente e outra tabela, no meio do ensaio', async () => {
      for (const sql of ['DELETE FROM tbl_consultas', 'DROP TABLE tbl_consultas', 'ALTER TABLE tbl_consultas ADD COLUMN x INT', 'UPDATE tbl_consultas SET tmpConsulta = 0', 'UPDATE usuarios SET saldo = 0 WHERE id = 900013', 'TRUNCATE tbl_consultas']) {
        await assert.rejects(() => ex.execute(sql, []), (e) => e.codigo === 'LEGADO_ESCRITA_RECUSADA', sql);
      }
    });
    dentro = Number((await ex.execute('SELECT COUNT(*) AS n FROM tbl_consultas', []))[0][0].n);
    await passo('dentro do ensaio a cópia tem as 2 linhas que o ensaio criou, e a segunda conexão continua sem ver nada', async () => {
      assert.equal(dentro, 2); const por = await fotografia(); assert.equal(por.total, antes.total);
    });
    // Reconciliação de órfãs (Maturacao/37): a leitura por chave natural, sobre a mesma cópia temporária.
    await passo('órfã: o INSERT confirma e o vínculo se perde; a busca por chave (cliente, tarólogo, dt, ini) acha EXATAMENTE a linha e nada além', async () => {
      const it = base({ id: 'c-orfa', clientId: '900013', tarotId: String(antes.tarologo), startedAt: T(20), sentToTarologistAt: T(20), observation: 'orfa' });
      const chave = { ...legado.chave.chaveDaIntencao(it, agora), idTarologo: antes.tarologo };
      assert.deepEqual(await legado.consultas.buscarCandidatas(ex, chave), []);
      const idOrfa = await legado.consultas.inserir(ex, it, antes.tarologo, agora);
      assert.deepEqual(await legado.consultas.buscarCandidatas(ex, chave), [idOrfa]);
      assert.deepEqual(await legado.consultas.buscarCandidatas(ex, { ...chave, iniConsulta: '2026-11-10 12:00:00' }), []);
      assert.deepEqual(await legado.consultas.buscarCandidatas(ex, { ...chave, idUsuario: 900014 }), []);
      // Adoção: UPDATE do estado atual (o tarólogo iniciou depois da queda) na MESMA linha, sem inserir outra.
      const n0 = await legado.consultas.contar(ex);
      assert.equal(await legado.consultas.atualizar(ex, idOrfa, { ...it, awaitingTarologistStart: false, tarologistStartedAt: T(2), startedAt: T(2) }, antes.tarologo, agora), 1);
      assert.equal(await legado.consultas.contar(ex), n0); assert.equal((await legado.consultas.ler(ex, idOrfa)).iniConsulta, '2026-11-10 11:02:00');
      return `órfã ${idOrfa}`;
    });
    await passo('duplicata: duas linhas com a mesma chave voltam as DUAS (o espelho então não decide sozinho); reexecução da busca é só leitura', async () => {
      const it = base({ id: 'c-dup', clientId: '900013', tarotId: String(antes.tarologo), startedAt: T(10), sentToTarologistAt: T(10), observation: 'dup' });
      const chave = { ...legado.chave.chaveDaIntencao(it, agora), idTarologo: antes.tarologo };
      const a = await legado.consultas.inserir(ex, it, antes.tarologo, agora); const b = await legado.consultas.inserir(ex, it, antes.tarologo, agora);
      const n = await legado.consultas.contar(ex);
      assert.deepEqual(await legado.consultas.buscarCandidatas(ex, chave), [a, b]); assert.deepEqual(await legado.consultas.buscarCandidatas(ex, chave), [a, b]);
      assert.equal(await legado.consultas.contar(ex), n);
    });
    await passo('a allowlist continua recusando variações da leitura de candidatas e qualquer escrita fora do adaptador', async () => {
      for (const q of ['SELECT idConsulta FROM tbl_consultas', `${legado.sql.SELECT_CANDIDATAS}; DELETE FROM tbl_consultas`, 'DELETE FROM tbl_consultas WHERE idConsulta = 1']) await assert.rejects(() => ex.execute(q, []), (e) => e.codigo === 'LEGADO_ESCRITA_RECUSADA', q);
    });
  });

  const depois = await fotografia();
  await passo('ROLLBACK: contagem, maior id e AUTO_INCREMENT da tabela de verdade IGUAIS antes e depois', async () => {
    assert.equal(depois.total, antes.total); assert.equal(depois.maior, antes.maior); assert.equal(depois.proximo, antes.proximo); assert.equal(depois.engine, antes.engine);
    return `${antes.total} = ${depois.total} linhas; próximo id ${antes.proximo} = ${depois.proximo}`;
  });
  await legado.fechar();
  console.log(`\nEnsaio: ${ok} ok, ${falhas.length} falhas (dentro do ensaio a cópia chegou a ${dentro} linhas; depois do ROLLBACK a tabela real segue com ${depois.total}).`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
