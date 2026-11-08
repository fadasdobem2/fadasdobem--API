'use strict';

/**
 * Verificação do que a v711 acrescentou além dos e-mails (verificar-gf-email.js), contra o CÓDIGO REAL do front (ouro em scripts/apoio-gf-v711/ouro.json):
 *   - formas de atendimento (PABX, Áudio, Texto): todas as funções de professional-service-modes.mjs e a rota `/professional-services` (serviço com repositório em memória);
 *   - regime Pré/Pós (`assertClientPaymentTransition`, `preserveClientPaymentProfile`);
 *   - cadastro profissional (canais históricos + formas, vínculo Umbler privado);
 *   - presença por atividade e "Não possui e-mail" (com o filho de Postgres descartável, sem `--offline`).
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');
const C = require('./apoio-gf-v711/cenarios');
const { carregarMutante } = require('./apoio-gf-email/comparar');

const RAIZ = path.join(__dirname, '..');
const DOM = 'src/gestao-fadas/_comum/dominio';
const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'apoio-gf-v711', 'ouro.json'), 'utf8'));
const req = (rel) => require(path.join(RAIZ, rel));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tentar = (fn) => { try { const v = fn(); return { ok: JSON.parse(JSON.stringify(v === undefined ? null : v)) }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
let ok = 0; const falhas = [];
async function passo(nome, fn) { try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 400)}`); } }

function divergenciasFormas(F) {
  const d = [];
  ouro.validar.forEach((x, i) => { if (!igual(tentar(() => F.validateServiceModes(x.m)), x.esperado)) d.push(`validar ${i}`); });
  ouro.habituais.forEach((x, i) => { if (!igual(tentar(() => F.habitualServiceModes(x.p)), x.esperado)) d.push(`habitual ${i}`); });
  ouro.efetivas.forEach((x, i) => { if (!igual(tentar(() => F.effectiveServiceModes(x.p, x.d)), x.esperado)) d.push(`efetiva ${i}`); });
  ouro.pedido.forEach((x) => { if (F.requestedServiceMode(x.c) !== x.esperado) d.push(`pedido ${x.c}`); });
  ouro.aceita.forEach((x, i) => { if (!igual(tentar(() => F.acceptsServiceMode(x.p, x.c, C.HOJE)), x.esperado)) d.push(`aceita ${i}`); });
  ouro.aviso.forEach((x, i) => { if (!igual(tentar(() => F.serviceModeWarning(x.p, x.c, C.HOJE)), x.esperado)) d.push(`aviso ${i}`); });
  ouro.contatos.forEach((x, i) => { if (!igual(tentar(() => F.validateUmblerContact(x.c)), x.esperado)) d.push(`contato ${i}`); });
  return d;
}

function repoFormas() {
  const linhas = new Map(); const k = (id, d) => `${id}|${d}`;
  return {
    async read(id, d) { return linhas.has(k(id, d)) ? { ...linhas.get(k(id, d)) } : null; },
    async list(d) { return [...linhas.values()].filter((r) => r.date === d).sort((a, b) => a.tarotId.localeCompare(b.tarotId)).map((r) => ({ ...r })); },
    async save(row, rev) { const a = linhas.get(k(row.tarotId, row.date)); if (rev === 0 ? a : !a || a.revision !== rev) return null; const n = { ...row, revision: rev + 1 }; linhas.set(k(row.tarotId, row.date), n); return { ...n }; },
  };
}

async function rodarFormas(servico) {
  const store = repoFormas(); const saida = [];
  for (const [metodo, consulta, corpo, ator, instante] of C.PEDIDOS_FORMAS) {
    const query = Object.fromEntries(new URLSearchParams(consulta.replace(/^\?/, '')));
    const r = await servico.tratar({ metodo, query, corpo, ator }, { store, agora: () => instante || C.AGORA });
    saida.push(JSON.parse(JSON.stringify({ status: r.status, corpo: r.corpo })));
  }
  return saida;
}
const divergenciasRota = (saida) => saida.flatMap((s, i) => (igual(s, ouro.formas[i].saida) ? [] : [`pedido ${i}: ${JSON.stringify(s)} != ${JSON.stringify(ouro.formas[i].saida)}`]));

function divergenciasCadastro(cad) {
  const d = [];
  for (const x of ouro.cadastros) {
    const base = x.publica ? Object.fromEntries(Object.entries(ouro.cadastrosBase).filter(([k]) => !['commissionRate', 'paymentSchedule', 'weeklyScheduleEffectiveFrom', 'weeklyScheduleBase', 'weeklyScheduleVersions', 'umblerContact'].includes(k))) : ouro.cadastrosBase;
    const entrada = { ...base, ...x.extra };
    const r = tentar(() => { const v = cad.validarCadastro(entrada, { publica: x.publica }); return { channels: v.channels, serviceModes: v.serviceModes, umblerContact: v.umblerContact ?? null, publico: cad.perfilPublico(v, 't1').serviceModes }; });
    if (!igual(r, x.esperado)) d.push(`${x.nome}${x.publica ? ' (público)' : ''}: ${JSON.stringify(r)} != ${JSON.stringify(x.esperado)}`);
  }
  return d;
}

async function offline() {
  const F = req(`${DOM}/formas-atendimento.js`);
  console.log('Formas de atendimento contra o ouro do front');
  await passo(`PABX/Áudio/Texto: validação, padrão, efetivas do dia, pedido, aviso e contato Umbler iguais ao front (${ouro.aceita.length + ouro.aviso.length + ouro.efetivas.length} casos)`, () => assert.deepStrictEqual(divergenciasFormas(F), []));
  const servico = req('src/gestao-fadas/features/formas/formas.service.js');
  await passo(`rota /professional-services: ${ouro.formas.length} pedidos (leitura por perfil, gravação, revisão, dia 06h, campos extras) com a mesma resposta do front`, async () => assert.deepStrictEqual(divergenciasRota(await rodarFormas(servico)), []));
  await passo('o ouro cobre 401, 403, 409, 400, o dia anterior às 06h e a gravação do dia', () => {
    const st = new Set(ouro.formas.map((f) => f.saida.status)); for (const s of [200, 400, 401, 403, 405, 409]) assert.ok(st.has(s), `sem ${s}`);
    assert.ok(ouro.formas.some((f) => f.instante && f.saida.status === 200) && ouro.formas.some((f) => f.instante && f.saida.status === 409));
  });
  await passo('mutantes da rota refutados (qualquer perfil grava; dia do navegador; sem revisão; campo extra; tarologa grava a outra)', async () => {
    const trocas = [
      ["if (ator.role !== 'tarologa' && ator.role !== 'administradora') return", 'if (false) return'], ["corpo.date === data &&", 'true &&'], ["Number.isSafeInteger(corpo.revision) && corpo.revision >= 0", 'true'],
      ["Object.keys(corpo).every((k) => ['modes', 'revision', 'date'].includes(k))", 'true'], ["(pedido && pedido !== id)", 'false'], ["const id = ator.role === 'tarologa' ? ator.tarotId : pedido;", 'const id = pedido || ator.tarotId;'],
      ['operationalDateAt(new Date(agora()))', 'new Date(agora()).toISOString().slice(0, 10)'], ["if (!PERFIS.includes(ator.role)) return", 'if (false) return'],
    ];
    for (const [de, para] of trocas) { const m = carregarMutante('src/gestao-fadas/features/formas/formas.service.js', de, para); assert.ok(divergenciasRota(await rodarFormas(m)).length > 0, de); }
  });
  await passo('mutantes de formas refutados', () => {
    const trocas = [["return MODOS.filter((m) => entrada.includes(m));", 'return entrada;'], ["canais.length ? [...new Set(mapeados)] : ['texto']", "[...new Set(mapeados)]"], ["v === 'chat' ? ['texto']", "v === 'chat' ? ['audio']"],
      ["perfil.serviceModesToday.date === data ?", 'perfil.serviceModesToday ?'], ["!modo || effectiveServiceModes(perfil, data).includes(modo)", 'true'], ["if (v.includes('audio')) return 'audio';", ''], ["r.phone && !/^\\+?[\\d\\s().-]{10,24}$/.test(r.phone)", 'false']];
    for (const [de, para] of trocas) assert.ok(divergenciasFormas(carregarMutante(`${DOM}/formas-atendimento.js`, de, para)).length > 0, de);
  });

  console.log('Regime Pré/Pós contra o ouro do front');
  const R = req(`${DOM}/cliente-regime.js`);
  const pode = (de, para) => R.regimePodeMudar(de === '__u' ? undefined : de, para === '__u' ? undefined : para);
  await passo('só se pode ir para Pré e a mudança é definitiva: a matriz de transições decide como o front', () => {
    for (const x of ouro.regime) { const validoNoFront = !(x.esperado.erro === 'Confira o regime da cliente.'); if (validoNoFront && !((x.de === '__u' || x.de === null) && x.para === '')) assert.strictEqual(pode(x.de, x.para), !x.esperado.erro, `${x.de} -> ${x.para}`); }
    assert.strictEqual(R.MENSAGEM, 'A cliente pode passar para Pré. Depois disso, não volta para Pós.');
    assert.ok(ouro.regime.some((x) => x.de === '' && x.para === 'Pós-pago' && x.esperado.erro === R.MENSAGEM), 'sem regime não vai para Pós (o front recusa)');
  });
  await passo('importação posterior não desfaz a passagem para Pré (preserveClientPaymentProfile)', () => { for (const x of ouro.preservar) assert.strictEqual(R.preservarRegimeNaImportacao(x.perfil, x.em, x.aprovada), x.esperado, JSON.stringify(x)); });
  await passo('mutantes do regime refutados', () => {
    const refuta = (de, para) => { const m = carregarMutante(`${DOM}/cliente-regime.js`, de, para); const p = (a, b) => m.regimePodeMudar(a === '__u' ? undefined : a, b === '__u' ? undefined : b); return ouro.regime.filter((x) => x.esperado.erro !== 'Confira o regime da cliente.').some((x) => p(x.de, x.para) !== !x.esperado.erro); };
    assert.ok(refuta('return antes === depois || depois === PRE;', 'return true;')); assert.ok(refuta('return antes === depois || depois === PRE;', "return antes === depois || antes !== PRE;"));
    assert.ok(refuta('return antes === depois || depois === PRE;', 'return depois === PRE;'));
    const m = carregarMutante(`${DOM}/cliente-regime.js`, 'perfil === PRE ||', ''); assert.ok(ouro.preservar.some((x) => m.preservarRegimeNaImportacao(x.perfil, x.em, x.aprovada) !== x.esperado));
  });

  console.log('Cadastro profissional contra o ouro do front');
  const cad = req(`${DOM}/cadastro-tarologo.js`);
  await passo('canais históricos e novos, formas do padrão e vínculo Umbler privado: mesma regra e mesma mensagem do front', () => {
    ouro.cadastrosBase = JSON.parse(JSON.stringify(ouro.base));
    assert.deepStrictEqual(divergenciasCadastro(cad), []);
  });
  await passo('mutantes do cadastro refutados', () => {
    const refuta = (de, para) => divergenciasCadastro(carregarMutante(`${DOM}/cadastro-tarologo.js`, de, para)).length > 0;
    assert.ok(refuta("['Chat', 'Voz', 'PABX', 'Áudio', 'Texto'].includes(c)", 'true')); assert.ok(refuta('if (!publica) r.umblerContact = formas.validateUmblerContact(dados.umblerContact);', 'r.umblerContact = undefined;'));
    assert.ok(refuta("const PRIVADOS = ['umblerContact', ", 'const PRIVADOS = ['));
  });

  console.log('Arquivos pequenos');
  await passo('arquivos novos com menos de 300 linhas', () => { for (const rel of ['src/gestao-fadas/features/formas/formas.service.js', 'src/gestao-fadas/features/formas/formas.store.js', 'src/gestao-fadas/gate/rotas-formas.js', `${DOM}/formas-atendimento.js`, `${DOM}/cliente-regime.js`]) assert.ok(fs.readFileSync(path.join(RAIZ, rel), 'utf8').split('\n').length < 300, rel); });
}

async function comBanco() {
  const banco = pg.nomeBanco('v711'); let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const r = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-v711', 'filho.js')], extra);
    process.stdout.write(r.stdout); if (r.status !== 0) process.stderr.write(r.stderr); codigo = r.status;
  } catch (e) { console.error(e.message || e); codigo = 2; } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_v711_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_v711_* restante).');
  }
  return codigo;
}

(async () => {
  await offline();
  console.log(`\nOffline: ${ok} ok, ${falhas.length} falhas`);
  if (falhas.length) process.exit(1);
  if (process.argv.includes('--offline')) process.exit(0);
  process.exit(await comBanco());
})().catch((e) => { console.error(e); process.exit(2); });
