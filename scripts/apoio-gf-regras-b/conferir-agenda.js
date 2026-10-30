'use strict';

/** Confere o ouro da AGENDA (Maturacao/44) contra o servidor. Devolve contagens e falhas; sem banco. */

const fs = require('fs');
const path = require('path');
const { reproduzir, resumo } = require('./replay-agenda');
const { planoDeContato } = require('../../src/gestao-fadas/_comum/dominio/agenda-regras');

function conferir() {
  const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'ouro-agenda.json'), 'utf8'));
  const r = { aceitos: 0, recusas: 0, frases: 0, bloqueados: 0, nada: 0, falhas: [], porAcao: {} };
  const marca = (c) => { const k = c.acao.split(':')[0]; r.porAcao[k] = (r.porAcao[k] || 0) + 1; };
  ouro.cenarios.forEach((c, i) => {
    marca(c);
    if (c.tipo === 'nada') { r.nada += 1; return; }
    const antes = ouro.estados[c.antes];
    if (c.tipo === 'comando') {
      const s = reproduzir(antes, c.comandos, c.at);
      if (s.item && resumo(s.item) === c.resumo) r.aceitos += 1; else r.falhas.push(`#${i} ${c.acao}: o front grava e o servidor ${s.erro ? `recusou "${s.erro}"` : 'devolveu item diferente'}`);
    } else if (c.tipo === 'recusa') {
      const s = reproduzir(antes, c.comandos, c.at);
      if (s.erro === undefined) r.falhas.push(`#${i} ${c.acao}: o front recusa ("${c.erro}") e o servidor aceitou`); else { r.recusas += 1; if (s.erro !== c.erro && !FRASES_DE_VERSAO.has(c.erro)) r.falhas.push(`#${i} ${c.acao}: frase do front "${c.erro}" servidor "${s.erro}"`); }
    } else if (c.tipo === 'recusa-frase') {
      let obtido = null; try { planoDeContato(c.plano); } catch (e) { obtido = e.message; }
      if (obtido !== c.erro) r.falhas.push(`#${i} ${c.acao}: front "${c.erro}" servidor "${obtido}"`); else r.frases += 1;
    } else if (c.tipo === 'bloqueado-na-tela') { r.bloqueados += 1; } else if (c.tipo === 'versao') { r.versao = (r.versao || 0) + 1; } else if (c.tipo === 'so-no-front') { r.soFront = (r.soFront || 0) + 1; }
  });
  return r;
}
/** Frases de versão que o servidor devolve como 409 (a tela mostra a do front). */
const FRASES_DE_VERSAO = new Set(['Esta observação mudou. Confira o texto atualizado antes de salvar.', 'O prazo foi atualizado. Confira o registro antes de informar outro.']);

module.exports = { conferir };
if (require.main === module) { const r = conferir(); console.log(JSON.stringify({ ...r, falhas: r.falhas.length }), '\n', r.falhas.slice(0, 40).join('\n')); }
