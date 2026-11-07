'use strict';

/** Confere o ouro das CONTAS (Maturacao/44): validação do corpo (`contas.validacao`) na MESMA ordem do front + e-mail do Fadas + unicidade de e-mail; a força da senha (15) vai pelo ouro das `senhas`. */

const fs = require('fs');
const path = require('path');
const dom = require('../../src/gestao-fadas/_comum/dominio/contas');
const val = require('../../src/gestao-fadas/features/contas/contas.validacao');

const UUID = '11111111-1111-4111-8111-111111111111';
const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e.message, status: e.statusCode || e.status }; } };

/** O que o serviço faz com o corpo, em ordem (sem banco): corpo (nome, e-mail, e-mail do Fadas) -> e-mail já cadastrado -> vínculo da taróloga. v706: sem senha. */
function servidor(draft, contas) {
  const idAlvo = draft.editing ? draft.editing.id : undefined;
  const emUso = (email) => contas.some((c) => c.id !== idAlvo && dom.emailChave(c.email) === dom.emailChave(email));
  const corpo = draft.editing
    ? tentar(() => val.corpoEditar({ operationKey: 'op-12345678', expectedRevision: 1, name: draft.name, email: draft.email }))
    : tentar(() => val.corpoCriar({ operationKey: 'op-12345678', name: draft.name, email: draft.email, role: draft.role, ...(draft.tarotId ? { tarotId: draft.tarotId } : {}) }));
  if (corpo.erro) return corpo;
  if (emUso(draft.email.trim())) return { erro: dom.MSG.emailEmUso };
  if (!draft.editing && draft.role === 'tarologa' && !draft.tarotId) return { erro: dom.MSG.semCadastro };
  return corpo;
}

function conferir() {
  const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'ouro-contas.json'), 'utf8'));
  const r = { aceitos: 0, recusas: 0, senhas: 0, falhas: [] };
  ouro.cenarios.forEach((c, i) => {
    const d = c.draft;
    const s = servidor(d, ouro.contas);
    if (c.esperado.error !== undefined) {
      if (s.erro === c.esperado.error) r.recusas += 1; else r.falhas.push(`#${i} front "${c.esperado.error}" servidor "${s.erro || 'aceitou'}"`);
    } else if (s.erro) r.falhas.push(`#${i} o front aceita (${c.esperado.kind}) e o servidor recusou: ${s.erro}`);
    else {
      const cmd = c.esperado; const ok = s.ok;
      const esperadoNome = cmd.kind === 'edit' ? cmd.input.name : cmd.kind === 'create' ? cmd.input.name : undefined;
      if (esperadoNome !== undefined && ok.name !== esperadoNome) r.falhas.push(`#${i} nome ${ok.name} x ${esperadoNome}`);
      else r.aceitos += 1;
    }
  });
  r.vinculos = 0;
  for (const v of ouro.vinculo || []) { const o = dom.conferirVinculo(v); if (o === v.esperado) r.vinculos += 1; else r.falhas.push(`vínculo ${JSON.stringify(v)}: front ${v.esperado} servidor ${o}`); }
  for (const x of ouro.senhas) { if (dom.senhaForte(x.s) === x.forte) r.senhas += 1; else r.falhas.push(`senha "${x.s}": front ${x.forte} servidor ${!x.forte}`); }
  return r;
}

module.exports = { conferir };
if (require.main === module) { const r = conferir(); console.log(JSON.stringify({ ...r, falhas: r.falhas.length })); console.log(r.falhas.slice(0, 30).join('\n')); }
