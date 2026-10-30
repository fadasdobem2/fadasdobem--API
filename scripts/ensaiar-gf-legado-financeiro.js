'use strict';

/**
 * ENSAIO do espelho de PAGAMENTO INFORMADO, NOTA DA FICHA e STATUS DO TARÓLOGO no DEV (fadasdobem01), sobre cópias TEMPORÁRIAS InnoDB (Maturacao/45 e 46).
 * Tabelas reais intactas (linhas, maior id, AUTO_INCREMENT, CHECKSUM) provado por segunda conexão antes e depois. Sem DDL no legado.
 *   node scripts/ensaiar-gf-legado-financeiro.js --cnf=<arquivo.cnf> --secao=client-dev
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
const { MapeamentoError } = legado.mapeamento;
const TABELAS = { tbl_pagtoinformado: 'idPagtoInformado', obs_liberacao_consulta: 'id', tbl_tarologos: 'idTarologo', tbl_consultas: 'idConsulta' };

let ok = 0; const falhas = [];
async function passo(nome, fn) {
  try { const r = await fn(); ok += 1; console.log(`  ok  ${nome}${r ? ` (${r})` : ''}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${e.codigo || e.name}: ${String(e.message).slice(0, 260)}`); }
}
async function fotografia() {
  const x = await mysql.createConnection({ host: cfg.host, port: Number(cfg.port || 3306), user: cfg.user, password: cfg.password, database: cfg.database, dateStrings: true });
  const f = {};
  try {
    for (const [t, chave] of Object.entries(TABELAS)) {
      const [[n]] = await x.query('SELECT COUNT(*) AS n, COALESCE(MAX(??), 0) AS max FROM ??', [chave, t]);
      const [[i]] = await x.query('SELECT auto_increment AS a, engine AS e FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [t]);
      const [[s]] = await x.query('CHECKSUM TABLE ??', [t]);
      f[t] = { linhas: Number(n.n), maior: Number(n.max), proximo: Number(i.a), engine: i.e, checksum: String(s.Checksum) };
    }
  } finally { await x.end(); }
  return f;
}
const resumir = (f) => Object.keys(TABELAS).map((t) => `${t}: ${f[t].linhas} linhas, maior id ${f[t].maior}, AUTO_INCREMENT ${f[t].proximo}, ${f[t].engine}, checksum ${f[t].checksum}`).join('\n       ');
const base = { id: 'PG-ens', clientId: '900013', client: 'Cliente', amount: 120.5, method: 'Depósito', bank: 'Itaú', status: 'Informado', confirmation: 'A confirmar', paidAt: '2026-10-29', informedAt: '2026-10-30T15:00:00.000Z', authorization: 'AUT 123', note: 'Nota do pagamento' };

(async () => {
  const antes = await fotografia();
  console.log(`Banco de dev ${cfg.database}. ANTES:\n       ${resumir(antes)}`);
  await legado.emEnsaio(async (ex, leitura) => {
    const linha = async (t, c, id) => (await leitura(`SELECT * FROM ${t} WHERE ${c} = ${Number(id)}`))[0];
    await passo('pagamento (Depósito + Itaú): INSERT com as 9 colunas, id_status_pagto 1 (Não Confirmado; nunca 0), status de texto no padrão "informado", cartão/parcelas no padrão do banco', async () => {
      const c = legado.pagamentos.linhaDoPagamento(base, 'Khloe Atendente Demo Longa');
      const id = await legado.pagamentos.inserir(ex, c); const l = await linha('tbl_pagtoinformado', 'idPagtoInformado', id);
      assert.equal(Number(l.idUsuario), 900013); assert.equal(l.dtPagtoInformado, '2026-10-29 00:00:00'); assert.equal(l.vlPagtoInformado, '120.50'); assert.equal(Number(l.idBanco), 2); assert.equal(Number(l.idFormaPagto), 1);
      assert.equal(l.autPagtoInformado, 'AUT 123'); assert.equal(l.obsPagtoInformado, 'Nota do pagamento'); assert.equal(l.nmuAtendente.length, 25); assert.equal(Number(l.id_status_pagto), 1); assert.equal(l.status, 'informado'); assert.equal(l.id_bandeira_cartao, null);
      return `idPagtoInformado ${id}`;
    });
    await passo('confirmar: só id_status_pagto vai a 2 (o resto da linha igual); repetir muda 0 linhas; outra cliente muda 0', async () => {
      const id = await legado.pagamentos.inserir(ex, legado.pagamentos.linhaDoPagamento({ ...base, id: 'PG-2', method: 'Transferência', bank: 'Santander' }, 'Khloe'));
      const a = await linha('tbl_pagtoinformado', 'idPagtoInformado', id);
      assert.equal(await legado.pagamentos.confirmar(ex, id, 900014), 0); assert.equal(await legado.pagamentos.confirmar(ex, id, 900013), 1); assert.equal(await legado.pagamentos.confirmar(ex, id, 900013), 0);
      const d = await linha('tbl_pagtoinformado', 'idPagtoInformado', id); assert.equal(Number(d.id_status_pagto), 2);
      for (const c of Object.keys(a)) if (c !== 'id_status_pagto') assert.deepEqual(d[c], a[c], `coluna ${c} mudou`);
    });
    await passo('lançado já confirmado (confirmation Confirmado) nasce com 2', async () => {
      const id = await legado.pagamentos.inserir(ex, legado.pagamentos.linhaDoPagamento({ ...base, id: 'PG-3', confirmation: 'Confirmado' }, 'Khloe')); assert.equal(Number((await linha('tbl_pagtoinformado', 'idPagtoInformado', id)).id_status_pagto), 2);
    });
    await passo('canais sem id próprio usam ids EXISTENTES (provisório): PIX/Itaú Jurídica/Caixa 1+2, BB 1+3, Santander 1+4, Dinheiro 1+5, Mercado Pago 8+5, sem banco 5; INSERT real de cada um', async () => {
      const casos = [[{ method: 'PIX', bank: undefined }, 1, 5], [{ method: 'PIX', bank: 'Itaú Jurídica' }, 1, 2], [{ method: 'PIX', bank: 'Caixa' }, 1, 2], [{ method: 'PIX', bank: 'BB' }, 1, 3], [{ method: 'PIX', bank: 'Santander' }, 1, 4],
        [{ method: 'Dinheiro', bank: undefined }, 1, 5], [{ bank: 'Mercado Pago' }, 8, 5], [{ method: 'Cartão de crédito', bank: 'Mercado Pago' }, 8, 5], [{ method: 'Transferência', bank: 'BB' }, 3, 3]];
      for (const [m, f, b] of casos) { const id = await legado.pagamentos.inserir(ex, legado.pagamentos.linhaDoPagamento({ ...base, ...m }, 'K')); const l = await linha('tbl_pagtoinformado', 'idPagtoInformado', id); assert.equal([Number(l.idFormaPagto), Number(l.idBanco)].join('+'), `${f}+${b}`, JSON.stringify(m)); }
    });
    await passo('Cartão (sem Mercado Pago) e cancelado: RECUSADOS com erro claro e NADA gravado', async () => {
      const n0 = Number((await leitura('SELECT COUNT(*) AS n FROM tbl_pagtoinformado'))[0].n);
      for (const [mudanca, re] of [[{ method: 'Cartão de crédito', bank: 'Itaú' }, /bandeira e parcelas/], [{ method: 'Cartão de crédito', bank: undefined }, /bandeira e parcelas/], [{ status: 'Cancelado' }, /cancelado/i]]) {
        assert.throws(() => legado.pagamentos.linhaDoPagamento({ ...base, ...mudanca }, 'K'), (e) => e instanceof MapeamentoError && re.test(e.message));
      }
      assert.equal(Number((await leitura('SELECT COUNT(*) AS n FROM tbl_pagtoinformado'))[0].n), n0);
    });
    await passo('catálogo: banco/forma inexistente no legado recusa ANTES do INSERT', async () => {
      const n0 = Number((await leitura('SELECT COUNT(*) AS n FROM tbl_pagtoinformado'))[0].n);
      const c = legado.pagamentos.linhaDoPagamento(base, 'K');
      await assert.rejects(() => legado.pagamentos.inserir(ex, { ...c, idBanco: 99 }), (e) => e instanceof MapeamentoError && /tbl_bancos/.test(e.message));
      await assert.rejects(() => legado.pagamentos.inserir(ex, { ...c, idFormaPagto: 99 }), (e) => e instanceof MapeamentoError && /tbl_opcaopagto/.test(e.message));
      assert.equal(Number((await leitura('SELECT COUNT(*) AS n FROM tbl_pagtoinformado'))[0].n), n0);
    });
    await passo('limites: autorização acima de 100, observação com emoji e nota de 501 caracteres são recusadas, não cortadas', async () => {
      assert.throws(() => legado.pagamentos.linhaDoPagamento({ ...base, authorization: 'x'.repeat(101) }, 'K'), MapeamentoError);
      assert.throws(() => legado.pagamentos.linhaDoPagamento({ ...base, note: 'a🔮' }, 'K'), MapeamentoError);
      assert.throws(() => legado.notas.linhaDaNota('x'.repeat(501), '900013', '990002'), /500/);
    });
    await passo('nota nova: INSERT em obs_liberacao_consulta (id_usuario, desc, id_atendente = usuarios.id da equipe); dt_hr no padrão; sem id de equipe ou fora de nivel 2/99 é recusada', async () => {
      const id = await legado.notas.inserir(ex, legado.notas.linhaDaNota('Cliente pediu retorno', '900013', '990002')); const l = await linha('obs_liberacao_consulta', 'id', id);
      assert.equal(Number(l.id_usuario), 900013); assert.equal(l.desc, 'Cliente pediu retorno'); assert.equal(Number(l.id_atendente), 990002); assert.ok(l.dt_hr);
      assert.throws(() => legado.notas.linhaDaNota('x', '900013', undefined), (e) => e instanceof MapeamentoError && /legacy_id/.test(e.message));
      await assert.rejects(() => legado.notas.inserir(ex, legado.notas.linhaDaNota('x', '900013', '900013')), (e) => e instanceof MapeamentoError && /equipe/.test(e.message)); // 900013 é cliente (nivel 0)
    });
    await passo('status do tarólogo: consulta aberta = 2; fechada sem outra aberta = 1; fechada com OUTRA aberta do mesmo tarólogo = 2; só a linha dele muda', async () => {
      const [a, b] = [await linha('tbl_tarologos', 'idTarologo', 9002), await linha('tbl_tarologos', 'idTarologo', 9001)];
      assert.equal(await legado.tarologoStatus.marcar(ex, 9001, 1, true), 2); assert.equal(Number((await linha('tbl_tarologos', 'idTarologo', 9001)).status), 2);
      assert.equal(await legado.tarologoStatus.marcar(ex, 9001, 1, false), 1);
      await ex.execute(legado.sql.INSERT_CONSULTA, legado.sql.COLUNAS_INSERT.map((c) => ({ idUsuario: 900013, idTarologo: 9001, dtConsulta: '2026-10-30 10:00:00', iniConsulta: '2026-10-30 10:00:00', fimConsulta: '0000-00-00 00:00:00', tmpConsulta: 0, idFormaConsulta: 4, idFormaPagto: 1, obsConsulta: '', dtVencto: '2026-10-30 10:00:00', vlDesconto: 0, vlBonus: 0, nmuAtendente: 'K', atendenteFinalizou: '', IDProdutoConsulta: 1, valor_consulta: '0.00' }[c])));
      assert.equal(await legado.tarologoStatus.marcar(ex, 9001, 999999, false), 2);
      const d = await linha('tbl_tarologos', 'idTarologo', 9002); assert.deepEqual(d, a); void b;
    });
    await passo('a allowlist recusa DELETE, saldo/valorAPagar, tbl_pagtoconfirmado, tbl_pagtonaolocalizado, contacorrente, tbl_bonus e UPDATE de outras colunas de pagamento', async () => {
      for (const sql of ['DELETE FROM tbl_pagtoinformado WHERE idPagtoInformado = 1', 'UPDATE usuarios SET saldo = 1 WHERE id = 1', 'UPDATE usuarios SET valorAPagar = 1 WHERE id = 1', 'INSERT INTO tbl_pagtoconfirmado (idUsuario) VALUES (1)', 'INSERT INTO tbl_pagtonaolocalizado (idUsuario) VALUES (1)',
        'INSERT INTO contacorrente (idUsuario) VALUES (1)', 'INSERT INTO tbl_bonus (idCliente) VALUES (1)', 'UPDATE tbl_pagtoinformado SET vlPagtoInformado = 0 WHERE idPagtoInformado = 1', 'DELETE FROM obs_liberacao_consulta', 'UPDATE obs_liberacao_consulta SET `desc` = 1 WHERE id = 1']) {
        await assert.rejects(() => ex.execute(sql, []), (e) => e.codigo === 'LEGADO_ESCRITA_RECUSADA', sql);
      }
    });
    await passo('a segunda conexão NÃO vê nada do ensaio (tabelas reais iguais enquanto o ensaio ainda está aberto)', async () => { assert.deepEqual(await fotografia(), antes); });
  }, { tabelas: Object.keys(TABELAS).concat(['usuarios']), sementes: { usuarios: { coluna: 'id', valores: [900013, 900014, 990002] }, tbl_tarologos: { coluna: 'idTarologo', valores: [9001, 9002] } } });

  const depois = await fotografia();
  console.log(`Banco de dev ${cfg.database}. DEPOIS:\n       ${resumir(depois)}`);
  await passo('tabelas REAIS idênticas antes e depois (linhas, maior id, AUTO_INCREMENT, engine, CHECKSUM TABLE), lidas por outra conexão', () => { assert.deepEqual(depois, antes); return `${Object.keys(TABELAS).length} tabelas iguais`; });
  await legado.fechar();
  console.log(`\nEnsaio: ${ok} ok, ${falhas.length} falhas`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e.codigo || e.name, String(e.message).slice(0, 300)); process.exit(2); });
