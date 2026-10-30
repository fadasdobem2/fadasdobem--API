'use strict';

/**
 * Gera os CASOS DE OURO da fatia Estado financeiro (Maturacao/43) a partir do CÓDIGO REAL do front:
 *   - `features/finance/financial-reasons-model.ts` (`createFinancialReasonStore`, `addFinancialReason`, `reviseFinancialReason`, `validFinancialReasonStore`,
 *     `normalizeFinancialReasonStore`);
 *   - `features/finance/payout-recurring-adjustments.ts` (categorias, regras, `materializePayoutAdditions`, `resolvePayoutAdditionQuantity`, `validPayoutAdditionStore`);
 *   - `features/painel/panel-pending-items.tsx` (`payoutAdditionPendingItems`);
 *   - `features/admin/operation-audit-model.ts` (`validOperationalAudit`).
 * Cada cenário é uma SEQUÊNCIA de comandos sobre o mesmo armazém, com o resultado do front (armazém novo ou a frase do erro) em cada passo.
 * Grava scripts/apoio-gf-estado-financeiro/ouro-estado-front.json.
 *   node scripts/gerar-ouro-gf-estado-financeiro.js --front=<pasta do front>
 * Usa o vite do próprio front (ssrLoadModule) com o calendário real, sem tocar nele. Todo valor é fictício.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));

let semente = 20261125;
const aleatorio = () => { semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0; return semente / 4294967296; };
const sorteio = (l) => l[Math.floor(aleatorio() * l.length)];
const inteiro = (a, b) => a + Math.floor(aleatorio() * (b - a + 1));
let ruido = 1;
const mau = (p, bom, ruins) => (aleatorio() < p * ruido ? sorteio(ruins) : bom);
const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
const limpo = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));

const PAPEIS = ['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'];
const NOMES_BONS = ['Cortesia da casa', 'Estorno por engano', 'Ajuste de mês', 'x'.repeat(60), 'Bônus de natal', 'Cartão recusado', 'Acordo com a cliente', '  Dois   espaços  ', 'Retorno parcial', 'Desconto combinado'];
const NOMES_RUINS = ['Pagamento', 'pagamento', 'Estórno por engano', 'Outros', 'outros', 'OUTROS ', 'x'.repeat(61), '', '   ', 'Empréstimo', 'ADIANTAMENTO'];
const NOMES = [...NOMES_BONS, ...NOMES_BONS, ...NOMES_BONS, ...NOMES_RUINS];
const TEXTOS = [undefined, undefined, 'Pagamento de {data}', 'Texto simples', 'Texto simples', 'a'.repeat(180), 'Dois {data} e {data}', 'Com {x} errado', 'Com { chave', 'a'.repeat(181), '', '   ', 'Fecha}'];
const DESCRICOES = [undefined, '', 'Explicação curta.', 'Explicação curta.', 'd'.repeat(300), '  com espaços  ', 'd'.repeat(301)];
const NATUREZAS = ['payment', 'refund', 'client-refund', 'dispute-pix', 'charge', 'payout', 'advance', 'loan', 'payout-bonus', 'payout-addition', 'payout-credit', 'payout-debit', 'refund', 'charge', 'payout-bonus', 'inexistente'];
const AGORA = ['2026-10-30T15:00:00.000Z', '2026-10-31T09:30:00.000Z', 'ontem', ''];

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-estado-fin', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const R = await vite.ssrLoadModule('/features/finance/financial-reasons-model.ts');
    const P = await vite.ssrLoadModule('/features/finance/payout-recurring-adjustments.ts');
    const items = await vite.ssrLoadModule('/features/painel/panel-pending-items.tsx');
    const A = await vite.ssrLoadModule('/features/admin/operation-audit-model.ts');

    // ---- 1. Motivos financeiros: sequências sobre a loja ----
    const sementes = limpo(R.createFinancialReasonStore());
    const motivos = [];
    for (let i = 0; i < 200; i += 1) {
      let loja = R.createFinancialReasonStore(); const passos = [];
      for (let k = 0; k < inteiro(2, 7); k += 1) {
        const papel = aleatorio() < 0.9 ? sorteio(['administradora', 'assistente', 'supervisora']) : sorteio(PAPEIS); const ator = aleatorio() < 0.95 ? 'Laya' : '  '; const at = aleatorio() < 0.95 ? AGORA[0] : sorteio(AGORA);
        const existentes = R.currentFinancialReasons(loja);
        if (aleatorio() < 0.5 || !existentes.length) {
          const nat = sorteio(NATUREZAS); const escopo = R.financialReasonNatures[nat] ? (aleatorio() < 0.9 ? R.financialReasonNatures[nat].scope : sorteio(['client', 'tarologist'])) : sorteio(['client', 'tarologist']);
          const id = aleatorio() < 0.93 ? `m-${i}-${k}` : sorteio(['other', '', existentes.length ? existentes[0].id : 'x']);
          const entrada = { id, scope: escopo, nature: nat, name: sorteio(NOMES), description: sorteio(DESCRICOES), statementText: sorteio(TEXTOS) };
          const r = tentar(() => R.addFinancialReason(loja, entrada, ator, at, papel));
          passos.push({ op: 'add', entrada: limpo(entrada), papel, ator, at, resultado: r.ok ? { novos: limpo(r.ok.store.reasons.slice(loja.reasons.length)), motivo: limpo(r.ok.reason) } : { erro: r.erro } });
          if (r.ok) loja = r.ok.store;
        } else {
          const alvo = sorteio(existentes); const entrada = {};
          if (aleatorio() < 0.5) entrada.name = sorteio(NOMES); if (aleatorio() < 0.4) entrada.description = sorteio(DESCRICOES.filter((x) => x !== undefined)); if (aleatorio() < 0.6) entrada.active = aleatorio() < 0.5; if (aleatorio() < 0.3) entrada.statementText = sorteio(TEXTOS);
          const versao = aleatorio() < 0.92 ? alvo.version : alvo.version + 1;
          const r = tentar(() => R.reviseFinancialReason(loja, alvo.id, versao, entrada, ator, at, papel));
          passos.push({ op: 'revise', id: alvo.id, versao, entrada: limpo(entrada), papel, ator, at, resultado: r.ok ? { novos: limpo(r.ok.reasons.slice(loja.reasons.length)) } : { erro: r.erro } });
          if (r.ok) loja = r.ok;
        }
      }
      const norm = limpo(R.normalizeFinancialReasonStore(loja));
      motivos.push({ passos, final: limpo(loja), valida: R.validFinancialReasonStore(loja), normalizada: JSON.stringify(norm) === JSON.stringify(limpo(loja)) ? 'igual' : norm });
    }
    // Lojas adulteradas: a validação de forma tem de concordar.
    const adulteradas = [];
    for (let i = 0; i < 80; i += 1) {
      const loja = limpo(motivos[i % motivos.length].final); const r = loja.reasons;
      const mut = sorteio(['nada', 'versao', 'nome', 'natureza', 'escopo', 'texto', 'ativo', 'duplicado', 'outros', 'id', 'data', 'autor', 'descricao']);
      const alvo = r[inteiro(0, r.length - 1)];
      if (mut === 'versao') alvo.version += 2; if (mut === 'nome') alvo.name = sorteio(['', 'x'.repeat(61), 'Outros']); if (mut === 'natureza') alvo.nature = 'xx'; if (mut === 'escopo') alvo.scope = alvo.scope === 'client' ? 'tarologist' : 'client';
      if (mut === 'texto') alvo.statementText = 'Com {x}'; if (mut === 'ativo') alvo.active = 'sim'; if (mut === 'duplicado') r.push({ ...alvo }); if (mut === 'outros') alvo.id = 'other'; if (mut === 'id') alvo.id = '';
      if (mut === 'data') alvo.createdAt = 'ontem'; if (mut === 'autor') alvo.createdBy = ' '; if (mut === 'descricao') alvo.description = 'd'.repeat(301);
      const norm = limpo(R.normalizeFinancialReasonStore(loja));
      adulteradas.push({ mut, loja, valida: R.validFinancialReasonStore(loja), normalizada: JSON.stringify(norm) === JSON.stringify(loja) ? 'igual' : (mut === 'nada' ? 'igual' : norm) });
    }

    // ---- 2. Adicionais: sequências sobre o armazém ----
    const HOJE = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-15'];
    const adicionais = [];
    const novaRegra = (loja, hoje, i, k) => {
      const categoria = sorteio(loja.categories);
      const valor = aleatorio() < 0.5 ? { kind: 'fixed', amount: mau(0.12, sorteio([10, 12.5, 100, 1234.56]), [0, -3, 7.333]) } : { kind: 'unit', unitValue: mau(0.1, sorteio([2, 3.5, 12.34, 1000]), [0]), unitLabel: mau(0.1, sorteio(['carta', 'hora']), ['', 'x'.repeat(41)]) };
      const inicio = mau(0.15, sorteio([hoje, hoje, '2026-11-01', '2026-12-31', '2027-01-31']), ['2026-10-01', '2026-02-30']);
      return { id: `r-${i}-${k}`, tarotId: mau(0.08, sorteio(['9001', '9002']), ['']), categoryId: categoria.id, categoryName: mau(0.06, categoria.name, ['Outro nome']), value: valor, frequency: mau(0.06, sorteio(['weekly', 'monthly']), ['daily']), startDate: inicio,
        description: mau(0.12, sorteio(['', 'Observação']), [' ', 'o'.repeat(701)]), history: [{ action: 'created', date: mau(0.06, hoje, ['2026-01-01']), at: AGORA[0], by: mau(0.05, 'Laya', [' ']) }],
        ...(aleatorio() < 0.3 ? { financialReason: { id: 'financial-reason-payout-addition', version: 1, scope: 'tarologist', nature: 'payout-addition', name: 'Adicional' } } : {}) };
    };
    const ROTEIRO = ['regra', 'mat', 'regra', 'mat', 'res', 'mud', 'mat', 'res', 'mud', 'mat', 'res'];
    for (let i = 0; i < 240; i += 1) {
      const dirigido = i >= 160; ruido = dirigido ? 0.05 : 1;
      let loja = P.emptyPayoutAdditionStore(); let ajustes = []; const passos = [];
      for (let k = 0, total = dirigido ? ROTEIRO.length : inteiro(3, 9); k < total; k += 1) {
        const hoje = dirigido ? HOJE[Math.min(Math.floor(k / 3), 3)] : i % 3 === 0 ? sorteio(HOJE) : HOJE[Math.min(k, 3)]; const at = AGORA[0]; const por = sorteio(['Laya', 'Assist']); const tipo = dirigido ? ROTEIRO[k % ROTEIRO.length] : sorteio(['cat', 'rev', 'regra', 'regra', 'regra', 'mud', 'mat', 'mat', 'res', 'res']);
        let entrada; let r;
        if (tipo === 'cat') { entrada = { id: sorteio([`c-${i}-${k}`, 'monitoria', '']), name: aleatorio() < 0.55 ? `Categoria ${i}-${k}` : sorteio(['Nova categoria', 'monitoria', ' Monitória ', '', 'n'.repeat(61), 'Tarot básico']) }; r = tentar(() => ({ loja: P.addPayoutAdditionCategory(loja, entrada), ajustes })); }
        else if (tipo === 'rev') { const c = sorteio(loja.categories); entrada = { id: aleatorio() < 0.95 ? c.id : 'sumiu', name: aleatorio() < 0.7 ? sorteio([`Renomeada ${i}-${k}`, `Renomeada ${i}-${k}`, 'Renomeada', c.name, 'Monitoria', '', ' Carta do dia ']) : undefined, active: aleatorio() < 0.6 ? aleatorio() < 0.5 : undefined, ator: sorteio(['Laya', ' ']) }; r = tentar(() => ({ loja: { ...loja, categories: P.revisePayoutAdditionCategory(loja.categories, entrada.id, { name: entrada.name, active: entrada.active }, entrada.ator, at) }, ajustes })); }
        else if (tipo === 'regra') { entrada = { hoje, regra: novaRegra(loja, hoje, i, k) }; r = tentar(() => ({ loja: P.addPayoutAdditionRule(loja, entrada.regra, hoje), ajustes })); }
        else if (tipo === 'mud') { const regra = loja.rules.length ? sorteio(loja.rules) : null; entrada = { id: regra ? regra.id : 'nenhuma', acao: sorteio(['paused', 'resumed', 'ended']), data: sorteio([hoje, '2026-02-30', '2026-01-01', hoje]), por: sorteio(['Laya', ' ']) }; r = tentar(() => ({ loja: P.changePayoutAdditionRule(loja, entrada.id, entrada.acao, entrada.data, at, entrada.por), ajustes })); }
        else if (tipo === 'mat') { entrada = { ate: mau(0.05, sorteio([hoje, '2026-12-31', '2026-11-20']), ['x']), por }; r = tentar(() => P.materializePayoutAdditions(loja, ajustes, entrada.ate, at, por)); }
        else { const pend = loja.occurrences.filter((o) => o.status === 'pending'); const o = pend.length && aleatorio() < 0.85 ? sorteio(pend) : sorteio([...loja.occurrences, { id: 'sumiu' }]); entrada = { id: o ? o.id : 'sumiu', quantidade: sorteio([0, 1, 2.5, 3, 7, 1, 2, 0.125, -1, 100001]), hoje, por }; r = tentar(() => P.resolvePayoutAdditionQuantity(loja, ajustes, entrada.id, entrada.quantidade, hoje, at, por)); }
        passos.push({ tipo, entrada: limpo(entrada), at, resultado: r.ok ? { loja: limpo(r.ok.loja ?? r.ok.store), ajustes: limpo(r.ok.ajustes ?? r.ok.adjustments) } : { erro: r.erro } });
        if (r.ok) { loja = r.ok.loja ?? r.ok.store; ajustes = r.ok.ajustes ?? r.ok.adjustments; }
      }
      const nomes = { 9001: 'Osíris', 9002: 'Ísis' };
      const perfis = [{ id: '9001', name: 'Osíris' }, { id: '9002', name: 'Ísis' }];
      const vazio = { cancellations: [], finishes: [], divergences: [], matches: [], uncovered: [], unpaid: [], agendaPayments: {} };
      // `panelPendingItems` (o que a tela chama) carimba a data da tela em `referenceDate`; é ele que o ouro roda.
      const pendencias = HOJE.map((ate) => ({ ate, itens: items.panelPendingItems(vazio, () => {}, () => {}, ate, { store: loja, profiles: perfis, through: ate }).map((s) => ({ id: s.id, occurrence: s.occurrence, referenceDate: s.referenceDate, financial: s.financial, tone: s.tone, title: s.title, who: s.who, detail: s.detail })) }));
      adicionais.push({ passos, final: limpo(loja), ajustes: limpo(ajustes), valida: P.validPayoutAdditionStore(loja), nomes, pendencias });
    }
    const adicionaisRuins = [];
    for (let i = 0; i < 100; i += 1) {
      const base = limpo(adicionais[i % adicionais.length].final); const mut = sorteio(['nada', 'cat-vazia', 'cat-dup', 'regra-sem-cat', 'regra-hist', 'oc-id', 'oc-status', 'oc-qtd', 'regra-data', 'valor']);
      if (mut === 'cat-vazia') base.categories[0].name = ' '; if (mut === 'cat-dup') base.categories.push({ id: 'dup', name: base.categories[0].name }); if (mut === 'regra-sem-cat' && base.rules[0]) base.rules[0].categoryId = 'zzz';
      if (mut === 'regra-hist' && base.rules[0]) base.rules[0].history = []; if (mut === 'oc-id' && base.occurrences[0]) base.occurrences[0].id = 'x'; if (mut === 'oc-status' && base.occurrences[0]) base.occurrences[0].status = 'posted';
      if (mut === 'oc-qtd' && base.occurrences[0]) base.occurrences[0].quantity = -1; if (mut === 'regra-data' && base.rules[0]) base.rules[0].startDate = '2026-13-01'; if (mut === 'valor' && base.rules[0]) base.rules[0].value = { kind: 'fixed', amount: 0 };
      adicionaisRuins.push({ mut, loja: base, valida: P.validPayoutAdditionStore(base) });
    }

    // ---- 3. Trilha operacional: forma ----
    const trilha = [];
    for (let i = 0; i < 200; i += 1) {
      const ev = (n) => ({ id: aleatorio() < 0.95 ? `ev-${i}-${n}` : sorteio(['', 5, undefined]), category: aleatorio() < 0.92 ? sorteio(A.operationalAuditCategories) : 'outra', action: aleatorio() < 0.95 ? 'Lançou pagamento' : 7, recordId: aleatorio() < 0.95 ? `rec-${n}` : null, detail: aleatorio() < 0.95 ? 'Detalhe.' : undefined, origin: aleatorio() < 0.95 ? sorteio(['captured', 'existing']) : 'x', ...(aleatorio() < 0.7 ? { at: aleatorio() < 0.9 ? AGORA[0] : 'ontem' } : {}) });
      const linhas = Array.from({ length: inteiro(1, 4) }, (_, n) => ev(n)); if (aleatorio() < 0.1) linhas.push({ ...linhas[0] });
      trilha.push({ linhas: limpo(linhas), valida: A.validOperationalAudit(limpo(linhas)) });
    }

    const saida = path.join(__dirname, 'apoio-gf-estado-financeiro', 'ouro-estado-front.json');
    fs.writeFileSync(saida, JSON.stringify({ geradoDe: 'financial-reasons-model.ts, payout-recurring-adjustments.ts, panel-pending-items.tsx, operation-audit-model.ts', sementes, motivos, adulteradas, adicionais, adicionaisRuins, trilha }));
    const passosMotivos = motivos.reduce((s, c) => s + c.passos.length, 0); const passosAdic = adicionais.reduce((s, c) => s + c.passos.length, 0);
    console.log(`Ouro gravado: ${motivos.length} sequências de motivos (${passosMotivos} comandos, ${motivos.reduce((s, c) => s + c.passos.filter((p) => p.resultado.erro).length, 0)} recusas), ${adulteradas.length} lojas adulteradas, ${adicionais.length} sequências de adicionais (${passosAdic} comandos, ${adicionais.reduce((s, c) => s + c.passos.filter((p) => p.resultado.erro).length, 0)} recusas), ${adicionaisRuins.length} armazéns adulterados, ${trilha.length} trilhas.`);
  } finally { await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
