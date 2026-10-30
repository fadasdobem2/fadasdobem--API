'use strict';

/**
 * ENSAIO da TRAVA DA FICHA DO ASP (Maturacao/53) contra o esquema REAL do banco de DEV (fadasdobem01): a leitura, a decisão (a/b/c) e a REAPLICAÇÃO
 * (o UPDATE da allowlist) sobre cópias TEMPORÁRIAS InnoDB de `usuarios` e `tbl_tarologos` (`emEnsaio`; ROLLBACK de verdade; `tbl_tarologos` é MyISAM).
 * Prova o que só o MySQL real mostra: o formato em que `datanascimento`/`nome2`/`nome_id` voltam na leitura é comparável ao que gravamos. A "ficha do ASP"
 * é simulada com o mesmo UPDATE permitido. Uma SEGUNDA conexão (só leitura) fotografa as tabelas REAIS antes e depois (linhas, maior id, AUTO_INCREMENT,
 * engine, CHECKSUM TABLE): têm de ser IGUAIS.
 *   node scripts/ensaiar-gf-verificacao-legado.js --cnf=<arquivo.cnf> --secao=client-dev
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
  delete process.env.GF_LEGADO_ESCRITA_ENABLED; delete process.env.GF_LEGADO_CLIENTES; delete process.env.GF_LEGADO_TAROLOGOS;
  return d;
}());

const legado = require(path.join(raiz, 'src/gestao-fadas/legado-escrita'));
const TABELAS = ['usuarios', 'tbl_tarologos'];
const IDS_USU = [900013, 900014, 990002]; const IDS_TAR = [9001, 9002];

let ok = 0; const falhas = [];
async function passo(nome, fn) {
  try { const r = await fn(); ok += 1; console.log(`  ok  ${nome}${r ? ` (${r})` : ''}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${e.codigo || e.name}: ${String(e.message).slice(0, 260)}`); }
}

/** Segunda conexão, de LEITURA: a visão de quem não está dentro do ensaio. */
async function fotografia() {
  const x = await mysql.createConnection({ host: cfg.host, port: Number(cfg.port || 3306), user: cfg.user, password: cfg.password, database: cfg.database, dateStrings: true });
  const f = {};
  try {
    for (const t of TABELAS) {
      const chave = t === 'usuarios' ? 'id' : 'idTarologo';
      const [[n]] = await x.query('SELECT COUNT(*) AS n, COALESCE(MAX(??), 0) AS max FROM ??', [chave, t]);
      const [[i]] = await x.query('SELECT auto_increment AS a, engine AS e FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [t]);
      const [[s]] = await x.query('CHECKSUM TABLE ??', [t]);
      f[t] = { linhas: Number(n.n), maior: Number(n.max), proximo: Number(i.a), engine: i.e, checksum: String(s.Checksum) };
    }
  } finally { await x.end(); }
  return f;
}
const resumir = (f) => TABELAS.map((t) => `${t}: ${f[t].linhas} linhas, maior id ${f[t].maior}, AUTO_INCREMENT ${f[t].proximo}, ${f[t].engine}, checksum ${f[t].checksum}`).join('\n       ');

(async () => {
  const { decidir } = require(path.join(raiz, 'src/gestao-fadas/legado-escrita/verificacao'));
  const antes = await fotografia();
  console.log(`Banco de dev ${cfg.database}. ANTES:\n       ${resumir(antes)}`);
  for (const t of TABELAS) assert.ok(antes[t].linhas > 0);

  await legado.emEnsaio(async (ex, leitura) => {
    const completa = async (tabela, chave, id) => (await leitura(`SELECT * FROM ${tabela} WHERE ${chave} = ${Number(id)}`))[0];
    const conferir = async (id, coluna, antigo, novo, reaplicada = false) => { const l = await legado.clientes.ler(ex, id); return decidir({ atual: l ? l[coluna] : null, antigo, novo, reaplicada, existe: Boolean(l) }); };
    for (const [coluna, valorNovo, entrada] of [['nome_id', 'Ensaio Trava Nome', { name: 'Ensaio Trava Nome' }], ['nome2', 'Ensaio Trata', { treatAs: 'Ensaio Trata' }], ['datanascimento', '1980-03-05 00:00:00', { birthDate: '05/03/1980' }]]) {
      await passo(`cliente ${coluna}: (a) igual lido do MySQL real = ok; (b) a ficha regrava o antigo = reaplica com o UPDATE da allowlist e confere; de novo = divergente; (c) outro valor = divergente`, async () => {
        const campo = Object.keys(entrada)[0];
        const a0 = await completa('usuarios', 'id', 900013); const antigo = a0[coluna];
        const gravar = (colunas) => legado.clientes.atualizar(ex, '900013', colunas);
        await gravar(legado.clientes.linhaDoCliente(entrada, [campo]).colunas); // o painel grava
        assert.equal((await conferir(900013, coluna, antigo, valorNovo)).acao, 'ok');
        await gravar({ [coluna]: antigo }); // "ficha do ASP" regrava o valor antigo (mesmo UPDATE permitido)
        assert.equal((await completa('usuarios', 'id', 900013))[coluna], antigo);
        const d = await conferir(900013, coluna, antigo, valorNovo); assert.equal(d.acao, 'reaplicar');
        assert.equal(await gravar({ [coluna]: valorNovo }), 1); // reaplicação
        assert.equal((await conferir(900013, coluna, antigo, valorNovo, true)).acao, 'ok');
        await gravar({ [coluna]: antigo }); assert.equal((await conferir(900013, coluna, antigo, valorNovo, true)).tipo, 'voltou_ao_valor_antigo_de_novo');
        const outro = coluna === 'datanascimento' ? '1991-12-31 00:00:00' : 'Outro Valor ASP'; await gravar({ [coluna]: outro });
        assert.equal((await conferir(900013, coluna, antigo, valorNovo)).tipo, 'valor_diferente');
        const d2 = await completa('usuarios', 'id', 900013); for (const c of Object.keys(a0)) if (c !== coluna) assert.deepEqual(d2[c], a0[c], `coluna ${c} mudou`);
        return `${coluna}: antigo "${antigo === null ? 'NULL' : String(antigo).slice(0, 4) + '…'}"`;
      });
    }
    await passo('cliente inexistente / funcionária (nivel 2): a leitura não acha e a decisão é divergente (sem_registro); reaplicar atinge 0 linhas', async () => {
      for (const id of [990002, 987654321]) { assert.equal(await legado.clientes.ler(ex, id), null); assert.equal((await conferir(id, 'nome_id', 'a', 'b')).tipo, 'sem_registro'); assert.equal(await legado.clientes.atualizar(ex, String(id), { nome_id: 'x' }), 0); }
    });
    await passo('tarólogo nmuTarologo (MyISAM): lê, compara e NUNCA reaplica (voltou ao antigo = divergente); a leitura traz o texto igual ao gravado', async () => {
      const a0 = await completa('tbl_tarologos', 'idTarologo', 9001); const antigo = a0.nmuTarologo;
      await legado.tarologos.atualizar(ex, '9001', { nmuTarologo: 'Ensaio Profissional' }); const l = await legado.tarologos.ler(ex, 9001);
      assert.equal(decidir({ atual: l.nmuTarologo, antigo, novo: 'Ensaio Profissional', reaplica: false }).acao, 'ok');
      await legado.tarologos.atualizar(ex, '9001', { nmuTarologo: antigo }); const l2 = await legado.tarologos.ler(ex, 9001);
      assert.equal(decidir({ atual: l2.nmuTarologo, antigo, novo: 'Ensaio Profissional', reaplica: false }).tipo, 'voltou_ao_valor_antigo_sem_reaplicar');
    });
    await passo('a trava não ganhou nenhuma instrução nova: só as da allowlist existente (DELETE/INSERT continuam recusados)', async () => {
      for (const sql of ['DELETE FROM usuarios WHERE id = 900013', 'INSERT INTO usuarios (nome_id) VALUES (?)', 'UPDATE usuarios SET whats = ?', 'UPDATE usuarios SET senha = ? WHERE id = ? AND nivel = 0']) await assert.rejects(() => ex.execute(sql, []), (e) => e.codigo === 'LEGADO_ESCRITA_RECUSADA', sql);
    });
  }, { tabelas: TABELAS, sementes: { usuarios: { coluna: 'id', valores: IDS_USU }, tbl_tarologos: { coluna: 'idTarologo', valores: IDS_TAR } } });

  const depois = await fotografia();
  console.log(`Banco de dev ${cfg.database}. DEPOIS:\n       ${resumir(depois)}`);
  await passo('tabelas REAIS idênticas antes e depois (linhas, maior id, AUTO_INCREMENT, engine, CHECKSUM TABLE), lidas por outra conexão', () => {
    assert.deepEqual(depois, antes); return `usuarios ${antes.usuarios.linhas} e tbl_tarologos ${antes.tbl_tarologos.linhas} linhas, iguais`;
  });
  await legado.fechar();
  console.log(`\nEnsaio da trava: ${ok} ok, ${falhas.length} falhas`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e.codigo || e.name, String(e.message).slice(0, 300)); process.exit(2); });
