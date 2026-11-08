'use strict';

/**
 * OURO da v711 (formas de atendimento, regime Pré/Pós e cadastro profissional) a partir do CÓDIGO REAL do front, em scripts/apoio-gf-v711/ouro.json:
 *   node scripts/gerar-ouro-gf-v711.js --front=<pasta do front com node_modules>
 * Roda: professional-service-modes.mjs (todas as funções), client-registration-state.mjs (assertClientPaymentTransition, preserveClientPaymentProfile),
 * handleProfessionalServices (professional-services-service.ts, com repositório em memória) e validateRegistrationData (registration-model.ts).
 */

const fs = require('fs');
const path = require('path');
const { abrir } = require('./apoio-gf-regras-b/front');
const C = require('./apoio-gf-v711/cenarios');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const j = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const tentar = (fn) => { try { return { ok: j(fn()) }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };

function repoFormas() {
  const linhas = new Map();
  const k = (id, d) => `${id}|${d}`;
  return {
    async read(id, d) { return linhas.has(k(id, d)) ? { ...linhas.get(k(id, d)) } : null; },
    async list(d) { return [...linhas.values()].filter((r) => r.date === d).sort((a, b) => a.tarotId.localeCompare(b.tarotId)).map((r) => ({ ...r })); },
    async save(row, rev) {
      const atual = linhas.get(k(row.tarotId, row.date));
      if (rev === 0 ? atual : !atual || atual.revision !== rev) return null;
      const nova = { ...row, revision: rev + 1 }; linhas.set(k(row.tarotId, row.date), nova); return { ...nova };
    },
  };
}

(async () => {
  if (!arg('front')) { console.error('Informe --front=<pasta do front com node_modules>'); process.exit(2); }
  const ctx = await abrir(arg('front'));
  try {
    const modos = await ctx.carregar('/features/domain/professional-service-modes.mjs');
    const estado = await ctx.carregar('/features/clientes/client-registration-state.mjs');
    const servico = await ctx.carregar('/features/professionals/professional-services-service.ts');
    const cad = await ctx.carregar('/features/professionals/registration-model.ts');
    const ouro = { gerado: 'a partir do código do front v711 (professional-service-modes.mjs, client-registration-state.mjs, professional-services-service.ts, registration-model.ts)' };
    ouro.validar = C.MODOS.map((m) => ({ m: j(m), esperado: tentar(() => modos.validateServiceModes(m)) }));
    ouro.habituais = C.PERFIS.map((p) => ({ p: j(p), esperado: tentar(() => modos.habitualServiceModes(p)) }));
    ouro.efetivas = []; ouro.aceita = []; ouro.aviso = [];
    for (const p of C.PERFIS) for (const d of [C.HOJE, '2026-11-09']) ouro.efetivas.push({ p: j(p), d, esperado: tentar(() => modos.effectiveServiceModes(p, d)) });
    ouro.pedido = C.CANAIS.map((c) => ({ c, esperado: modos.requestedServiceMode(c) }));
    for (const p of C.PERFIS) for (const c of C.CANAIS) { ouro.aceita.push({ p: j(p), c, esperado: tentar(() => modos.acceptsServiceMode(p, c, C.HOJE)) }); ouro.aviso.push({ p: j(p), c, esperado: tentar(() => modos.serviceModeWarning(p, c, C.HOJE)) }); }
    ouro.contatos = C.CONTATOS.map((c) => ({ c: j(c), esperado: tentar(() => modos.validateUmblerContact(c)) }));
    ouro.regime = [];
    for (const de of C.ANTERIORES) for (const para of C.PROXIMOS) ouro.regime.push({ de: de === undefined ? '__u' : de, para: para === undefined ? '__u' : para, esperado: tentar(() => estado.assertClientPaymentTransition(de, para)) });
    ouro.preservar = [];
    for (const perfil of ['Pré-pago', 'Pós-pago', '']) for (const em of [null, '2026-11-08T12:00:00Z', '2026-11-10T12:00:00Z']) ouro.preservar.push({ perfil, em, aprovada: '2026-11-09T12:00:00Z', esperado: estado.preserveClientPaymentProfile(perfil, em, '2026-11-09T12:00:00Z') });
    ouro.formas = [];
    const store = repoFormas();
    for (const [metodo, consulta, corpo, ident, instante] of C.PEDIDOS_FORMAS) {
      const init = { method: metodo, headers: { Origin: 'https://fadas.example.org', 'Content-Type': 'application/json' }, ...(corpo !== undefined && metodo !== 'GET' ? { body: JSON.stringify(corpo) } : {}) };
      const r = await servico.handleProfessionalServices(new Request(`https://fadas.example.org/api/professional-services${consulta}`, init), store, ident, instante || C.AGORA);
      ouro.formas.push({ metodo, consulta, corpo: j(corpo), ident, instante: instante || null, saida: { status: r.status, corpo: await r.json() } });
    }
    ouro.cadastros = [];
    const base = j(cad.emptyRegistrationData()); base.professionalName = 'Ana';
    ouro.base = base;
    for (const [nome, extra] of C.CADASTROS) for (const publica of [false, true]) {
      const semPrivados = Object.fromEntries(Object.entries(base).filter(([k]) => !['commissionRate', 'paymentSchedule', 'weeklyScheduleEffectiveFrom', 'weeklyScheduleBase', 'weeklyScheduleVersions', 'umblerContact'].includes(k)));
      const entrada = { ...(publica ? semPrivados : base), ...extra };
      ouro.cadastros.push({ nome, publica, extra: j(extra), esperado: tentar(() => { const r = cad.validateRegistrationData(j(entrada), { publicSubmission: publica }); return { channels: r.channels, serviceModes: r.serviceModes, umblerContact: r.umblerContact ?? null, publico: cad.publicProfessionalProfile(r, 't1').serviceModes }; }) });
    }
    fs.writeFileSync(path.join(__dirname, 'apoio-gf-v711', 'ouro.json'), `${JSON.stringify(ouro)}\n`);
    console.log(Object.entries(ouro).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k}: ${v.length}`).join(' | '));
  } finally { await ctx.fechar(); }
})().catch((e) => { console.error(e); process.exit(2); });
