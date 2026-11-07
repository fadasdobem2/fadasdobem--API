'use strict';

/**
 * Verificação do horário semanal estruturado do cadastro (v706) contra o ouro do CÓDIGO REAL do front, com mutantes.
 *   node scripts/verificar-gf-cadastros-horarios.js      (offline)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const cad = require('../src/gestao-fadas/_comum/dominio/cadastro-tarologo');

const { horarios } = cad;
const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'apoio-gf-cadastros', 'ouro-horarios-front.json'), 'utf8'));
const limpo = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));
const porte = (c) => {
  if (c.tipo === 'validar') {
    try { const r = cad.validarCadastro(c.entrada); return { weeklySchedule: r.weeklySchedule, weeklyScheduleEffectiveFrom: r.weeklyScheduleEffectiveFrom, weeklyScheduleBase: r.weeklyScheduleBase, weeklyScheduleVersions: r.weeklyScheduleVersions }; } catch (e) { if (e instanceof cad.CadastroInvalidoError) return { erro: e.message }; throw e; }
  }
  return c.tipo === 'preparar' ? horarios.prepararHorario(c.proximo, c.anterior, c.hoje) : horarios.horarioNaData(c.perfil, c.data);
};
let ok = 0; const falhas = [];
for (const [k, { caso, esperado }] of ouro.cenarios.entries()) {
  try { assert.deepStrictEqual(limpo(porte(caso)), esperado); ok += 1; } catch (e) { falhas.push(`#${k} ${caso.tipo}: ${String(e.message).split('\n').slice(0, 3).join(' ').slice(0, 200)}`); }
}
console.log(`  ${ok}/${ouro.cenarios.length} cenários iguais ao front`);
const por = (t, recusa) => ouro.cenarios.filter((c) => c.caso.tipo === t && Boolean(c.esperado && c.esperado.erro) === recusa).length;
if (!(por('validar', true) > 15 && por('validar', false) > 100 && por('preparar', false) > 500)) falhas.push('cobertura baixa do ouro');
// Mutantes: o que o front muda tem de mudar aqui também.
const prep = ouro.cenarios.filter((c) => c.caso.tipo === 'preparar' && c.caso.anterior && c.esperado.weeklyScheduleVersions && c.esperado.weeklyScheduleVersions.length > 1);
assert.ok(prep.length > 20, 'há preparação com histórico');
let diferentes = 0;
for (const c of prep) { const r = horarios.prepararHorario(c.caso.proximo, c.caso.anterior, '2026-11-08'); if (JSON.stringify(r) !== JSON.stringify(c.esperado)) diferentes += 1; }
if (diferentes < 5) falhas.push('mutante (outro "hoje") não alterou nada: o ouro não depende do dia');
assert.deepEqual(horarios.horarioNaData({ weeklySchedule: { segunda: 'A' }, weeklyScheduleVersions: [{ effectiveFrom: '2026-11-10', schedule: { segunda: 'B' } }] }, '2026-11-09'), { segunda: 'A' });
assert.deepEqual(horarios.horarioNaData({ weeklySchedule: { segunda: 'A' }, weeklyScheduleVersions: [{ effectiveFrom: '2026-11-10', schedule: { segunda: 'B' } }] }, '2026-11-10'), { segunda: 'B' });
if (falhas.length) { console.log(falhas.slice(0, 12).join('\n')); console.log(`FALHOU: ${falhas.length}`); process.exit(1); }
console.log('Horários do cadastro v706: ok');
