'use strict';

/**
 * Verificação OFFLINE da onda 2, grupo E1 (API: tarólogos, trilha de auditoria, janela das pendências). Sem banco nem rede.
 *   E1.1 lista de tarólogos sem o perfil de sistema (347 AFila), inativos mantidos, mesma ordem e formato
 *   E1.2 autoria dos Logs pela sessão (autor forjado no corpo é ignorado) e lote máximo do front
 *   E1.3 janela das consultas da derivação de pendências = 7 dias (a do front)
 *   E1.4 horários do legado quebram em limites de bloco sem mudar as palavras
 *   node scripts/verificar-gf-onda2-e1.js     (código 0 quando passa)
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gf = path.join(__dirname, '..', 'src', 'gestao-fadas');
const r = (p) => require(path.join(gf, p));
let ok = 0;
const falhas = [];
const fila = [];
const test = (nome, fn) => fila.push([nome, fn]);

test('E1.1: GET de tarólogos não devolve o 347 AFila, mantém inativos e a ordem', async () => {
  const linha = (idTarologo, nmuTarologo, ativo) => ({ idTarologo, nmuTarologo, ativo, get: () => ({ idTarologo, nmuTarologo, ativo }) });
  const linhas = [linha(1, 'Ana', '1'), linha(347, 'AFila', '1'), linha(2, 'Bia', '0'), linha(348, 'AFila', '1')];
  const legadoPath = require.resolve(path.join(gf, '_comum/legado'));
  require(legadoPath);
  require.cache[legadoPath].exports = { ...require.cache[legadoPath].exports, lendo: async (fn) => fn({ LegadoTarologo: { findAll: async () => linhas } }) };
  delete require.cache[require.resolve(path.join(gf, 'features/tarologos/tarologos.service'))];
  const x = await r('features/tarologos/tarologos.service').listar({});
  assert.deepEqual(x.map((t) => t.id), ['1', '2', '348']);
  assert.deepEqual(x[1], { id: '2', name: 'Bia', active: false });
});

test('E1.2: carimbarAutor troca autor, papel e tipo pelo da sessão e mantém o resto', () => {
  const d = r('_comum/dominio/log-operacional');
  const e = { id: 'a', category: 'agenda', action: 'x', recordId: 'r', detail: 'd', origin: 'captured', actorId: 'FORJADO', actorName: 'Laya', actorRole: 'administradora', actorKind: 'system', before: { a: 1 } };
  const [s] = d.carimbarAutor([e], { id: '42', nome: 'Osíris', papel: 'tarologa' });
  assert.deepEqual([s.actorId, s.actorName, s.actorRole, s.actorKind], ['42', 'Osíris', 'tarologa', 'person']);
  assert.deepEqual(s.before, { a: 1 });
  assert.equal(e.actorName, 'Laya', 'não muda o original');
  const [sem] = d.carimbarAutor([{ ...e, actorId: undefined }], { id: '1', nome: 'N', papel: 'atendente' });
  assert.equal(sem.actorId, '1');
});

test('E1.2: lote máximo é o do front (100) e o serviço carimba pela sessão', () => {
  const d = r('_comum/dominio/log-operacional');
  const ev = (i) => ({ id: `e${i}`, category: 'agenda', action: 'a', recordId: 'r', detail: 'd', origin: 'captured' });
  assert.equal(d.MAX_EVENTOS, 100);
  assert.equal(d.validar(Array.from({ length: 100 }, (_, i) => ev(i))).length, 100);
  assert.throws(() => d.validar(Array.from({ length: 101 }, (_, i) => ev(i))), /inválidos/);
  const src = fs.readFileSync(path.join(gf, 'features/estado-financeiro/log.service.js'), 'utf8');
  assert.ok(src.includes('dom.carimbarAutor(eventos, { id: conta, nome: a.nome, papel: a.perfil })'));
  assert.ok(src.indexOf('carimbarAutor') < src.indexOf('INSERT IGNORE') && /JSON\.stringify\(e\)/.test(src));
  const front = path.join(__dirname, '..', '..', '..', 'fadasdobemsuspiro', 'fadasdobemsuspiro', 'NovoCodigo', 'fadasdobemsuspiro--FRONT', 'features', 'integration', 'financial-state', 'real-audit-api.ts');
  if (fs.existsSync(front)) assert.ok(fs.readFileSync(front, 'utf8').includes('AUDIT_BATCH = 100'));
});

test('E1.3: a derivação de pendências lê consultas dos últimos 7 dias (READ_WINDOW_DAYS do front)', async () => {
  const lerPath = require.resolve(path.join(gf, 'novo/leitura'));
  require(lerPath);
  require.cache[lerPath].exports = { ...require.cache[lerPath].exports, lendoNovo: async (fn) => fn({ GfPagamentos: { findAll: async () => [] }, GfDivergencias: { findAll: async () => [] } }) };
  const store = r('features/consultas-ciclo/ciclo.store');
  const agenda = r('features/agenda/agenda.store');
  const adicionais = r('features/estado-financeiro/adicionais.fonte');
  let desde = null;
  const orig = [store.lerRegistros, agenda.lerItens, adicionais.lerParaPendencias];
  store.lerRegistros = async (m, o) => { desde = o.desde; return []; };
  agenda.lerItens = async () => [];
  adicionais.lerParaPendencias = async () => undefined;
  try {
    delete require.cache[require.resolve(path.join(gf, 'features/pendencias/pendencias.origem'))];
    const o = r('features/pendencias/pendencias.origem');
    assert.equal(o.JANELA_CONSULTAS_DIAS, 7);
    await o.carregarFontes();
    const { hojeOperacional, somarDias } = r('_comum/dia-operacional');
    assert.equal(desde, somarDias(hojeOperacional(), -7));
  } finally { [store.lerRegistros, agenda.lerItens, adicionais.lerParaPendencias] = orig; }
});

test('E1.4: horários quebram em limites de bloco, sem colar e sem mudar as palavras', () => {
  const { horariosDoLegado } = r('_comum/dominio/catalogo-tarologos');
  assert.deepEqual(horariosDoLegado('<b>Seg a Sex</b>: 22h à 00h<div>Sábado: 12h às 16h</div>'), ['Seg a Sex: 22h à 00h', 'Sábado: 12h às 16h']);
  assert.deepEqual(horariosDoLegado('21h às 2h<p>Posso ser encontrado em outros horários também.</p>'), ['21h às 2h', 'Posso ser encontrado em outros horários também.']);
  assert.deepEqual(horariosDoLegado('<table><tr><td>Dom</td><td>8h</td></tr></table><ul><li>a</li><li>b</li></ul>x<BR/>y<br>z'), ['Dom', '8h', 'a', 'b', 'x', 'y', 'z']);
  assert.deepEqual(horariosDoLegado('Ne<b>gri</b><span>to</span> a&nbsp;&amp;&nbsp;b'), ['Negrito a & b']);
  assert.deepEqual(horariosDoLegado(''), []);
  assert.deepEqual(horariosDoLegado(null), []);
});

(async () => {
  for (const [nome, fn] of fila) {
    try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}\n        ${String(e.stack || e.message).split('\n').slice(0, 6).join('\n        ')}`); }
  }
  console.log(`\n${ok} verificação(ões) passaram, ${falhas.length} falharam.`);
  process.exit(falhas.length ? 1 : 0);
})();
