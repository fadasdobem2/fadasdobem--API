'use strict';

/** Confere o ouro da EDIÇÃO DE CLIENTE (Maturacao/44) contra `clientes.validacao.js` (`validarMudancas`): mesma frase e mesmos valores gravados. */

const fs = require('fs');
const path = require('path');
const val = require('../../src/gestao-fadas/features/cadastros/clientes.validacao');

function conferir() {
  const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'ouro-clientes.json'), 'utf8'));
  const r = { aceitos: 0, recusas: 0, falhas: [] };
  ouro.cenarios.forEach((c, i) => {
    let s; try { s = { ok: val.validarMudancas(c.mudancas) }; } catch (e) { s = { erro: e.message }; }
    // O id do cliente é validado pela rota (`validateClientId`); aqui só as mudanças.
    const fora = (m) => { r.fora = (r.fora || 0) + 1; r.motivos = r.motivos || {}; r.motivos[m] = (r.motivos[m] || 0) + 1; };
    if (c.esperado.erro !== undefined && c.esperado.erro.startsWith('ID da cliente')) { fora('id (validado na rota)'); return; }
    if (c.esperado.ok && !Object.keys(c.mudancas).length) { fora('pedido vazio (o front nem envia)'); return; }
    if (c.esperado.erro !== undefined && c.esperado.erro.startsWith('Cannot read')) { fora('valor que não é texto (TypeError do front)'); return; }
    if (c.esperado.ok) {
      const { legacy, extension } = c.esperado.ok;
      const esperado = {};
      if (legacy.nome_id !== undefined) esperado.name = legacy.nome_id;
      if (legacy.nome2 !== undefined) esperado.treatAs = legacy.nome2;
      if (legacy.whats !== undefined) esperado.whatsapp = legacy.whats;
      if (legacy.datanascimento !== undefined) esperado.birthDate = c.mudancas.birthDate.trim();
      if (extension.payment_profile !== undefined) esperado.paymentProfile = extension.payment_profile;
      if (s.erro) r.falhas.push(`#${i} ${JSON.stringify(c.mudancas)}: o front aceita e o servidor recusou "${s.erro}"`);
      else if (JSON.stringify(Object.entries(s.ok).sort()) !== JSON.stringify(Object.entries(esperado).sort())) r.falhas.push(`#${i} ${JSON.stringify(c.mudancas)}: valores ${JSON.stringify(s.ok)} x ${JSON.stringify(esperado)}`);
      else r.aceitos += 1;
    } else if (s.erro === c.esperado.erro) r.recusas += 1;
    else r.falhas.push(`#${i} ${JSON.stringify(c.mudancas)}: front "${c.esperado.erro}" servidor "${s.erro || 'aceitou'}"`);
  });
  r.observacoes = 0;
  const tf = require('../../src/gestao-fadas/_comum/dominio/texto-front');
  for (const o of ouro.observacoes || []) {
    let s; try { s = { ok: tf.validarObservacao(o.texto, 'Decisão da conferência', o.obrig) }; } catch (e) { s = { erro: e.message }; }
    if ((s.ok !== undefined ? s.ok : s.erro) === (o.esperado.ok !== undefined ? o.esperado.ok : o.esperado.erro)) r.observacoes += 1; else r.falhas.push(`decisão ${JSON.stringify(o.texto).slice(0, 30)} obrig=${o.obrig}: front ${JSON.stringify(o.esperado)} servidor ${JSON.stringify(s).slice(0, 80)}`);
  }
  return r;
}

module.exports = { conferir };
if (require.main === module) { const r = conferir(); console.log(JSON.stringify({ ...r, falhas: r.falhas.length })); console.log(r.falhas.slice(0, 40).join('\n')); }
