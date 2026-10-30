'use strict';

/**
 * Financeiro (F-12 e idempotência): índices ÚNICOS parciais, com limpeza segura de duplicados.
 *
 *  1) ledger_accounts: uma conta por (client_id, account_type), por (specialist_id, account_type) e
 *     uma por account_type para contas de plataforma (sem dono). Duplicados existentes são
 *     CONSOLIDADOS, nunca apagados com dinheiro: a conta mais antiga fica ("keeper"), todos os
 *     lançamentos e qualquer FK que apontava para as duplicadas passam para ela, o cached_balance
 *     das duplicadas é somado ao do keeper e só então as linhas vazias são removidas. Tudo em uma
 *     transação por grupo; cada consolidação é registrada via NOTICE/console.
 *  2) payment_orders.mp_payment_id e client_credit_lots.payment_order_id: únicos parciais (ignoram
 *     excluídos). Se já houver duplicados, o índice NÃO é criado (não há como consolidar ordens ou lotes
 *     sem decisão humana): fica o aviso e a migração segue.

 * O CHECK de não negatividade dos lotes NÃO entra aqui: o model não tem como declará-lo e o comparador
 * models x migrações o trataria como divergência (fica como pendência).
 * Idempotente: pode rodar de novo sem efeito. Não altera nenhum valor de dinheiro de pagamento.
 */

const KINDS = [
  {
    name: 'ledger_accounts_client_type_uidx',
    cols: 'client_id, account_type',
    cond: 'client_id IS NOT NULL',
  },
  {
    name: 'ledger_accounts_specialist_type_uidx',
    cols: 'specialist_id, account_type',
    cond: 'specialist_id IS NOT NULL',
  },
  {
    name: 'ledger_accounts_platform_type_uidx',
    cols: 'account_type',
    cond: 'client_id IS NULL AND specialist_id IS NULL AND temp_client_id IS NULL',
  },
];

async function tableExists(sequelize, table) {
  const [[r]] = await sequelize.query(`SELECT to_regclass('public.${table}') IS NOT NULL AS ok`);
  return r.ok;
}

async function columnExists(sequelize, table, col) {
  const [[r]] = await sequelize.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='${table}' AND column_name='${col}') AS ok`
  );
  return r.ok;
}

async function indexExists(sequelize, name) {
  const [[r]] = await sequelize.query(`SELECT to_regclass('public.${name}') IS NOT NULL AS ok`);
  return r.ok;
}

/** Colunas de qualquer tabela que referenciam ledger_accounts(id) por FK, mais as do razão (sem FK declarada). */
async function referenciasAContas(sequelize) {
  const [rows] = await sequelize.query(`
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f' AND c.confrelid = 'public.ledger_accounts'::regclass AND array_length(c.conkey, 1) = 1
  `);
  const seen = new Set(rows.map((r) => `${r.tbl}.${r.col}`));
  const out = [...rows];
  for (const col of ['debit_account_id', 'credit_account_id']) {
    if (!seen.has(`transaction_ledger.${col}`)) out.push({ tbl: 'transaction_ledger', col });
  }
  return out;
}

async function consolidarGrupo(sequelize, refs, ids) {
  const [keeper, ...dups] = ids;
  await sequelize.transaction(async (transaction) => {
    const q = (sql, replacements) => sequelize.query(sql, { replacements, transaction });
    await q('SELECT id FROM ledger_accounts WHERE id IN (:ids) ORDER BY id FOR UPDATE', { ids });
    for (const { tbl, col } of refs) {
      if (!(await tableExists(sequelize, tbl.replace(/^"?public"?\./, '').replace(/"/g, '')))) continue;
      await q(`UPDATE ${tbl} SET "${col}" = :keeper WHERE "${col}" IN (:dups)`, { keeper, dups });
    }
    await q(
      `UPDATE ledger_accounts
          SET cached_balance = (SELECT SUM(cached_balance) FROM ledger_accounts WHERE id IN (:ids))
        WHERE id = :keeper
          AND EXISTS (SELECT 1 FROM ledger_accounts WHERE id IN (:ids) AND cached_balance IS NOT NULL)`,
      { ids, keeper }
    );
    await q('DELETE FROM ledger_accounts WHERE id IN (:dups)', { dups });
  });
  console.log(`[migrations] ledger_accounts: ${dups.length} duplicada(s) consolidada(s) em ${keeper}`);
}

async function unicoComLimpeza(sequelize, kind) {
  if (await indexExists(sequelize, kind.name)) return;
  const refs = await referenciasAContas(sequelize);
  const [grupos] = await sequelize.query(`
    SELECT array_agg(id::text ORDER BY created_at ASC, id ASC) AS ids
      FROM ledger_accounts WHERE ${kind.cond}
     GROUP BY ${kind.cols} HAVING count(*) > 1
  `);
  for (const g of grupos) await consolidarGrupo(sequelize, refs, g.ids);
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${kind.name} ON ledger_accounts (${kind.cols}) WHERE ${kind.cond}`
  );
}

async function unicoSeSemDuplicados(sequelize, { table, name, col, cond }) {
  if (!(await tableExists(sequelize, table)) || !(await columnExists(sequelize, table, col))) return;
  if (await indexExists(sequelize, name)) return;
  const [[r]] = await sequelize.query(
    `SELECT count(*)::int AS n FROM (SELECT ${col} FROM ${table} WHERE ${cond} GROUP BY ${col} HAVING count(*) > 1) d`
  );
  if (r.n > 0) {
    console.warn(`[migrations] ${name} NÃO criado: ${r.n} valor(es) de ${col} duplicado(s) em ${table}. Resolver manualmente.`);
    return;
  }
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${name} ON ${table} (${col}) WHERE ${cond}`);
}

module.exports = {
  async up({ sequelize }) {
    if (await tableExists(sequelize, 'ledger_accounts')) {
      for (const kind of KINDS) await unicoComLimpeza(sequelize, kind);
    }

    await unicoSeSemDuplicados(sequelize, {
      table: 'payment_orders',
      name: 'payment_orders_mp_payment_id_uidx',
      col: 'mp_payment_id',
      cond: 'mp_payment_id IS NOT NULL AND deleted_at IS NULL',
    });
    await unicoSeSemDuplicados(sequelize, {
      table: 'client_credit_lots',
      name: 'client_credit_lots_payment_order_uidx',
      col: 'payment_order_id',
      cond: 'payment_order_id IS NOT NULL AND deleted_at IS NULL',
    });
  },
};
