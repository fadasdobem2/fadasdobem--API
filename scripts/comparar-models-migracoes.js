'use strict';
/**
 * Compara o esquema criado pelo caminho OFICIAL de migração (`scripts/run-migrations.js` em banco vazio)
 * com o esquema criado só pelos models (sync). Dois bancos descartáveis fdb_*, apagados no fim.
 * Compara: tabelas, colunas (tipo, nulabilidade, default, comentário), enums e valores, PK/UK/FK (com
 * ON DELETE/UPDATE), checks, índices (definição completa) e comentários de tabela. Sai com 1 se houver QUALQUER diferença.
 * Nomes de constraints e índices não entram na comparação (só a definição).
 *
 * Além disso compara um terceiro banco, "estrito" (scripts/apoio-esquema/migrar-estrito.js): o mesmo runner, mas
 * com os models sem tudo que as migrações posteriores criam por SQL próprio (tabelas, colunas e FKs/índices
 * delas). Ele representa o que os bancos EXISTENTES têm de fato (o baseline por sync esconde divergências
 * quando o model já traz a coluna/tabela). Estrito x models também precisa dar zero.
 *
 * Resíduos tratados como inócuos (só na comparação estrita; ver `inocuo` em apoio-esquema/snapshot.js):
 *  - default `gen_random_uuid()` / `now()` só no SQL das migrações: o Sequelize sempre envia id e timestamps no INSERT;
 *  - default numérico igual com escala diferente (`1.0000` x `1`);
 *  - comentário de coluna que só os models têm (a migração não comenta). O inverso (comentário da migração
 *    ausente no model) continua sendo diferença.
 * Nada mais é tolerado: tipo, nulabilidade, enum, PK/UK/FK (com ON DELETE/UPDATE), checks e índices contam.
 *
 * Saída: 0 = sem diferença; 1 = diferenças; 2 = erro ao montar os bancos.
 * Uso: npm run comparar:models-migracoes
 */
const pg = require('./apoio-esquema/pg');
const { fotografar, diferencas } = require('./apoio-esquema/snapshot');

(async () => {
  const dbMig = pg.nomeBanco('mig');
  const dbSync = pg.nomeBanco('sync');
  const dbEst = pg.nomeBanco('estrito');
  let codigo = 0;
  try {
    pg.criar(dbMig);
    pg.criar(dbSync);
    pg.criar(dbEst);
    const m = pg.rodarNode(dbMig, ['scripts/run-migrations.js']);
    if (m.status !== 0) throw new Error(`migração oficial falhou:\n${m.stderr || m.stdout}`);
    const s = pg.rodarNode(dbSync, ['scripts/apoio-esquema/sync-models.js']);
    if (s.status !== 0) throw new Error(`sync dos models falhou:\n${s.stderr || s.stdout}`);

    const e = pg.rodarNode(dbEst, ['scripts/apoio-esquema/migrar-estrito.js']);
    if (e.status !== 0) throw new Error(`migração estrita falhou:\n${e.stderr || e.stdout}`);

    const foto = async (nome) => { const c = await pg.cliente(nome); try { return await fotografar(c); } finally { await c.end(); } };
    const fm = await foto(dbMig);
    const fs_ = await foto(dbSync);
    const fe = await foto(dbEst);

    const difs = [
      ...diferencas(fm, fs_, 'migrado', 'models'),
      ...diferencas(fe, fs_, 'estrito', 'models', { toleraDefaultsSql: true }).map((d) => '[estrito] ' + d),
    ];
    console.log(`Tabelas: migrado=${Object.keys(fm.tabelas).length} models=${Object.keys(fs_.tabelas).length}; enums: ${Object.keys(fm.enums).length}/${Object.keys(fs_.enums).length}`);
    if (difs.length) {
      console.log(`DIFERENÇAS (${difs.length}):`);
      difs.forEach((d) => console.log(' - ' + d));
      codigo = 1;
    } else {
      console.log('OK: nenhuma diferença entre migrações e models.');
    }
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(dbMig);
    pg.apagar(dbSync);
    pg.apagar(dbEst);
  }
  process.exit(codigo);
})();
