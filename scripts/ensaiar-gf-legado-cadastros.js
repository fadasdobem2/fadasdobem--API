'use strict';

/**
 * ENSAIO do espelho de CLIENTE (`usuarios`) e TARÓLOGO (`tbl_tarologos`) no banco de DEV (fadasdobem01), numa transação que NUNCA confirma
 * (ROLLBACK no fim), sobre cópias TEMPORÁRIAS InnoDB de cada tabela (`emEnsaio`, Maturacao/45): `tbl_tarologos` é MyISAM e o rollback não a
 * desfaria; `usuarios` é InnoDB mas também é trocada, para o ensaio nunca depender do engine. Recusa banco que não seja de desenvolvimento.
 * Uma SEGUNDA conexão (só leitura) fotografa as tabelas REAIS antes e depois (linhas, maior id, AUTO_INCREMENT, engine e CHECKSUM TABLE de
 * tudo): têm de ser IGUAIS. A flag GF_LEGADO_ESCRITA_ENABLED não é ligada (e não precisa).
 *   node scripts/ensaiar-gf-legado-cadastros.js --cnf=<arquivo.cnf> --secao=client-dev
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
  const antes = await fotografia();
  console.log(`Banco de dev ${cfg.database}. ANTES:\n       ${resumir(antes)}`);
  for (const t of TABELAS) assert.ok(antes[t].linhas > 0);

  await legado.emEnsaio(async (ex, leitura) => {
    const completa = async (tabela, chave, id) => (await leitura(`SELECT * FROM ${tabela} WHERE ${chave} = ${Number(id)}`))[0];
    await passo('o ensaio roda em cópias TEMPORÁRIAS InnoDB só com as linhas-semente; a segunda conexão não vê nada do ensaio', async () => {
      assert.equal((await legado.clientes.ler(ex, 900013)).id, 900013);
      const n = (await leitura('SELECT COUNT(*) AS n FROM usuarios'))[0].n; assert.equal(Number(n), IDS_USU.length);
      const m = (await leitura('SELECT COUNT(*) AS n FROM tbl_tarologos'))[0].n; assert.equal(Number(m), IDS_TAR.length);
      const por = await fotografia(); assert.deepEqual(por, antes);
      return `engine real: usuarios ${antes.usuarios.engine}, tbl_tarologos ${antes.tbl_tarologos.engine}`;
    });
    await passo('cliente: lê só nivel = 0 (a funcionária 990002 não aparece como cliente)', async () => {
      const c = await legado.clientes.ler(ex, 900013); assert.ok(c && c.id === 900013 && 'nome_id' in c && !('senha' in c) && !('cpf' in c));
      assert.equal(await legado.clientes.ler(ex, 990002), null); assert.equal(await legado.clientes.ler(ex, 987654321), null);
    });
    await passo('UPDATE de nome_id + whats + datanascimento: só essas colunas mudam (o resto da linha, incluindo horanascimento, cpf, saldo, nome2, fica igual)', async () => {
      const a = await completa('usuarios', 'id', 900013);
      const linha = legado.clientes.linhaDoCliente({ name: 'Ensaio Nome', whatsapp: '+55 11 90000-0000', birthDate: '05/03/1980' }, ['name', 'whatsapp', 'birthDate']);
      assert.equal(await legado.clientes.atualizar(ex, '900013', linha.colunas), 1);
      const d = await completa('usuarios', 'id', 900013);
      assert.equal(d.nome_id, 'Ensaio Nome'); assert.equal(d.whats, '+55 11 90000-0000'); assert.equal(d.datanascimento, '1980-03-05 00:00:00');
      for (const c of Object.keys(a)) if (!['nome_id', 'whats', 'datanascimento'].includes(c)) assert.deepEqual(d[c], a[c], `coluna ${c} mudou`);
      assert.equal(await legado.clientes.atualizar(ex, '900013', linha.colunas), 1); assert.deepEqual(await completa('usuarios', 'id', 900013), d); // repetir é inofensivo
    });
    await passo('UPDATE parcial (só nome2 vazio) e WhatsApp vazio gravam \'\' como o front; acentos preservados; nada de emoji passa pelo mapeamento', async () => {
      const l = legado.clientes.linhaDoCliente({ treatAs: '', whatsapp: '', name: 'João Ação' }, ['treatAs', 'whatsapp']);
      assert.equal(await legado.clientes.atualizar(ex, '900014', l.colunas), 1); const d = await completa('usuarios', 'id', 900014); assert.equal(d.nome2, ''); assert.equal(d.whats, ''); assert.equal(d.nome_id, 'Cliente Ficção 0014');
      assert.equal(await legado.clientes.atualizar(ex, '900014', { nome_id: 'João Ação' }), 1); assert.equal((await completa('usuarios', 'id', 900014)).nome_id, 'João Ação');
      assert.throws(() => legado.clientes.linhaDoCliente({ name: 'a🔮' }, ['name']), legado.mapeamento.MapeamentoError);
    });
    await passo('funcionária (nivel 2) e id inexistente: 0 linhas atingidas; a linha da equipe fica igual', async () => {
      const a = await completa('usuarios', 'id', 990002);
      assert.equal(await legado.clientes.atualizar(ex, '990002', { nome_id: 'Intruso' }), 0); assert.equal(await legado.clientes.atualizar(ex, '987654321', { nome_id: 'Intruso' }), 0);
      assert.deepEqual(await completa('usuarios', 'id', 990002), a);
    });
    await passo('tarólogo: nome -> nmuTarologo e situação -> ativo; nmcTarologo (login), status, vlCartao, Ramal, sexo e o resto ficam iguais', async () => {
      const a = await completa('tbl_tarologos', 'idTarologo', 9001);
      const l = legado.tarologos.linhaDoTarologo({ nome: ' Osíris Ensaio ', cadastro_ativo: false }, ['nome', 'cadastro_ativo']);
      assert.equal(await legado.tarologos.atualizar(ex, '9001', l.colunas), 1); const d = await completa('tbl_tarologos', 'idTarologo', 9001);
      assert.equal(d.nmuTarologo, 'Osíris Ensaio'); assert.equal(d.ativo, 0);
      for (const c of Object.keys(a)) if (!['nmuTarologo', 'ativo'].includes(c)) assert.deepEqual(d[c], a[c], `coluna ${c} mudou`);
      const so = legado.tarologos.linhaDoTarologo({ cadastro_ativo: true }, ['cadastro_ativo']); assert.equal(await legado.tarologos.atualizar(ex, '9001', so.colunas), 1);
      const d2 = await completa('tbl_tarologos', 'idTarologo', 9001); assert.equal(d2.ativo, 1); assert.equal(d2.nmuTarologo, 'Osíris Ensaio');
      assert.equal(await legado.tarologos.atualizar(ex, '9999', { ativo: 1 }), 0);
      assert.equal((await legado.tarologos.ler(ex, 9002)).nmuTarologo, (await completa('tbl_tarologos', 'idTarologo', 9002)).nmuTarologo); // outro tarólogo intacto
      await assert.rejects(() => leitura('DELETE FROM tbl_tarologos'), (e) => e.codigo === 'LEGADO_ESCRITA_RECUSADA'); await assert.rejects(() => leitura('SELECT 1; DELETE FROM usuarios'), (e) => e.codigo === 'LEGADO_ESCRITA_RECUSADA');
    });
    await passo('a allowlist recusa DELETE, DDL, INSERT, outras colunas/tabelas e UPDATE sem WHERE, no meio do ensaio', async () => {
      for (const sql of ['DELETE FROM usuarios', 'DELETE FROM tbl_tarologos WHERE idTarologo = 1', 'DROP TABLE usuarios', 'ALTER TABLE usuarios ADD COLUMN x INT', 'INSERT INTO usuarios (nome_id) VALUES (?)',
        'UPDATE usuarios SET senha = ? WHERE id = ? AND nivel = 0', 'UPDATE usuarios SET saldo = 0', 'UPDATE tbl_tarologos SET nmcTarologo = ? WHERE idTarologo = ?', 'UPDATE tbl_pagtoinformado SET vlPagtoInformado = 0 WHERE idPagtoInformado = 1']) {
        await assert.rejects(() => ex.execute(sql, []), (e) => e.codigo === 'LEGADO_ESCRITA_RECUSADA', sql);
      }
    });
  }, { tabelas: TABELAS, sementes: { usuarios: { coluna: 'id', valores: IDS_USU }, tbl_tarologos: { coluna: 'idTarologo', valores: IDS_TAR } } });

  const depois = await fotografia();
  console.log(`Banco de dev ${cfg.database}. DEPOIS:\n       ${resumir(depois)}`);
  await passo('tabelas REAIS idênticas antes e depois (linhas, maior id, AUTO_INCREMENT, engine, CHECKSUM TABLE), lidas por outra conexão', () => {
    assert.deepEqual(depois, antes); return `usuarios ${antes.usuarios.linhas} e tbl_tarologos ${antes.tbl_tarologos.linhas} linhas, iguais`;
  });
  await legado.fechar();
  console.log(`\nEnsaio: ${ok} ok, ${falhas.length} falhas`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e.codigo || e.name, String(e.message).slice(0, 300)); process.exit(2); });
