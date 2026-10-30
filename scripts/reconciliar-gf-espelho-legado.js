'use strict';

/**
 * COMANDO OFFLINE da reconciliação do espelho no legado (Maturacao/45): consultas, clientes e tarólogos, com a MESMA rotina do job
 * (`legado-escrita/reconciliacao.js`). NÃO é ligado ao app.js. Por padrão é só LEITURA: mostra quantas linhas há em cada estado (Postgres).
 *   node scripts/reconciliar-gf-espelho-legado.js                          resumo (não escreve em lugar nenhum)
 *   node scripts/reconciliar-gf-espelho-legado.js --executar               uma passada: precisa de GF_LEGADO_ESCRITA_ENABLED=true e da flag de cada entidade
 *   node scripts/reconciliar-gf-espelho-legado.js --executar --incluir-nao-espelhadas   também lança as edições feitas com o espelho DESLIGADO (carga inicial,
 *                                                                          decisão da Nice: sobrescreve no legado o que a equipe editou aqui desde então)
 *   --idade-min=10  --limite=50
 * Com `--executar` o banco do legado vem de LEGADO_DB_*; com `--cnf=<arquivo> --secao=client-dev` ele é montado do arquivo, e só banco de DEV é aceito.
 */
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const tem = (n) => process.argv.includes(`--${n}`);

function carregarDoArquivo() {
  if (!arg('cnf')) return;
  let sec; const c = {};
  for (const l of fs.readFileSync(arg('cnf'), 'utf8').split('\n')) {
    const m = l.match(/^\[(.+)\]$/); if (m) { sec = m[1]; c[sec] = {}; continue; }
    const k = l.match(/^\s*(\w+)\s*=\s*(.*)$/); if (k && sec) c[sec][k[1]] = k[2].trim().replace(/^["']|["']$/g, '');
  }
  const d = c[arg('secao') || 'client-dev'];
  if (!d) { console.error('Seção não encontrada'); process.exit(2); }
  if (!/(01|dev|teste)$/i.test(d.database) || /^fadasdobem$/i.test(d.database)) { console.error('Recusado: com --cnf só banco de desenvolvimento.'); process.exit(2); }
  Object.assign(process.env, { LEGADO_DB_HOST: d.host, LEGADO_DB_PORT: d.port, LEGADO_DB_NAME: d.database, LEGADO_DB_USER: d.user, LEGADO_DB_PASSWORD: d.password });
}

(async () => {
  carregarDoArquivo();
  process.env.GESTAO_FADAS_ESCRITA_ENABLED = process.env.GESTAO_FADAS_ESCRITA_ENABLED || 'true';
  const legado = require(path.join(raiz, 'src/gestao-fadas/legado-escrita'));
  const { sequelize } = require(path.join(raiz, 'src/config/database'));
  try {
    const [consultas] = await sequelize.query('SELECT legado_estado AS estado, COUNT(*) AS n FROM gf_consultas_ext GROUP BY 1 ORDER BY 1');
    const resumo = { consultas: Object.fromEntries(consultas.map((l) => [l.estado, Number(l.n)])), clientes: await legado.entidades.clientes.resumo(), intencoes: await legado.intencoes.resumo().catch(() => ({ indisponivel: true })), tarologos: await legado.entidades.tarologos.resumo() };
    console.log('Estado do espelho (Postgres):', JSON.stringify(resumo));
    if (!tem('executar')) { console.log('Nada foi escrito (use --executar para uma passada; exige as flags de escrita ligadas).'); return; }
    const r = await legado.reconciliacao.reconciliarTudo({ idadeMinutos: Number(arg('idade-min')) || 10, limite: Number(arg('limite')) || 50, incluirNaoEspelhadas: tem('incluir-nao-espelhadas') });
    console.log('Reconciliação:', JSON.stringify(r));
    if (r.desligado) console.log('Desligado: GF_LEGADO_ESCRITA_ENABLED não está true. Nada foi feito.');
  } finally { await sequelize.close(); await legado.fechar(); }
})().catch((e) => { console.error(e.codigo || e.name, String(e.message).slice(0, 300)); process.exit(2); });
