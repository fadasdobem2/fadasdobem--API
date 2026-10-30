'use strict';

/**
 * Ouro do CADASTRO DE TARÓLOGO (Maturacao/44): `validateRegistrationData` REAL (formulário público e edição da administradora) sobre
 * entradas geradas por mutação de um cadastro válido, e `publicProfessionalProfile`/`approvedRegistrationProjection` REAIS na aprovação.
 * O relógio do front é congelado em 2026-10-30 (a regra de nascimento usa a data de hoje).
 */

const { sorteador, tentar } = require('./front');

const HOJE = '2026-10-30';
const RELOGIO = Date.parse('2026-10-30T15:00:00.000Z');
const FOTO = 'data:image/png;base64,iVBORw0KGgo=';

const valido = () => ({
  professionalName: 'Luna Real', fullName: 'Luna Souza', birthDate: '1990-05-10', cpf: '529.982.247-25', phone: '(11) 91234-5678', phone2: '', email: 'luna@exemplo.com',
  address: { street: 'Rua A', number: '10', complement: '', district: 'Centro', city: 'São Paulo', state: 'sp', postalCode: '01001-000', raw: '' },
  avatar: '', portrait: '', gallery: [], biography: 'Leio tarot há dez anos.', definitions: ['Tarot'], oracles: ['Lenormand'], techniques: [], spreads: ['Cruz Celta'], channels: ['Chat', 'Voz'], equipment: [], themes: ['Amor'],
  weeklySchedule: { segunda: '18h às 23h', terca: 'Folga' },
  bank: { name: 'Itaú', agency: '1234', agencyDigit: '', account: '5678', accountDigit: '9', accountType: 'corrente', pixType: 'email', pix: 'luna@exemplo.com', holderName: 'Luna Souza', holderDocument: '52998224725' },
  preferredPaymentMethod: 'pix', paymentMethods: ['pix'], commissionRate: 30,
});

const MUTACOES = [
  ['professionalName', ['', '   ', 'x'.repeat(201), 'Ana\u0001', 'Ana\nSilva', 5, null]], ['fullName', ['', 'x'.repeat(201)]], ['birthDate', ['', '2000-02-30', '1899-12-31', '2026-10-31', '2026-10-30', 'ontem', '1990-5-10', '2999-01-01']],
  ['cpf', ['', '111.111.111-11', '529.982.247-24', 'abc', '52998224725', '529 982 247 25']], ['phone', ['', '123', '(11) 91234-5678', '+55 11 91234-5678', 'x'.repeat(5), '1'.repeat(16)]], ['phone2', ['', '12', '11912345678']],
  ['email', ['', 'a@b', 'a b@c.com', 'ok@ok.com']], ['biography', ['', 'x'.repeat(10001), 'x'.repeat(10000)]], ['avatar', [FOTO, 'https://x.com/a.png', 'http://x.com/a.png', '/avatars/tarologos/a.png', 'foto.png', 'data:image/gif;base64,AAAA', 'https://user:pw@x.com/a.png']],
  ['portrait', [FOTO, 'x'.repeat(10)]], ['gallery', [[FOTO], [FOTO, FOTO, FOTO, FOTO, FOTO], 'x', [123]]],
  ['definitions', [[], ['a', 'a', ' '], 'x', Array(121).fill('x')]], ['channels', [['Chat'], ['Voz'], ['Telefone'], []]], ['oracles', [['x'.repeat(161)], null]],
  ['capabilityGroups', [{ tarot: ['x'] }, { inexistente: ['x'] }, 'x', { tarot: 'x' }]], ['capabilityNone', [['tarot'], ['practices'], ['tarot', 'x'], 'x']],
  ['weeklySchedule', [{ segunda: '18h às 23h' }, { segunda: 'Folga' }, { segunda: 'sem horário informado' }, { segunda: '' }, { segunda: '9h às 12h e 14h às 18h' }, { segunda: '9h às 12h · 11h às 18h' }, { segunda: '25h às 26h' }, { segunda: 'qualquer' }, { domingo: '22h às 6h' }, { segunda: '10h às 10h' }, { quarta: '9 a 12' }, { segunda: 'x'.repeat(241) }, { feriado: '9h às 10h' }, 'x', { segunda: 5 }, { segunda: '8h às 9h · 10h às 11h · 12h às 13h · 14h às 15h' }]],
  ['address', [{ state: 'SP' }, { state: 'S' }, { state: 'sp', postalCode: '01001000' }, { postalCode: '123' }, 'x', { raw: 'x'.repeat(1501) }, { street: 'x'.repeat(241) }]],
  ['bank', [{}, { pix: 'x'.repeat(301) }, { name: 'Itaú', agency: '1', account: '2' }, { pix: '' }, 'x']],
  ['preferredPaymentMethod', ['', 'pix', 'bank', 'cartao']], ['paymentMethods', [[], ['pix'], ['bank'], ['pix', 'bank'], ['pix', 'x'], ['pix', 'bank', 'pix'], 'pix']],
  ['commissionRate', [0, 100, 30.5, 30.555, -1, 101, '30', NaN, null, 12.34]], ['paymentSchedule', [null, { kind: 'weekday', weekday: 'sexta' }, { kind: 'weekday', weekday: 'x' }, { kind: 'monthdays', days: [5, 20] }, { kind: 'monthdays', days: [] }, { kind: 'monthdays', days: [5, 5] }, { kind: 'monthdays', days: [32] }, { kind: 'monthdays', days: [5], weekendPolicy: 'x' }, { kind: 'monthdays', days: [20, 5], weekendPolicy: 'next-business-day' }, 'x']],
  ['role', ['admin']], ['status', ['approved']], ['tarotId', ['x']], ['password', ['x']],
];

async function gerar(ctx) {
  const mod = await ctx.carregar('/features/professionals/registration-model.ts');
  const { sorteio, alea, inteiro } = sorteador(20261202);
  const RealDate = Date;
  class DataFixa extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RELOGIO); } static now() { return RELOGIO; } }
  globalThis.Date = DataFixa;
  const cenarios = [];
  try {
    const adicionar = (entrada, publica) => {
      const r = tentar(() => mod.validateRegistrationData(entrada, { publicSubmission: publica }));
      cenarios.push({ entrada, publica, esperado: r.ok !== undefined ? { ok: r.ok } : { erro: r.erro } });
    };
    for (const publica of [true, false]) {
      adicionar(valido(), publica);
      for (const [campo, vals] of MUTACOES) for (const v of vals) { const e = valido(); e[campo] = v; adicionar(e, publica); }
      for (let i = 0; i < 900; i += 1) {
        const e = valido(); const n = inteiro(1, 4);
        for (let k = 0; k < n; k += 1) { const [campo, vals] = sorteio(MUTACOES); e[campo] = sorteio(vals); }
        if (alea() < 0.15) delete e[sorteio(['fullName', 'cpf', 'email', 'phone', 'birthDate', 'bank', 'paymentMethods'])];
        adicionar(e, publica);
      }
    }
    adicionar('texto', true); adicionar(null, false); adicionar([], true); adicionar({}, true); adicionar({ professionalName: 'X' }, false);
    // Aprovação: o perfil público e a projeção que o diretório recebe.
    const aprovacoes = [];
    for (const c of cenarios.filter((x) => x.esperado.ok && !x.publica).slice(0, 40)) {
      aprovacoes.push({ data: c.esperado.ok, publico: mod.publicProfessionalProfile(c.esperado.ok, 'luna-real') });
    }
    const proj = await ctx.carregar('/features/professionals/registration-projection.ts');
    for (const a of aprovacoes) a.projecao = proj.approvedRegistrationProjection({ id: 'reg-1', data: a.data, status: 'approved', revision: 3, tarotId: 'luna-real', createdAt: 'x', updatedAt: 'x' });
    return { hoje: HOJE, cenarios, aprovacoes };
  } finally { globalThis.Date = RealDate; }
}

module.exports = { gerar };
