'use strict';
/**
 * Dados de ensaio genéricos, guiados pelo information_schema do banco (funcionam em qualquer estágio do esquema):
 * preenche as colunas NOT NULL sem default por tipo, resolve FKs reaproveitando/criando a linha pai, e depois
 * compara as linhas antes x depois de uma migração (nada some; nada muda, exceto o que o chamador permitir).
 */
const TABELAS = ['users', 'pricing_levels', 'clients', 'specialists', 'ledger_accounts', 'payment_orders',
  'client_credit_lots', 'transaction_ledger', 'queues', 'sessions', 'reviews', 'payout_requests', 'leads', 'audit_logs',
  'client_diaries', 'refresh_tokens', 'specialist_schedules', 'specialist_status_logs'];

// Valores que respeitam CHECKs/regras que o preenchimento por tipo não adivinha.
const FIXOS = {
  specialist_schedules: { day_of_week: 2, start_time: "'09:00'", end_time: "'17:00'" },
  specialist_status_logs: { previous_status: "'OFFLINE'", new_status: "'ONLINE'" },
  users: { role: "'CLIENTE'" },
};
let seq = 0;

async function colunas(c, tabela) {
  const r = await c.query(`
    SELECT c.column_name AS nome, c.data_type AS tipo, c.udt_name AS udt, c.is_nullable = 'YES' AS nulo,
           c.column_default AS def, c.character_maximum_length AS tam
    FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = $1 ORDER BY c.ordinal_position`, [tabela]);
  return r.rows;
}

async function fks(c, tabela) {
  const r = await c.query(`
    SELECT a.attname AS coluna, rt.relname AS pai
    FROM pg_constraint k JOIN pg_class t ON t.oid = k.conrelid JOIN pg_class rt ON rt.oid = k.confrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.conkey[1]
    WHERE k.contype = 'f' AND t.relname = $1 AND t.relnamespace = 'public'::regnamespace`, [tabela]);
  return Object.fromEntries(r.rows.map((x) => [x.coluna, x.pai]));
}

async function existe(c, tabela) {
  return (await c.query(`SELECT to_regclass('public.' || $1) IS NOT NULL AS e`, [tabela])).rows[0].e;
}

async function valorPorTipo(c, col, tabela) {
  const n = ++seq;
  if (col.tipo === 'USER-DEFINED') {
    const r = await c.query(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`, [col.udt]);
    return `'${r.rows[0].enumlabel}'`;
  }
  if (/char|text/.test(col.tipo)) {
    const base = col.nome.includes('email') ? `e${n}_${Date.now()}@ensaio.test` : `${tabela.slice(0, 4)}_${col.nome.slice(0, 6)}_${n}_${Date.now() % 100000}`;
    return `'${base.slice(0, col.tam || 200)}'`;
  }
  if (/int|numeric|double|real/.test(col.tipo)) return '1';
  if (col.tipo === 'boolean') return 'true';
  if (col.tipo === 'uuid') return 'gen_random_uuid()';
  if (/timestamp/.test(col.tipo)) return 'now()';
  if (col.tipo === 'date') return 'current_date';
  if (/^time/.test(col.tipo)) return "'10:00'";
  if (/json/.test(col.tipo)) return "'{}'";
  if (col.tipo === 'ARRAY') return "'{}'";
  throw new Error(`tipo sem valor de ensaio: ${tabela}.${col.nome} (${col.tipo})`);
}

/** Insere uma linha em `tabela` (criando pais quando preciso) e devolve o id (ou null se a tabela não existe). */
async function inserir(c, tabela, profundidade = 0) {
  if (!(await existe(c, tabela)) || profundidade > 6) return null;
  const pais = await fks(c, tabela);
  const cols = [], vals = [];
  for (const col of await colunas(c, tabela)) {
    const fixo = FIXOS[tabela] && FIXOS[tabela][col.nome];
    if (fixo !== undefined) { cols.push(col.nome); vals.push(String(fixo)); continue; }
    if (col.nulo || col.def) continue;
    if (pais[col.nome]) {
      // pai novo a cada linha: evita bater em UNIQUE (ex.: um client por user)
      const id = await inserir(c, pais[col.nome], profundidade + 1);
      cols.push(col.nome); vals.push(`'${id}'`);
    } else {
      cols.push(col.nome); vals.push(await valorPorTipo(c, col, tabela));
    }
  }
  const idCol = (await colunas(c, tabela)).some((x) => x.nome === 'id');
  const sql = cols.length
    ? `INSERT INTO "${tabela}" (${cols.map((x) => `"${x}"`).join(',')}) VALUES (${vals.join(',')}) ${idCol ? 'RETURNING id' : ''}`
    : `INSERT INTO "${tabela}" DEFAULT VALUES ${idCol ? 'RETURNING id' : ''}`;
  const r = await c.query(sql);
  return r.rows[0] ? r.rows[0].id : null;
}

/** Cria `n` linhas em cada tabela de negócio existente; devolve contagem por tabela. */
async function popular(c, n = 3) {
  const feito = {};
  for (const t of TABELAS) {
    if (!(await existe(c, t))) continue;
    for (let i = 0; i < n; i += 1) await inserir(c, t);
    feito[t] = n;
  }
  return feito;
}

/** Fotografia de linhas: { tabela: { chave: jsonb } }, chave = id (ou índice). */
async function fotografarLinhas(c) {
  const out = {};
  for (const t of TABELAS) {
    if (!(await existe(c, t))) continue;
    const temId = (await colunas(c, t)).some((x) => x.nome === 'id');
    const r = await c.query(`SELECT to_jsonb(x) AS j FROM "${t}" x ${temId ? 'ORDER BY (to_jsonb(x)->>\'id\')' : ''}`);
    out[t] = r.rows.map((x) => x.j);
  }
  return out;
}

/** Compara antes x depois; `ignorar` = colunas que a migração pode legitimamente mudar/remover. */
function compararLinhas(antes, depois, ignorar = []) {
  const falhas = [];
  for (const [t, linhas] of Object.entries(antes)) {
    const d = depois[t] || [];
    if (d.length !== linhas.length) { falhas.push(`${t}: ${linhas.length} linhas antes, ${d.length} depois`); continue; }
    const porId = new Map(d.map((x) => [x.id, x]));
    for (const a of linhas) {
      const b = a.id !== undefined ? porId.get(a.id) : null;
      if (!b) { falhas.push(`${t}: linha ${a.id} sumiu`); continue; }
      for (const [k, v] of Object.entries(a)) {
        if (ignorar.includes(`${t}.${k}`)) continue;
        if (JSON.stringify(v) !== JSON.stringify(b[k])) falhas.push(`${t}.${k} (id ${a.id}): ${JSON.stringify(v)} -> ${JSON.stringify(b[k])}`);
      }
    }
  }
  return falhas;
}

module.exports = { popular, fotografarLinhas, compararLinhas, inserir };
