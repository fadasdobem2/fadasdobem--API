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
  r.diretorio = 0;
  const dir = require('../../src/gestao-fadas/_comum/dominio/catalogo-tarologos');
  for (const d of ouro.diretorio || []) {
    let o; try { o = { ok: d.campo === 'grupos+nenhum' ? dir.validarDiretorio({ capabilityGroups: d.grupos, capabilityNone: d.nenhum }) : dir.validarDiretorio(d.ausente ? {} : { [d.campo]: d.valor }) }; } catch (e) { o = { erro: e.message }; }
    if (d.esperado.erro !== undefined) { if (o.erro === d.esperado.erro) r.diretorio += 1; else r.falhas.push(`diretório ${d.campo}=${JSON.stringify(d.valor).slice(0, 40)}: front "${d.esperado.erro}" servidor "${o.erro || 'aceitou'}"`); }
    else if (o.erro) r.falhas.push(`diretório ${d.campo}=${JSON.stringify(d.valor).slice(0, 40)}: front aceita, servidor recusou "${o.erro}"`);
    else if (d.campo !== 'grupos+nenhum' && !d.ausente && JSON.stringify(o.ok[d.campo]) !== JSON.stringify(d.esperado.ok)) r.falhas.push(`diretório ${d.campo}: valor ${JSON.stringify(o.ok[d.campo])} x ${JSON.stringify(d.esperado.ok)}`); else r.diretorio += 1;
  }
  return r;
}

module.exports = { conferir };
if (require.main === module) { const r = conferir(); console.log(JSON.stringify({ ...r, falhas: r.falhas.length })); console.log(r.falhas.slice(0, 30).join('\n')); }
