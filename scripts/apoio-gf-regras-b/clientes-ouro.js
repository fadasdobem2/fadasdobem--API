'use strict';

/** Ouro da EDIÇÃO DE CLIENTE (Maturacao/44): `legacyIdentityChanges` REAL (nome, tratar por, WhatsApp, nascimento, Pré/Pós) sobre combinações de borda. */

const { sorteador, tentar } = require('./front');

const NOMES = ['Ana Souza', '', '   ', ' Ana ', 'x'.repeat(50), 'x'.repeat(51), 'Ana\u0001', 'Ana\nSouza', 'Ana\tSouza', 'Bia 😀', 'João', 5, null, 'Ana B', 'Ana\u0085B'];
const TRATAR = ['', 'Aninha', 'x'.repeat(50), 'x'.repeat(51), '  ', 'Ana\nB', '😀', null];
const WHATS = ['', '+55 11 91234-5678', 'x'.repeat(45), 'x'.repeat(46), '11912345678', '😀', 'a\u0007b', 99];
const NASC = ['', ' ', '10/05/1990', '10/5/1990', '1990-05-10', '30/02/1990', '31/04/1990', '29/02/2000', '29/02/2001', '00/01/1990', '01/13/1990', '10/05/0001', '10/05/1899', '10/05/1900', '31/12/9999', '10/05/2999', 'abc', null];
const PERFIS = ['', 'Pré-pago', 'Pós-pago', 'Pré', 'pré-pago', null, 'x'];
const IDS = ['12345', '1', '', ' 12 ', 'abc', '12345678901234'];

async function gerar(ctx) {
  const mod = await ctx.carregar('/features/integration/legacy-client-write.ts');
  const { sorteio, alea } = sorteador(20261204);
  const cenarios = [];
  const add = (id, mudancas) => {
    const r = tentar(() => mod.legacyIdentityChanges(id, mudancas));
    cenarios.push({ id, mudancas, esperado: r.ok ? { ok: r.ok } : { erro: r.erro } });
  };
  for (const [campo, lista] of [['name', NOMES], ['treatAs', TRATAR], ['whatsapp', WHATS], ['birthDate', NASC], ['paymentProfile', PERFIS]]) for (const v of lista) add('12345', { [campo]: v });
  for (const id of IDS) add(id, { name: 'Ana' });
  add('12345', {});
  for (let i = 0; i < 1500; i += 1) {
    const m = {};
    if (alea() < 0.5) m.name = sorteio(NOMES); if (alea() < 0.4) m.treatAs = sorteio(TRATAR); if (alea() < 0.4) m.whatsapp = sorteio(WHATS);
    if (alea() < 0.4) m.birthDate = sorteio(NASC); if (alea() < 0.4) m.paymentProfile = sorteio(PERFIS);
    add(sorteio(IDS.slice(0, 2)), m);
  }
  // Decisão da conferência da divergência (`validateObservation`): texto livre, mas com limite, controle e obrigatoriedade.
  const iv = await ctx.carregar('/features/domain/input-validation.ts');
  const textos = ['', '  ', 'Mantido.', 'linha 1\nlinha 2', 'a\tb', 'x'.repeat(4000), 'x'.repeat(4001), '😀'.repeat(4000), '😀'.repeat(4001), 'a\u0001b', 'a\u007fb', 'a\u0085b', 5, null, 'a\u2028b', ' x '];
  const observacoes = [];
  for (const t of textos) for (const obrig of [false, true]) { const r = tentar(() => iv.validateObservation(t, 'Decisão da conferência', obrig)); observacoes.push({ texto: t, obrig, esperado: r.ok !== undefined ? { ok: r.ok } : { erro: r.erro } }); }
  return { cenarios, observacoes };
}

module.exports = { gerar };
