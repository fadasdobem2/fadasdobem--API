'use strict';

/**
 * Verificação OFFLINE (sem banco) dos models do sistema B:
 *   - cada model legado bate com o catálogo (colunas e chave primária), sem credenciais;
 *   - as associações apontam para colunas que existem;
 *   - toda tentativa de escrita no legado é recusada;
 *   - o SQL gerado para um join legado + novo é só SELECT.
 *
 *   node scripts/verificar-models-legado.js
 */

const assert = require('assert');
const path = require('path');

process.env.LEGADO_DB_HOST = process.env.LEGADO_DB_HOST || '127.0.0.1';
process.env.LEGADO_DB_NAME = process.env.LEGADO_DB_NAME || 'verificacao_offline';
process.env.LEGADO_DB_USER = process.env.LEGADO_DB_USER || 'verificacao';

const { iniciarLegado, encerrarLegado, ehLeitura, LegadoSomenteLeituraError } = require('../src/models/legado');
const { SENSIVEIS, IGNORAR_LEGADO } = require('./gerar-models-legado');
const catalogo = require(path.join('..', 'src', 'gestao-fadas', 'fontes', 'schema-catalog.json'));

let ok = 0;
const passou = (msg) => {
  ok += 1;
  console.log(`  ok  ${msg}`);
};

(async () => {
  const { sequelize, models } = iniciarLegado();

  /* 1. Catálogo x models */
  let colunas = 0;
  for (const [tabela, def] of Object.entries(catalogo.tables)) {
    const modelo = Object.values(models).find((m) => m.tableName === tabela);
    if (IGNORAR_LEGADO[tabela]) {
      assert.strictEqual(modelo, undefined, `${tabela} deveria estar fora`);
      continue;
    }
    assert.ok(modelo, `faltou model para ${tabela}`);
    const esperadas = Object.keys(def.columns).filter((c) => !(SENSIVEIS[tabela] || []).includes(c));
    assert.deepStrictEqual(Object.keys(modelo.rawAttributes).sort(), esperadas.sort(), `colunas de ${tabela}`);
    const pk = def.constraints.find((c) => /^PRIMARY KEY/i.test(c));
    const chaves = [...pk.matchAll(/`([^`]+)`/g)].map((x) => x[1]);
    assert.deepStrictEqual(Object.keys(modelo.primaryKeys).sort(), chaves.sort(), `PK de ${tabela}`);
    assert.strictEqual(modelo.options.somenteLeitura, true, `${tabela} deve ser somente leitura`);
    colunas += esperadas.length;
  }
  passou(`${Object.keys(catalogo.tables).length - Object.keys(IGNORAR_LEGADO).length} tabelas legadas batem com o catálogo (${colunas} colunas, sem credenciais)`);

  for (const [tabela, lista] of Object.entries(SENSIVEIS)) {
    const modelo = Object.values(models).find((m) => m.tableName === tabela);
    for (const c of lista) assert.ok(!(c in modelo.rawAttributes), `${tabela}.${c} não pode estar no model`);
  }
  passou('colunas de senha/credencial fora dos models (usuarios, tbl_tarologos, tbl_usuario)');

  /* 2. Associações */
  let assocs = 0;
  for (const modelo of Object.values(models)) {
    for (const [alias, a] of Object.entries(modelo.associations)) {
      const alvo = a.target;
      if (a.associationType === 'BelongsTo') {
        assert.ok(a.foreignKey in modelo.rawAttributes, `${modelo.name}.${alias}: FK ${a.foreignKey} não existe`);
        assert.ok(a.targetKey in alvo.rawAttributes, `${modelo.name}.${alias}: chave ${a.targetKey} não existe em ${alvo.name}`);
      } else {
        assert.ok(a.foreignKey in alvo.rawAttributes, `${modelo.name}.${alias}: FK ${a.foreignKey} não existe em ${alvo.name}`);
        assert.ok(a.sourceKey in modelo.rawAttributes, `${modelo.name}.${alias}: chave ${a.sourceKey} não existe`);
      }
      assocs += 1;
    }
  }
  passou(`${assocs} associações apontam para colunas existentes`);

  /* 3. Escrita recusada (três camadas) */
  await assert.rejects(() => models.LegadoUsuario.update({ nome: 'x' }, { where: { id: 1 } }), LegadoSomenteLeituraError);
  await assert.rejects(() => models.LegadoConsulta.destroy({ where: { idConsulta: 1 } }), LegadoSomenteLeituraError);
  await assert.rejects(() => models.GfTarologosExt.bulkCreate([{ id_tarologo: 1 }]), LegadoSomenteLeituraError);
  await assert.rejects(() => sequelize.query("UPDATE usuarios SET saldo = 0 WHERE id = 1"), LegadoSomenteLeituraError);
  await assert.rejects(() => sequelize.query('DELETE FROM tbl_consultas'), LegadoSomenteLeituraError);
  await assert.rejects(() => sequelize.query('ALTER TABLE usuarios ADD COLUMN x INT'), LegadoSomenteLeituraError);
  await assert.rejects(() => sequelize.query('SELECT * FROM usuarios FOR UPDATE'), LegadoSomenteLeituraError);
  const casos = {
    'SELECT 1': true,
    '  /* x */ select * from tbl_consultas': true,
    'WITH a AS (SELECT 1) SELECT * FROM a': true,
    'SHOW TABLES': true,
    'INSERT INTO t VALUES (1)': false,
    'SELECT 1; DROP TABLE usuarios': false,
    'SELECT * FROM t INTO OUTFILE "/tmp/x"': false,
    'TRUNCATE tbl_consultas': false,
    'CREATE TABLE gf_x (id INT)': false,
  };
  for (const [sql, esperado] of Object.entries(casos)) assert.strictEqual(ehLeitura(sql), esperado, sql);
  passou('create/update/destroy/bulk, UPDATE/DELETE/ALTER/FOR UPDATE e multi-instrução recusados');

  /* 4. SQL gerado do merge legado + novo (sem conectar) */
  const capturado = [];
  sequelize.query = async (sql) => {
    capturado.push(typeof sql === 'string' ? sql : sql.query);
    return [];
  };
  await models.LegadoTarologo.findAll({ include: [{ model: models.GfTarologosExt, as: 'extensao' }], limit: 5 });
  await models.LegadoConsulta.findAll({
    attributes: ['idConsulta', 'valor_consulta'],
    include: [
      { model: models.LegadoUsuario, as: 'cliente', attributes: ['id', 'nome_id'] },
      { model: models.LegadoTarologo, as: 'tarologo', attributes: ['idTarologo', 'nmuTarologo'] },
    ],
    limit: 5,
  });
  assert.ok(capturado.length === 2 && capturado.every((s) => /^SELECT/i.test(s)), 'só SELECT');
  assert.ok(/LEFT OUTER JOIN `gf_tarologos_ext`/.test(capturado[0]) && /`idTarologo` = `extensao`.`id_tarologo`/.test(capturado[0]), 'join legado + nova');
  assert.ok(!/senha|login/i.test(capturado.join(' ')), 'SQL não pode citar credenciais');
  passou('join tbl_tarologos + gf_tarologos_ext e consulta + cliente + tarólogo geram só SELECT');

  await encerrarLegado();
  console.log(`\nVERIFICAÇÃO OK (${ok} grupos de checagem). Nenhuma conexão foi aberta.`);
})().catch((e) => {
  console.error('\nFALHOU:', e.message);
  process.exit(1);
});
