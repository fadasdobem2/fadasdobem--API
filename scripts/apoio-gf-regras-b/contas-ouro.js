'use strict';

/**
 * Ouro das CONTAS (Maturacao/44): `planAccountCommand` REAL (as checagens do diálogo de conta no modo real: nome, e-mail, duplicidade, senha forte,
 * troca de senha, o que mudou numa edição) sobre muitos rascunhos, e `strongAccountPassword` REAL sobre senhas de borda.
 */

const { sorteador } = require('./front');

const CONTAS = [
  { id: 'u1', name: 'Clara Gestora', email: 'clara@exemplo.com', role: 'administradora', commission: '—', access: 'Hoje, 10:00', active: true },
  { id: 'u2', name: 'Bia Atendente', email: 'Bia@Exemplo.com', role: 'atendente', commission: '—', access: 'Ainda não acessou', active: true, legacyId: '77' },
  { id: 'u3', name: 'Lia Supervisora', email: 'lia@exemplo.com', role: 'supervisora', commission: '—', access: 'Ontem, 22:10', active: false, avatar: 'data:image/png;base64,AAAA' },
];
const NOMES = ['', '   ', 'Ana', '  Ana   Maria  ', 'Clara Gestora', 'Ana\nMaria', 'x'.repeat(80)];
const EMAILS = ['', ' ', 'ana@exemplo.com', 'ANA@EXEMPLO.COM', 'clara@exemplo.com', 'CLARA@exemplo.com', 'bia@exemplo.com', 'sem-arroba', 'a@b', 'a b@c.com', ' ana@exemplo.com ', 'ana@@x.com', 'ana@x.com.br', 'a@b.c'];
const SENHAS = ['', 'curta', 'semmaiuscula123!', 'SEMMINUSCULA123!', 'SemNumeroAqui!!', 'SemSimbolo1234A', 'Valida#Senha123', 'Valida#Senha123 ', 'x'.repeat(200)];
const PAPEIS = ['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'];
const AVATARES = [undefined, 'data:image/png;base64,AAAA', 'https://x.com/a.png'];

async function gerar(ctx) {
  const pl = await ctx.carregar('/features/integration/accounts/real-accounts-plan.ts');
  const dc = await ctx.carregar('/features/auth/demo-credentials.ts');
  const { sorteio, alea } = sorteador(20261203);
  const cenarios = [];
  for (let i = 0; i < 2500; i += 1) {
    const editing = alea() < 0.5 ? sorteio(CONTAS) : undefined;
    const draft = {
      editing, tarotId: alea() < 0.2 ? 't-1' : undefined, name: alea() < 0.4 && editing ? editing.name : sorteio(NOMES), email: alea() < 0.4 && editing ? editing.email : sorteio(EMAILS),
      legacyId: alea() < 0.3 ? (editing?.legacyId ?? '') : sorteio(['', '12', ' 55 ']), role: alea() < 0.5 && editing ? editing.role : sorteio(PAPEIS), password: sorteio(SENHAS), confirmation: '', avatar: sorteio(AVATARES),
      passwordRequired: alea() < 0.6, registrationName: undefined,
    };
    if (draft.role !== 'tarologa') draft.tarotId = undefined; else if (!draft.tarotId && alea() < 0.7) draft.tarotId = 't-1';
    draft.confirmation = alea() < 0.8 ? draft.password : sorteio(SENHAS);
    const resetting = Boolean(editing) && alea() < 0.25;
    if (resetting) draft.passwordRequired = true; // a troca de senha sempre exige a senha nova (user-account-dialog.tsx, modo 'reset')
    cenarios.push({ draft, resetting, esperado: pl.planAccountCommand(draft, CONTAS, resetting) });
  }
  const senhas = SENHAS.concat(['Abcdefghij1!', 'Abcdefghij1', 'abcdefghij1!', 'ABCDEFGHIJ1!', 'Abcdefghij!!', 'Abc1!', 'Ação#Forte1234', '12345678901!aA']).map((s) => ({ s, forte: dc.strongAccountPassword(s) }));
  return { contas: CONTAS, cenarios, senhas };
}

module.exports = { gerar };
