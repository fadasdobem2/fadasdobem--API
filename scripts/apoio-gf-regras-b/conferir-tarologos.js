'use strict';

/** Confere o ouro do PERFIL DO TARÓLOGO (Maturacao/44): inativar com consulta em curso (frase do front). */

const fs = require('fs');
const path = require('path');
const { conferirInativacao } = require('../../src/gestao-fadas/_comum/dominio/catalogo-tarologos');

function conferir() {
  const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'ouro-tarologos.json'), 'utf8'));
  const r = { aceitos: 0, recusas: 0, bloqueioDeAcesso: 0, falhas: [] };
  ouro.cenarios.forEach((c, i) => {
    const obtido = conferirInativacao(c.ativoNovo, c.consultas.filter((x) => x.tarotId === 't1'));
    if (c.esperado.erro !== undefined) { if (obtido === c.esperado.erro) r.recusas += 1; else r.falhas.push(`#${i} front "${c.esperado.erro}" servidor "${obtido}"`); }
    else if (obtido) r.falhas.push(`#${i} o front aceita e o servidor recusou`); else { r.aceitos += 1; if (!c.ativoNovo && c.contas) r.bloqueioDeAcesso += 1; }
  });
  return r;
}

module.exports = { conferir };
if (require.main === module) { const r = conferir(); console.log(JSON.stringify({ ...r, falhas: r.falhas.length })); console.log(r.falhas.slice(0, 20).join('\n')); }
