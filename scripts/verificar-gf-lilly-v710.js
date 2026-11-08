'use strict';

/**
 * Verificação da LILLY v710 da Nice (reserva, fechamento/continuação, correção de posição, cotações, nameArticle) e das regras de agenda/pausa da v710.
 *   1) OURO (sempre, sem banco): cada função do domínio da API contra o que o CÓDIGO REAL da Nice respondeu (scripts/gerar-ouro-gf-lilly-v710.js ->
 *      scripts/apoio-gf-lilly-v710/ouro-v710.json): `sameAgendaOccurrence`, `agendaDuplicate*`, `assertNoGeneralQueueConflict`, `duplicateIntakeRequest`,
 *      `consultationPausedSecondsBetween/consultationEndWithPauses`, `closingTiming`. Igual byte a byte (chaves ordenadas).
 *   2) MUTANTES: cada um troca UMA regra do domínio e o ouro tem de pegá-lo.
 *   3) POSTGRES DESCARTÁVEL (sem `--offline`): `fdb_lv710_<aleatório>`, scripts/apoio-gf-lilly-v710/filho.js (HTTP das rotas da Lilly e do gate, legado SIMULADO,
 *      nenhuma flag GF_LEGADO_* ligada). Apaga o banco no fim.
 *   node scripts/verificar-gf-lilly-v710.js [--offline]
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Module = require('module');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const raiz = path.join(__dirname, '..');
const DOM = 'src/gestao-fadas/_comum/dominio';
const carregar = (nome) => require(path.join(raiz, DOM, nome));
let ok = 0;
const falhas = [];
const passo = (nome, fn) => { try { fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 500)}`); } };

const canon = (v) => JSON.stringify(v === undefined ? null : ordenar(v));
function ordenar(v) {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, ordenar(x)]));
  return v;
}
const roda = (fn) => { try { const v = fn(); return { v: v === undefined ? null : v }; } catch (e) { return { e: e.message, nome: e.name }; } };
const ouro = require('./apoio-gf-lilly-v710/ouro-v710.json');

function grupos(M) {
  const { oc, dup, conf, pi, reg, com, fech } = M;
  return {
    ocorrencia: (c) => oc.mesmaOcorrencia(c.a, c.b, ouro.hoje, c.now),
    duplicidade: (c) => {
      const o = { hoje: ouro.hoje, agora: c.now, excluirId: c.excluirId, nomeDaProfissional: c.nome };
      const achados = dup.duplicados(c.agenda, c.cand, o);
      return { ids: achados.map((x) => x.id), mensagem: achados[0] ? dup.mensagemDeDuplicidade(achados[0], c.agenda, o) : null };
    },
    conflitoFilaGeral: (c) => {
      const nomes = { osiris: 'Osíris', nyx: 'Nyx' };
      try { conf.exigirSemConflitoDaFilaGeral(c.agenda, c.origem, c.cand, { hoje: ouro.hoje, agora: c.now, nomeDaProfissional: (id) => nomes[id] }); return null; } catch (e) { return e.message; }
    },
    pedidos: (c) => ({
      duplicado: (pi.pedidoDuplicado(c.pedidos, c.cand, [], c.agenda, c.now) || {}).id ?? null,
      doPedido: (reg.agendamentoDoPedido(c.pedidos[0], c.agenda, c.now) || {}).id ?? null,
      elegivel: (reg.agendamentoElegivel(c.pedidos[0], c.agenda, [], c.now) || {}).id ?? null,
    }),
    pausa: (c) => ({ pausados: com.segundosPausadosEntre(c.c, c.de, c.ate), fim: roda(() => com.fimComPausas(c.c, c.seg, c.agora, c.c.startedAt)) }),
    fechamento: (c) => { const r = roda(() => fech.tempoDoFechamento(c.row, c.evento)); return r.e ? r : { v: r.v }; },
  };
}
const modulos = () => ({
  oc: carregar('agenda-ocorrencia'), dup: carregar('agenda-duplicidade'), conf: carregar('fila-geral-conflitos'), pi: carregar('agenda-pedido-identidade'), reg: carregar('agenda-pedido-registro'),
  com: carregar('consulta-comum'), fech: require(path.join(raiz, 'src/gestao-fadas/features/lilly/v710/fechamento.tempo')),
});
// O ouro de `fechamento` e `pausa` guarda { v } / { e } do front; a API devolve o mesmo formato.
const esperadoDe = (nome, c) => (nome === 'ocorrencia' || nome === 'conflitoFilaGeral' ? c.esperado : nome === 'fechamento' ? (c.esperado.e ? { e: c.esperado.e, nome: c.esperado.nome } : { v: c.esperado.v }) : c.esperado);

function mutante(arquivo, de, para, base = DOM) {
  const f = path.join(raiz, base, `${arquivo}.js`);
  const fonte = fs.readFileSync(f, 'utf8');
  assert.ok(fonte.includes(de), `o texto do mutante não existe em ${arquivo}: ${de}`);
  const alvos = [...new Set([f, ...['agenda-ocorrencia', 'agenda-duplicidade', 'fila-geral-conflitos', 'agenda-pedido-identidade', 'agenda-pedido-registro', 'agenda-identidade'].map((n) => path.join(raiz, DOM, `${n}.js`))])];
  const originais = new Map(alvos.map((a) => [a, Module._cache[a]]));
  const m = new Module(f, module);
  m.filename = f; m.paths = Module._nodeModulePaths(path.dirname(f));
  for (const a of alvos) delete Module._cache[a];
  m._compile(fonte.replace(de, para), f);
  Module._cache[f] = m;
  for (const a of alvos) if (a !== f) delete Module._cache[a]; // os dependentes recarregam com o mutante
  const mm = modulos();
  for (const [a, o] of originais) { if (o) Module._cache[a] = o; else delete Module._cache[a]; }
  return mm;
}

console.log('Ouro da Nice v710: cada função do domínio contra o código real');
for (const nome of Object.keys(ouro).filter((k) => Array.isArray(ouro[k]))) {
  passo(`${nome}: ${ouro[nome].length} casos iguais ao código real`, () => {
    const g = grupos(modulos())[nome];
    ouro[nome].forEach((c, i) => assert.strictEqual(canon(g(c)), canon(esperadoDe(nome, c)), `caso ${i}\n   esperado ${canon(esperadoDe(nome, c)).slice(0, 300)}\n   saiu     ${canon(g(c)).slice(0, 300)}`));
  });
}
passo('o ouro cobre os dois lados de cada regra (duplicado e livre; conflito e livre; ocorrência igual e diferente; fechamento apurado e nulo)', () => {
  const t = (nome, f) => assert.ok(ouro[nome].some(f), `sem caso: ${nome}`);
  t('ocorrencia', (c) => c.esperado === true); t('ocorrencia', (c) => c.esperado === false);
  t('duplicidade', (c) => c.esperado.ids.length > 0); t('duplicidade', (c) => c.esperado.ids.length === 0);
  t('conflitoFilaGeral', (c) => typeof c.esperado === 'string'); t('conflitoFilaGeral', (c) => c.esperado === null);
  t('pedidos', (c) => c.esperado.duplicado !== null); t('pedidos', (c) => c.esperado.duplicado === null);
  t('fechamento', (c) => c.esperado.v !== null && c.esperado.v !== undefined); t('fechamento', (c) => c.esperado.v === null);
  t('pausa', (c) => c.esperado.pausados > 0);
});

console.log('Mutantes: o ouro tem de pegar cada troca de regra');
const primeiraDivergencia = (M) => {
  const g = grupos(M);
  for (const nome of Object.keys(g)) for (const [i, c] of ouro[nome].entries()) if (canon(g[nome](c)) !== canon(esperadoDe(nome, c))) return { nome, i };
  return null;
};
const MUT = [
  ['agenda-ocorrencia', 'if (relogioA && relogioB) return dataA === dataB && relogioA === relogioB;', 'if (relogioA && relogioB) return dataA === dataB;', 'dois horários explícitos diferentes viram a mesma consulta'],
  ['agenda-ocorrencia', 'if (!relogioA && !relogioB) return (dataA <= hoje ? hoje : dataA) === (dataB <= hoje ? hoje : dataB);', 'if (!relogioA && !relogioB) return dataA === dataB;', 'pedido ativo de ontem vira outra entrada na virada do dia'],
  ['agenda-ocorrencia', 'if (dataSemHora > hoje) return false;', 'if (false) return false;', 'pedido sem horário de dia futuro vale como o de hoje'],
  ['agenda-ocorrencia', 'return devido !== null && devido <= agora;', 'return devido !== null;', 'horário de hoje ainda por vir já conta como a mesma consulta'],
  ['agenda-duplicidade', 'Boolean(candidato.requestId && item.requestId === candidato.requestId)', 'false', 'mesmo pedido (requestId) não é duplicidade'],
  ['agenda-duplicidade', 'const ativo = (item) => !encerrado(item) && item.workflowStatus !== \'Concluída\';', 'const ativo = () => true;', 'agendamento encerrado conta como duplicado'],
  ['agenda-duplicidade', "(item.queueReservation && item.queueReservation.tarotId) ?? item.tarotId", 'item.tarotId', 'reserva da Fila Geral ignorada na duplicidade'],
  ['agenda-duplicidade', "' O agendamento foi feito ontem.'", "''", 'a mensagem esquece que o agendamento foi feito ontem'],
  ['fila-geral-conflitos', "if ((dataA < hoje ? hoje : dataA) !== (dataB < hoje ? hoje : dataB)) return true;", "if (dataA !== dataB) return true;", 'pedido vencido de ontem libera outro destino'],
  ['fila-geral-conflitos', "if (dataA < hoje || dataB < hoje) return false;", "", 'pedido vencido vira independente de horário novo'],
  ['fila-geral-conflitos', "return Boolean(relogioA && relogioB && relogioA !== relogioB);", "return relogioA !== relogioB;", 'horário novo sozinho resolve outro pedido de horário desconhecido'],
  ['fila-geral-conflitos', "(o.tarotId === FILA_GERAL && mesmaOcorrencia(o, origem, hoje, agora))", "false", 'a origem duplicada na Fila Geral deixa de bloquear'],
  ['agenda-pedido-identidade', "if (ligado && encerrado(ligado)) return false;", "", 'pedido com agendamento encerrado ainda conta como repetido'],
  ['agenda-pedido-identidade', "|| !mesmaOcorrencia(p, candidato, candidato.date, agora)) return false;", ") return false;", 'pedido de outro horário explícito conta como repetido'],
  ['agenda-pedido-registro', "&& ativoNoDia(i, pedido.date, pedido.date) && mesmaOcorrencia(i, pedido, pedido.date, agora));\n  return iguais.length === 1", "&& ativoNoDia(i, pedido.date, pedido.date));\n  return iguais.length === 1", 'o agendamento do pedido ignora a ocorrência'],
  ['consulta-comum', 'total += Math.max(0, b - Math.max(a, coberto)); coberto = Math.max(coberto, b);', 'total += Math.max(0, b - a); coberto = Math.max(coberto, b);', 'pausas sobrepostas descontadas duas vezes'],
  ['consulta-comum', 'if (p.active) return new Date(Math.min(Math.max(cursor, p.start), maximo)).toISOString();', '', 'pausa em aberto vira minuto pago'],
  ['features/lilly/v710/fechamento.tempo', 'if (segundos <= 0 || segundos > decorrido + 1) return null;', 'if (segundos <= 0) return null;', 'minutos relatados acima do relógio fecham a consulta'],
  ['features/lilly/v710/fechamento.tempo', 'const segundos = relato !== null ? Math.round(relato * 60) : Math.floor(decorrido);', 'const segundos = Math.floor(decorrido);', 'o relato do tarólogo é ignorado'],
  ['features/lilly/v710/fechamento.tempo', 'billableMinutes: Math.ceil(minutos)', 'billableMinutes: Math.floor(minutos)', 'arredondamento de cobrança para baixo'],
];
for (const [arq, de, para, nome] of MUT) {
  passo(`mutante refutado: ${nome}`, () => {
    const base = arq.startsWith('features/') ? 'src/gestao-fadas' : DOM;
    const alvo = arq.startsWith('features/') ? arq : arq;
    const M = mutante(alvo, de, para, base);
    assert.ok(primeiraDivergencia(M), 'o ouro NÃO pegou o mutante');
  });
}

console.log(`\nOffline: ${ok} ok, ${falhas.length} falhas`);
if (process.argv.includes('--offline') || falhas.length) process.exit(falhas.length ? 1 : 0);

const banco = pg.nomeBanco('lv710');
const vazio = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
let codigo = 1;
try {
  pg.criar(banco);
  const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], vazio);
  if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
  console.log(`Banco ${banco} criado e migrado.`);
  const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-lilly-v710', 'filho.js')], vazio);
  process.stdout.write(f.stdout);
  if (f.status !== 0) process.stderr.write(f.stderr);
  codigo = f.status;
} catch (e) {
  console.error(e.message || e);
  codigo = 2;
} finally {
  pg.apagar(banco);
  const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_lv710_%'"], { encoding: 'utf8' }).trim();
  console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_lv710_* restante).');
}
process.exit(codigo);
