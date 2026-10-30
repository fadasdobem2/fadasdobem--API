'use strict';
/**
 * Fotografia normalizada do esquema `public` de um banco (information_schema + pg_catalog).
 * Nomes de constraints/índices NÃO entram na chave: comparamos a definição (o nome é cosmético).
 */
const IGNORAR = ['_schema_migrations'];

async function fotografar(c) {
  const q = async (sql) => (await c.query(sql)).rows;
  const f = { tabelas: {}, enums: {} };

  for (const r of await q(`
    SELECT c.relname AS t, obj_description(c.oid, 'pg_class') AS cm
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'`)) {
    if (IGNORAR.includes(r.t)) continue;
    f.tabelas[r.t] = { comentario: r.cm || null, colunas: {}, constraints: [], indices: [] };
  }

  for (const r of await q(`
    SELECT c.relname AS t, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS tipo,
           a.attnotnull AS nn, pg_get_expr(d.adbin, d.adrelid) AS def, a.attidentity AS ident,
           col_description(c.oid, a.attnum) AS cm
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped`)) {
    if (!f.tabelas[r.t]) continue;
    f.tabelas[r.t].colunas[r.col] = {
      tipo: r.tipo, nulo: !r.nn, default: r.def || null, identity: r.ident || null, comentario: r.cm || null,
    };
  }

  for (const r of await q(`
    SELECT c.relname AS t, con.contype AS k, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND con.contype IN ('p','u','f','c')`)) {
    if (f.tabelas[r.t]) f.tabelas[r.t].constraints.push(`${r.k}: ${r.def}`);
  }

  for (const r of await q(`
    SELECT tablename AS t, indexdef AS def FROM pg_indexes WHERE schemaname = 'public'`)) {
    if (!f.tabelas[r.t]) continue;
    // remove o nome do índice: "CREATE [UNIQUE] INDEX <nome> ON public.t ..." -> sem <nome>
    f.tabelas[r.t].indices.push(r.def.replace(/(INDEX) \S+ ON/, '$1 _ ON'));
  }

  for (const r of await q(`
    SELECT t.typname AS nome, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS vals
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' GROUP BY t.typname`)) {
    f.enums[r.nome] = r.vals;
  }
  for (const t of Object.values(f.tabelas)) { t.constraints.sort(); t.indices.sort(); }
  return f;
}

/**
 * Resíduos inócuos (só no modo estrito, A = SQL das migrações, B = models), documentados no cabeçalho do comparador:
 *  - default `gen_random_uuid()` / `now()` / `CURRENT_TIMESTAMP` só no SQL: o Sequelize sempre envia id e timestamps no INSERT;
 *  - default numérico igual com escala diferente (`1.0000` x `1`);
 *  - comentário existente só nos models (a migração não comenta; o inverso continua sendo diferença).
 */
function inocuo(k, ca, cb) {
  if (k === 'comentario') return ca.comentario === null;
  if (k !== 'default') return false;
  const d = ca.default, m = cb.default;
  if (m === null && /^(gen_random_uuid\(\)|now\(\)|CURRENT_TIMESTAMP)$/i.test(d || '')) return true;
  const num = (x) => (x === null ? NaN : Number(String(x).replace(/^'?(-?[\d.]+)'?(::.*)?$/, '$1')));
  return Number.isFinite(num(d)) && num(d) === num(m);
}

/** Lista de diferenças legíveis entre duas fotografias (A = migrado, B = sync dos models). */
function diferencas(a, b, nomeA = 'migrado', nomeB = 'models', { toleraDefaultsSql = false } = {}) {
  const out = [];
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  for (const t of new Set([...Object.keys(a.tabelas), ...Object.keys(b.tabelas)])) {
    const ta = a.tabelas[t], tb = b.tabelas[t];
    if (!ta || !tb) { out.push(`TABELA ${t}: só em ${ta ? nomeA : nomeB}`); continue; }
    if (ta.comentario !== tb.comentario) out.push(`TABELA ${t}: comentário ${nomeA}=${JSON.stringify(ta.comentario)} ${nomeB}=${JSON.stringify(tb.comentario)}`);
    for (const c of new Set([...Object.keys(ta.colunas), ...Object.keys(tb.colunas)])) {
      const ca = ta.colunas[c], cb = tb.colunas[c];
      if (!ca || !cb) { out.push(`COLUNA ${t}.${c}: só em ${ca ? nomeA : nomeB} (${JSON.stringify(ca || cb)})`); continue; }
      for (const k of Object.keys(ca)) {
        if (toleraDefaultsSql && inocuo(k, ca, cb)) continue;
        if (!eq(ca[k], cb[k])) out.push(`COLUNA ${t}.${c} ${k}: ${nomeA}=${JSON.stringify(ca[k])} ${nomeB}=${JSON.stringify(cb[k])}`);
      }
    }
    for (const [campo, rot] of [['constraints', 'CONSTRAINT'], ['indices', 'ÍNDICE']]) {
      // multiconjunto: um índice duplicado (mesma definição, nomes diferentes) conta como diferença
      const conta = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
      const ma = conta(ta[campo]), mb = conta(tb[campo]);
      for (const x of new Set([...ma.keys(), ...mb.keys()])) {
        const na = ma.get(x) || 0, nb = mb.get(x) || 0;
        if (na !== nb) out.push(`${rot} ${t}: ${nomeA}=${na}x ${nomeB}=${nb}x: ${x}`);
      }
    }
  }
  for (const e of new Set([...Object.keys(a.enums), ...Object.keys(b.enums)])) {
    if (!a.enums[e] || !b.enums[e]) out.push(`ENUM ${e}: só em ${a.enums[e] ? nomeA : nomeB}`);
    else if (!eq(a.enums[e], b.enums[e])) out.push(`ENUM ${e}: valores ${nomeA}=${a.enums[e].join(',')} ${nomeB}=${b.enums[e].join(',')}`);
  }
  return out;
}

module.exports = { fotografar, diferencas };
