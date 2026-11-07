'use strict';

/**
 * Compara o domínio do servidor com o OURO gerado do front (ouro-ponto-front.json) e refuta mutantes do código do servidor
 * (uma troca de texto no fonte tem de fazer o ouro falhar). Usado por scripts/verificar-gf-ponto.js.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Module = require('module');
const { executarTurno, executarCalendario, executarEscala, executarRegistro } = require('./resumo');
const { executarJornada } = require('./resumo-jornada');

const RAIZ = path.join(__dirname, '..', '..');
const DOM = 'src/gestao-fadas/_comum/dominio';
const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'ouro-ponto-front.json'), 'utf8'));

/** Carrega um arquivo do servidor com UMA troca de texto (mutante), sem tocar o disco. `de` nulo = cópia fresca. */
function carregarMutante(rel, de, para) {
  const arquivo = path.join(RAIZ, rel); let fonte = fs.readFileSync(arquivo, 'utf8');
  if (de !== null) { if (!fonte.includes(de)) throw new Error(`mutante sem alvo em ${rel}: ${de}`); fonte = fonte.replace(de, para); }
  const m = new Module(arquivo, module); m.filename = arquivo; m.paths = Module._nodeModulePaths(path.dirname(arquivo)); m._compile(fonte, arquivo);
  return m.exports;
}

/** Funções do servidor no formato que `resumo.js` espera. Cada módulo pode ser trocado por uma versão mutante. */
function fnsDoServidor(mods = {}) {
  const rq = (n) => mods[n] || require(path.join(RAIZ, DOM, n));
  const t = rq('ponto-turno'); const c = rq('operacao-calendario'); const e = rq('ponto-escala'); const j = rq('ponto-jornada'); const r = rq('escala-registro');
  return {
    turno: { apply: t.aplicarComandoDePonto, status: t.estadoDoTurno, canStart: (turno, em) => t.podeIniciarTurno(turno, em) },
    calendario: { ...c, DEFAULT: c.DEFAULT_OPERATION_SETTINGS }, escala: { valid: e.validStaffRoster, edit: e.editStaffRoster, forDate: e.staffRosterForDate, describe: e.describeStaffPeriods },
    jornada: j, registro: r,
  };
}

/** Roda todo o ouro; devolve `{ falhas: [mensagens], contagem }`. */
function compararOuro(fns, { parar = false } = {}) {
  const falhas = []; const contagem = { turno: 0, calendario: 0, escala: 0, registro: 0, jornada: 0 };
  const cmp = (rotulo, esperado, obtido) => {
    try { assert.deepStrictEqual(JSON.parse(JSON.stringify(obtido)), esperado); } catch (_e) { falhas.push(`${rotulo}\n  esperado ${JSON.stringify(esperado).slice(0, 300)}\n  obtido   ${JSON.stringify(obtido).slice(0, 300)}`); }
    return parar && falhas.length;
  };
  for (const g of ouro.turno) { contagem.turno += 1; if (cmp(g.caso.nome, g.esperado, executarTurno(fns, g.caso))) return { falhas, contagem }; }
  contagem.calendario = ouro.calendario.grupo.casos.length;
  const cal = executarCalendario(fns, ouro.calendario.grupo);
  for (const k of Object.keys(ouro.calendario.esperado)) if (cmp(`calendário ${k}`, ouro.calendario.esperado[k], cal[k]) && parar) return { falhas, contagem };
  for (const g of ouro.escala) { contagem.escala += 1; if (cmp(g.caso.nome, g.esperado, executarEscala(fns, g.caso))) return { falhas, contagem }; }
  for (const g of ouro.registro) { contagem.registro += 1; if (cmp(g.caso.nome, g.esperado, executarRegistro(fns, g.caso))) return { falhas, contagem }; }
  for (const g of ouro.jornada) { contagem.jornada += 1; if (cmp(g.entrada.nome, g.esperado, executarJornada(fns, g.entrada))) return { falhas, contagem }; }
  return { falhas, contagem };
}

/** Mutantes: [arquivo, trecho, troca, módulo afetado]. Cada um tem de ser pego pelo ouro. */
const MUTANTES = [
  ['ponto-turno.js', '3 * STAFF_CLOCK_HEARTBEAT_MS', '4 * STAFF_CLOCK_HEARTBEAT_MS', 'ponto-turno'],
  ['ponto-turno.js', 'STAFF_CLOCK_HEARTBEAT_MS / 2', 'STAFF_CLOCK_HEARTBEAT_MS / 3', 'ponto-turno'],
  ['ponto-turno.js', 'agora - Date.parse(turno.lastSeenAt) > SEM_SINAL_APOS_MS', 'agora - Date.parse(turno.lastSeenAt) >= SEM_SINAL_APOS_MS', 'ponto-turno'],
  ['ponto-turno.js', "if (ultimoTipo !== 'lost') eventos.push", 'if (true) eventos.push', 'ponto-turno'],
  ['ponto-turno.js', 'operationalDateAt(turno.lastSeenAt, historia) !== operationalDateAt', 'operationalDateAt(turno.lastSeenAt, historia) === operationalDateAt', 'ponto-turno'],
  ['ponto-turno.js', "!anterior.endedAt || operationalDateAt(anterior.endedAt) !== data", "!anterior.endedAt || operationalDateAt(anterior.endedAt) === data", 'ponto-turno'],
  ['ponto-turno.js', "if (comando === 'start') return anterior;", "if (comando === 'start') return { ...anterior, lastSeenAt: carimbo };", 'ponto-turno'],
  ['ponto-escala.js', 'p.from >= ordenados[i - 1].until', 'p.from > ordenados[i - 1].until', 'ponto-escala'],
  ['ponto-escala.js', 'v.length > 12', 'v.length > 13', 'ponto-escala'],
  ['ponto-escala.js', 'timeMinutes(p.start) >= sobra', 'timeMinutes(p.start) > sobra', 'ponto-escala'],
  ['operacao-calendario.js', 'em < Date.parse(operationalDayStart(civil, historia))', 'em <= Date.parse(operationalDayStart(civil, historia))', 'operacao-calendario'],
  ['operacao-calendario.js', 'timeMinutes(v.metricsTime) < timeMinutes(v.dayStart)', 'timeMinutes(v.metricsTime) <= timeMinutes(v.dayStart)', 'operacao-calendario'],
  ['operacao-calendario.js', 'v.effectiveFrom <= data', 'v.effectiveFrom < data', 'operacao-calendario'],
  ['ponto-jornada.js', 'minutos >= minimo', 'minutos > minimo', 'ponto-jornada'],
  ['ponto-jornada.js', "(e.kind === 'resume' || e.kind === 'end')", "(e.kind === 'resume')", 'ponto-jornada'],
  ['ponto-jornada.js', 'Date.parse(ultimo.endedAt || ultimo.lastSeenAt) > dia.end', 'Date.parse(ultimo.endedAt || ultimo.lastSeenAt) >= dia.end', 'ponto-jornada'],
  ['escala-registro.js', 'data >= hoje && !isClosedRosterSunday', 'data > hoje && !isClosedRosterSunday', 'escala-registro'],
  ["escala-registro.js", "if (real.source === 'confirmed' || real.source === 'return') return { status", "if (real.source === 'confirmed') return { status", 'escala-registro'],
  ['escala-registro.js', 'if (diaDaSemana(data) !== 0) return false;', 'if (diaDaSemana(data) !== 0 && diaDaSemana(data) !== 1) return false;', 'escala-registro'],
  ['escala-registro.js', "if (entrada.status === 'pending' || isClosedRosterSunday(perfil, excecoes, data, feriados)) return undefined;", "if (entrada.status === 'pending') return undefined;", 'escala-registro'],
  ['escala-registro.js', 'hoje >= somarDias(nextRosterSaturday(hoje), -2)', 'hoje >= somarDias(nextRosterSaturday(hoje), -3)', 'escala-registro'],
];

/** Mutante de `presenca-agenda.js` (versão do horário habitual), que o domínio da Escala usa. */
function mutantePresenca() {
  const arquivo = path.join(RAIZ, DOM, 'presenca-agenda.js'); const antes = require.cache[arquivo];
  const mut = carregarMutante(`${DOM}/presenca-agenda.js`, 'b.effectiveFrom.localeCompare(a.effectiveFrom)', 'a.effectiveFrom.localeCompare(b.effectiveFrom)');
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: mut };
  try { return carregarMutante(`${DOM}/escala-registro.js`, null); } finally { if (antes) require.cache[arquivo] = antes; else delete require.cache[arquivo]; }
}

module.exports = { ouro, DOM, carregarMutante, fnsDoServidor, compararOuro, mutantePresenca, MUTANTES };
