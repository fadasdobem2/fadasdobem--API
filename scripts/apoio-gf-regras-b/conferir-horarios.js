'use strict';

/** Confere o ouro dos HORÁRIOS (Maturacao/44) contra o servidor (validação do corpo + `guardarExcecao`). Sem banco. */

const fs = require('fs');
const path = require('path');
const { limpar } = require('../../src/gestao-fadas/_comum/dominio/agenda-contato');
const { guardarExcecao } = require('../../src/gestao-fadas/_comum/dominio/horarios');
const val = require('../../src/gestao-fadas/features/horarios/horarios.validacao');

const forma = (v) => JSON.stringify(limpar(v));
const ID = 'osiris';
const corpo = (override, extra = {}) => ({ operationKey: 'op-12345678', expectedRevision: 'x', override, ...extra });
/** Quem é a taróloga ("datas passadas" só para ela) entra pelo perfil; a regra de data é do serviço, aqui só o corpo. */
const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e.message }; } };

function reproduzir(antes, comandos) {
  let mapa = { ...antes };
  for (const c of comandos) {
    if (c.kind === 'put') {
      const v = tentar(() => val.corpoExcecao(corpo(c.override, c.replaceKey ? { replaceKey: c.replaceKey } : {})));
      if (v.erro) return { erro: v.erro };
      mapa = guardarExcecao(mapa, c.tarotId, v.ok.override, v.ok.replaceKey);
    } else delete mapa[c.key];
  }
  return { mapa };
}

function conferir() {
  const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'ouro-horarios.json'), 'utf8'));
  const r = { aceitos: 0, recusas: 0, frases: 0, falhas: [], porOrigem: {} };
  ouro.cenarios.forEach((c, i) => {
    const antes = ouro.estados[c.antes];
    if (c.tipo === 'comando') {
      r.porOrigem[c.origem] = (r.porOrigem[c.origem] || 0) + 1;
      const s = reproduzir(antes, c.comandos);
      if (s.mapa && forma(s.mapa) === forma(c.depois)) r.aceitos += 1; else r.falhas.push(`#${i} ${c.acao} (${c.origem}): ${s.erro ? `o servidor recusou "${s.erro}"` : 'conjunto de exceções diferente do front'}`);
    } else {
      const v = tentar(() => val.corpoExcecao(corpo(c.forjado), { tarologa: c.perfil === 'tarologa', hoje: ouro.hoje }));
      const obtido = v.erro || null;
      if (obtido === null) r.falhas.push(`#${i} ${c.acao}: o front recusa ("${c.erro}") e o servidor aceitou`);
      else if (obtido !== c.erro && !(c.perfil === 'equipe' && c.erro.startsWith('A saída precisa') && obtido.startsWith('A entrada e a saída'))) r.falhas.push(`#${i} ${c.acao}: front "${c.erro}" servidor "${obtido}"`);
      else r.recusas += 1;
    }
  });
  // `validateOwnWorkPeriods` (maximo 3, a união dos caminhos): mesma frase; com maximo 2 (editor da equipe) o servidor aceita 3 períodos, o front do editor não os oferece.
  for (const f of ouro.frases) {
    if (f.max !== 3) continue;
    const v = tentar(() => val.corpoExcecao(corpo({ todayHours: 'x', periods: f.periodos.map((p) => ({ ...p })), note: '', updatedAt: 'a', absenceType: 'Nenhuma', startDate: '2026-11-10', endDate: '2026-11-10' }), { tarologa: true }));
    if ((v.erro || null) !== f.erro) r.falhas.push(`frase ${JSON.stringify(f.periodos)}: front ${f.erro} servidor ${v.erro || null}`); else r.frases += 1;
  }
  return r;
}

module.exports = { conferir, reproduzir };
if (require.main === module) { const r = conferir(); console.log(JSON.stringify({ ...r, falhas: r.falhas.length })); console.log(r.falhas.slice(0, 40).join('\n')); }
