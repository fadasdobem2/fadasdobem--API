'use strict';

/** Confere o ouro do CADASTRO DE TARÓLOGO (Maturacao/44) contra `_comum/dominio/cadastro-tarologo.js`. */

const fs = require('fs');
const path = require('path');
const { limpar } = require('../../src/gestao-fadas/_comum/dominio/agenda-contato');
const dom = require('../../src/gestao-fadas/_comum/dominio/cadastro-tarologo');

const forma = (v) => JSON.stringify(limpar(v));

function conferir() {
  const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'ouro-cadastro.json'), 'utf8'));
  const r = { aceitos: 0, recusas: 0, aprovacoes: 0, falhas: [] };
  ouro.cenarios.forEach((c, i) => {
    let obtido;
    try { obtido = { ok: dom.validarCadastro(c.entrada, { publica: c.publica, hoje: ouro.hoje }) }; } catch (e) { obtido = { erro: e.message }; }
    if (c.esperado.ok !== undefined) {
      if (obtido.erro) r.falhas.push(`#${i} o front aceita e o servidor recusou: ${obtido.erro}`);
      else if (forma(obtido.ok) !== forma(c.esperado.ok)) r.falhas.push(`#${i} registro diferente (${Object.keys(obtido.ok).filter((k) => forma(obtido.ok[k]) !== forma(c.esperado.ok[k])).join(',')})`);
      else r.aceitos += 1;
    } else if (obtido.erro !== c.esperado.erro) r.falhas.push(`#${i} front "${c.esperado.erro}" servidor "${obtido.erro || 'aceitou'}"`); else r.recusas += 1;
  });
  for (const a of ouro.aprovacoes) {
    const pub = dom.perfilPublico(a.data, 'luna-real');
    const proj = dom.projecaoAprovada({ id: 'reg-1', revisao: 3, dados: a.data, tarotId: 'luna-real' });
    if (forma(pub) === forma(a.publico) && forma(proj) === forma(a.projecao)) r.aprovacoes += 1; else r.falhas.push('aprovação: perfil público ou projeção diferente do front');
  }
  return r;
}

module.exports = { conferir };
if (require.main === module) { const r = conferir(); console.log(JSON.stringify({ ...r, falhas: r.falhas.length })); console.log(r.falhas.slice(0, 30).join('\n')); }
