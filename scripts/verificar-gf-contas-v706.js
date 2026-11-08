'use strict';

/**
 * Verificação das regras de Contas da v706 (sem banco): compara `_comum/dominio/contas.js`, `contas-convite.js` e `contas-permissoes.js`
 * com o OURO do código real do front (scripts/apoio-gf-contas-v706/ouro.json, gerado por gerar-ouro-gf-contas-v706.js) e refuta mutantes.
 * Também confere o que o ouro não cobre (tipo do convite, conferências de geração, token que não é guardado, textos).
 *   node scripts/verificar-gf-contas-v706.js
 */

const assert = require('assert');
const dom = require('../src/gestao-fadas/_comum/dominio/contas');
const conv = require('../src/gestao-fadas/_comum/dominio/contas-convite');
const per = require('../src/gestao-fadas/_comum/dominio/contas-permissoes');
const ouro = require('./apoio-gf-contas-v706/ouro.json');

const tentar = (fn) => { try { return { ok: JSON.parse(JSON.stringify(fn() === undefined ? null : fn())) }; } catch (e) { return { erro: e.message }; } };
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Roda todo o ouro contra uma implementação; devolve as divergências. */
function conferir(impl) {
  const f = [];
  const nao = (msg) => f.push(msg);
  for (const x of ouro.emails) if (impl.conv.isAccountEmail(x.e) !== x.esperado) nao(`e-mail ${JSON.stringify(x.e)}`);
  for (const x of ouro.senhas) if (impl.dom.senhaForte(x.s) !== x.esperado) nao(`senha ${JSON.stringify(x.s)}`);
  for (const x of ouro.criacoes) {
    const r = tentar(() => impl.conv.criarConvite(x.conta, x.kind, x.token || '0'.repeat(64), x.agora === null ? Number.NaN : x.agora));
    if (x.esperado.erro !== undefined) { if (r.erro !== x.esperado.erro) nao(`criação recusada ${x.conta.email}: ${r.erro}`); } else if (!igual(r.ok, x.esperado.ok)) nao(`criação ${x.conta.email}/${x.kind}`);
  }
  for (const x of ouro.resolucoes) {
    const r = impl.conv.resolverConvite(x.contas, x.token, x.agora === null ? Number.NaN : x.agora);
    if (r.status !== x.status || (r.account ? r.account.id : null) !== x.contaId) nao(`resolução "${x.nome}": ${r.status} x ${x.status}`);
  }
  for (const x of ouro.resgates) {
    const r = impl.conv.resgatarConvite(x.conta, x.token, x.agora);
    const e = x.esperado;
    if (r.status !== e.status) { nao(`resgate "${x.nome}": ${r.status} x ${e.status}`); continue; }
    if (e.status === 'accepted') {
      const { demoCredential, ...esperadaConta } = e.account; // a credencial do demo é substituída pelo hash do servidor
      if (!igual(r.account, esperadaConta)) nao(`resgate "${x.nome}": conta diferente`);
    }
  }
  for (const x of ouro.revogacoes) if (!igual(impl.conv.revogarConvite(x.conta, x.agora), x.esperado)) nao(`revogação "${x.nome}"`);
  for (const x of ouro.entradas) if (impl.conv.podeEntrar(x.conta, x.cadastroAtivo) !== x.esperado) nao(`entrada ${x.conta && x.conta.role}/${x.conta && x.conta.access}`);
  for (const x of ouro.minutagem) {
    if (x.pode !== undefined) { if (impl.per.podeReceberMinutagem(x.pode) !== x.esperado) nao(`pode receber ${x.pode}`); continue; }
    const r = tentar(() => impl.per.definirMinutagem(x.conta, x.enabled, x.ator === null ? undefined : x.ator, x.at, x.id));
    const e = x.esperado;
    if (e.erro !== undefined ? r.erro !== e.erro : !igual(r.ok, e.ok)) nao(`minutagem ${x.conta.role}/${JSON.stringify(x.enabled)}/ator ${x.ia}`);
  }
  for (const x of ouro.verMinutagem) {
    const v = x.semArgumento ? impl.per.veMinutagemTotal(x.role) : impl.per.veMinutagemTotal(x.role, x.individual === null ? undefined : x.individual);
    if (v !== x.esperado) nao(`vê minutagem ${x.role}/${JSON.stringify(x.individual)}`);
  }
  for (const x of ouro.validas) if (impl.per.permissoesValidas(x.x) !== x.esperado) nao(`permissões válidas ${JSON.stringify(x.x)}`);
  for (const x of ouro.escritas) {
    const r = tentar(() => { impl.per.exigirAdminParaPermissao(x.antes === null ? undefined : x.antes, x.depois === null ? undefined : x.depois, x.papel === null ? undefined : x.papel); return true; });
    if (!igual(r, x.esperado)) nao(`escrita de permissão ${x.papel}`);
  }
  return f;
}

let ok = 0; const falhas = [];
const passo = (nome, fn) => { try { fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 300)}`); } };
const real = { dom, conv, per };
const com = (parte, mudancas) => ({ ...real, [parte]: { ...real[parte], ...mudancas } });

console.log('Contas v706: ouro do código do front');
passo(`o servidor reproduz o front em ${Object.values(ouro).filter(Array.isArray).reduce((a, v) => a + v.length, 0)} cenários`, () => { const f = conferir(real); assert.equal(f.length, 0, f.slice(0, 5).join(' | ')); });

console.log('Mutantes: regra errada tem de ser recusada pelo ouro');
const mutante = (nome, impl) => passo(`mutante recusado: ${nome}`, () => assert.ok(conferir(impl).length > 0, 'o ouro aceitou o mutante'));
mutante('senha com 12 caracteres (regra antiga)', com('dom', { senhaForte: (s) => typeof s === 'string' && s.length >= 12 && /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s) && /[^A-Za-z0-9]/.test(s) }));
mutante('e-mail só do domínio do Fadas (regra antiga)', com('conv', { isAccountEmail: (e) => typeof e === 'string' && /^[^\s@]+@fadasdobem\.com\.br$/.test(e.trim().toLowerCase()) }));
mutante('e-mail aceita qualquer coisa com arroba', com('conv', { isAccountEmail: (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+$/.test(e.trim()) }));
mutante('e-mail com caractere de controle aceito', com('conv', { isAccountEmail: (e) => typeof e === 'string' && conv.isAccountEmail(e.replace(/[\u0000-\u001f\u007f]/g, '')) }));
mutante('e-mail sem limite de 254', com('conv', { isAccountEmail: (e) => typeof e === 'string' && !/[\u0000-\u001f\u007f]/.test(e) && /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i.test(e.trim()) }));
mutante('e-mail sem aparar as pontas', com('conv', { isAccountEmail: (e) => typeof e === 'string' && !/[\u0000-\u001f\u007f]/.test(e) && e.length <= 254 && /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i.test(e) }));
mutante('convite vale 72 horas', com('conv', { criarConvite: (c, k, t, a) => { const x = conv.criarConvite(c, k, t, a); return { ...x, expiresAt: new Date(a + 72 * 3600 * 1000).toISOString() }; } }));
mutante('convite revogado ainda vale', com('conv', { resolverConvite: (cs, t, a) => conv.resolverConvite(cs.map((c) => (c.demoInvitation ? { ...c, demoInvitation: { ...c.demoInvitation, revokedAt: undefined } } : c)), t, a) }));
mutante('convite usado vale de novo', com('conv', { resolverConvite: (cs, t, a) => conv.resolverConvite(cs.map((c) => (c.demoInvitation ? { ...c, demoInvitation: { ...c.demoInvitation, usedAt: undefined } } : c)), t, a) }));
mutante('convite não vence', com('conv', { resolverConvite: (cs, t) => conv.resolverConvite(cs, t, Date.parse('2026-11-10T15:00:00.000Z')) }));
mutante('conta inativa aceita o convite', com('conv', { resolverConvite: (cs, t, a) => conv.resolverConvite(cs.map((c) => ({ ...c, active: true })), t, a) }));
mutante('resgate não libera o acesso pendente', com('conv', { resgatarConvite: (c, t, a) => { const r = conv.resgatarConvite(c, t, a); return r.status === 'accepted' ? { ...r, account: { ...r.account, access: c.access } } : r; } }));
mutante('revogar não marca a data', com('conv', { revogarConvite: (c) => c }));
mutante('acesso pendente pode entrar', com('conv', { podeEntrar: (c, ok2) => Boolean(c && c.active && conv.isAccountEmail(c.email) && ok2 && !(c.demoInvitation && c.demoInvitation.kind === 'first-access' && !c.demoInvitation.usedAt)) }));
mutante('primeiro convite sem uso pode entrar', com('conv', { podeEntrar: (c, ok2) => Boolean(c && c.active && conv.isAccountEmail(c.email) && c.access !== 'Acesso pendente' && ok2) }));
mutante('e-mail inválido pode entrar', com('conv', { podeEntrar: (c, ok2) => Boolean(c && c.active && c.access !== 'Acesso pendente' && ok2 && !(c.demoInvitation && c.demoInvitation.kind === 'first-access' && !c.demoInvitation.usedAt)) }));
mutante('supervisora vê a minutagem sempre (regra antiga)', com('per', { veMinutagemTotal: (r, i = {}) => r === 'administradora' || r === 'assistente' || r === 'supervisora' || ((r === 'atendente') && i.viewDailyMinutes === true) }));
mutante('atendente vê com a permissão desligada', com('per', { veMinutagemTotal: (r, i = {}) => per.veMinutagemTotal(r, { viewDailyMinutes: r === 'atendente' ? true : i.viewDailyMinutes }) }));
mutante('assistente depende da permissão', com('per', { veMinutagemTotal: (r, i = {}) => r === 'administradora' || ((r === 'supervisora' || r === 'atendente' || r === 'assistente') && i.viewDailyMinutes === true) }));
mutante('administradora inativa altera a permissão', com('per', { definirMinutagem: (c, e, a, at, id) => per.definirMinutagem(c, e, a && { ...a, active: true }, at, id) }));
mutante('outra função altera a permissão', com('per', { definirMinutagem: (c, e, a, at, id) => per.definirMinutagem(c, e, a && { ...a, role: 'administradora' }, at, id) }));
mutante('permissão de tarólogo é aceita', com('per', { podeReceberMinutagem: (r) => r !== 'administradora' }));
mutante('a alteração não grava a trilha', com('per', { definirMinutagem: (c, e, a, at, id) => { const r = per.definirMinutagem(c, e, a, at, id); if (r !== c) delete r.permissionAudit; return r; } }));
mutante('quem não é administradora grava permissão', com('per', { exigirAdminParaPermissao: () => {} }));
mutante('trilha duplicada é aceita', com('per', { permissoesValidas: (c) => per.permissoesValidas({ ...c, permissionAudit: Array.isArray(c.permissionAudit) ? [...new Map(c.permissionAudit.map((l) => [l && l.id, l])).values()] : c.permissionAudit }) }));

console.log('Regras sem função no front (transcritas de saveAccount, shell/home-experience.tsx)');
passo('tipo do convite: conta nova, acesso pendente ou primeiro convite sem uso = primeiro acesso; senão nova senha', () => {
  assert.equal(conv.tipoDoConvite({ existente: undefined, completando: false }), 'first-access');
  assert.equal(conv.tipoDoConvite({ existente: { demoInvitation: undefined }, completando: true }), 'first-access');
  assert.equal(conv.tipoDoConvite({ existente: { demoInvitation: { kind: 'first-access' } }, completando: false }), 'first-access');
  assert.equal(conv.tipoDoConvite({ existente: { demoInvitation: { kind: 'first-access', usedAt: 'x' } }, completando: false }), 'reset-password');
  assert.equal(conv.tipoDoConvite({ existente: { demoInvitation: { kind: 'reset-password' } }, completando: false }), 'reset-password');
  assert.equal(conv.tipoDoConvite({ existente: { active: true }, completando: false }), 'reset-password');
});
passo('conferências ao gerar convite, na ordem do front, com os textos do front', () => {
  assert.equal(conv.conferirGeracao({ email: 'sem', cadastroAtivo: true, existente: undefined, completando: false }), 'Informe um e-mail válido para gerar o convite.');
  assert.equal(conv.conferirGeracao({ email: 'a@b.co', cadastroAtivo: false, existente: undefined, completando: false }), 'Ative o cadastro da profissional antes de gerar o convite.');
  assert.equal(conv.conferirGeracao({ email: 'a@b.co', cadastroAtivo: true, existente: { active: false }, completando: false }), 'Reative o acesso antes de gerar o convite.');
  assert.equal(conv.conferirGeracao({ email: 'a@b.co', cadastroAtivo: true, existente: { active: false }, completando: true }), null);
  assert.equal(conv.conferirGeracao({ email: 'a@b.co', cadastroAtivo: undefined, existente: undefined, completando: false }), null);
});
passo('só a impressão do token é guardada: 64 hexadecimais e diferente do token', () => {
  const t = 'a'.repeat(64); const c = conv.criarConvite({ id: 'u', email: 'a@fadasdobem.com.br', role: 'atendente' }, 'first-access', t, 1);
  assert.match(c.tokenHash, /^[0-9a-f]{64}$/); assert.notEqual(c.tokenHash, t); assert.ok(!JSON.stringify(c).includes(t));
});
passo('textos: senha fraca fala em 15 caracteres; qualquer e-mail válido serve (v711) e o inválido tem o texto do front', () => {
  assert.equal(dom.MSG.senhaFraca, 'Use 15 caracteres, maiúscula, minúscula, número e símbolo. Confirme a mesma senha.');
  assert.equal(dom.validarEmail('ana@exemplo.com'), null);
  assert.equal(dom.validarEmail('a..b@exemplo.com'), 'Informe um e-mail válido.');
  assert.equal(dom.validarEmail('ana@fadasdobem.com.br'), null);
  assert.equal(dom.validarEmail('a b@fadasdobem.com.br'), 'Confira o usuário ou e-mail informado.');
});
passo('DTO: acesso pendente, permissão, trilha e convite só aparecem quando existem', () => {
  const l = { id: 'u', nome: 'A', email: 'a@fadasdobem.com.br', perfil: 'atendente', ativo: true, ultimo_login: null };
  assert.deepEqual(Object.keys(dom.paraConta(l)).sort(), ['access', 'active', 'commission', 'email', 'id', 'name', 'role']);
  const p = dom.paraConta({ ...l, acesso_pendente: true, ver_minutagem: true, permissoes_trilha: [{ id: 'e' }], convite_hash: 'h'.repeat(64), convite_tipo: 'first-access', convite_email: l.email, convite_papel: 'atendente', convite_emitido: '2026-11-10T15:00:00Z', convite_expira: '2026-11-12T15:00:00Z', convite_revogado: '2026-11-11T15:00:00Z' });
  assert.equal(p.access, 'Acesso pendente'); assert.deepEqual(p.permissions, { viewDailyMinutes: true }); assert.equal(p.permissionAudit.length, 1);
  assert.deepEqual(p.demoInvitation, { accountId: 'u', tokenHash: 'h'.repeat(64), email: l.email, role: 'atendente', kind: 'first-access', issuedAt: '2026-11-10T15:00:00.000Z', expiresAt: '2026-11-12T15:00:00.000Z', revokedAt: '2026-11-11T15:00:00.000Z' });
});

console.log(`\n${ok} ok, ${falhas.length} falhas`);
process.exit(falhas.length ? 1 : 0);
