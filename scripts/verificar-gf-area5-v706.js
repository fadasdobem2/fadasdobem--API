'use strict';

/**
 * Verificador OFFLINE da área 5 da v706: roda o domínio do servidor sobre o OURO do código real do front (`gerar-ouro-gf-area5-v706.js`) e exige o mesmo
 * resultado, e prova que o ouro "morde": mutantes do esperado (um número +0,01, um booleano trocado, um texto alterado) têm de ser detectados.
 * Cobre: arredondamento de crédito, recibo dividido, reserva de recibo de mais tempo, permissão de saída, recados por departamento e "Sobre cliente",
 * identidade do agendamento (cliente x contato) e datas de recibo do painel. Sem banco, sem relógio.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const D = '../src/gestao-fadas/_comum/dominio/';
const ar = require(`${D}credito-arredondamento`);
const base = require(`${D}financeiro-base`);
const cob = require(`${D}financeiro-cobranca`);
const fd = require(`${D}financeiro-financiamento-dividido`);
const vinc = require(`${D}consulta-vinculos`);
const saldo = require(`${D}financeiro-saldo`);
const saidas = require(`${D}pagamentos-saidas`);
const ocorr = require(`${D}pagamentos-ocorrencias`);
const lanc = require(`${D}painel-lancamento`);
const pagp = require(`${D}painel-pagamentos`);
const dep = require(`${D}recados-departamentos`);
const rec = require(`${D}recados`);
const transf = require(`${D}pagamentos-transferencia`);

Date.now = () => { throw new Error('Date.now() chamado dentro da regra'); };
const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'apoio-gf-area5-v706', 'ouro-area5-v706.json'), 'utf8'));
const json = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const clone = (v) => JSON.parse(JSON.stringify(v));
const tentar = (fn) => { try { return { ok: json(fn()) }; } catch (e) { return { erro: e.message }; } };
let falhas = 0; let conferidos = 0;
const igual = (a, b) => { try { assert.deepStrictEqual(json(a), json(b)); return true; } catch (_e) { return false; } };
/** Primeiro caminho em que os dois valores divergem (para o relatório de falha). */
function onde(a, b, caminho = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return `${caminho}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const r = onde(a[k], b[k], `${caminho}.${k}`); if (r) return r; }
  return null;
}
const comparar = (rotulo, esperado, obtido) => { conferidos += 1; if (!igual(esperado, obtido)) { falhas += 1; if (falhas <= 10) console.error(`${rotulo}: ${onde(json(esperado), json(obtido))}`); } };
const conta = (c) => ({ id: c.id, papel: c.role, tarotId: c.tarotId, active: c.active, departments: c.departments, department: c.department, nome: c.name });

/** Cada categoria devolve `{ esperado, obtido }` por caso; o mesmo par alimenta a conferência e os mutantes. */
const CATEGORIAS = {
  credito: (c) => ({ esperado: c.esperado, obtido: { rounding: ar.arredondamentoDosLotes(c.lotes) ?? null, minutos: ar.minutosDeArredondamento(c.lotes, c.arred), inteiros: ar.minutosInteiros(c.exato),
    alocacao: (({ amount, rawAmount, roundedMinutes, uncoveredMinutes }) => ({ amount, rawAmount, roundedMinutes, uncoveredMinutes }))(base.alocarLotes(c.lotes, c.pedidos, c.valor, c.arred)) } }),
  recibo: (c) => {
    const alvo = c.consultas[0];
    const acerto = (it) => { const s = cob.acerto(it, c.pagamentos); return Object.fromEntries(['unitValue', 'purchased', 'funded', 'chargeable', 'debit', 'cashCredit', 'complementMinutes'].map((f) => [f, s[f]])); };
    return { esperado: c.esperado, obtido: { funding: cob.financiamento(alvo, c.pagamentos), minutos: tentar(() => vinc.minutosFinanciados(alvo, c.pagamentos)), acerto: tentar(() => acerto(alvo)),
      valores: c.pagamentos.map((p) => cob.financiamento(alvo, [p]).map((l) => fd.valorDaFatia(l, p))), reconciliado: tentar(() => fd.reconciliarFatias(clone(c.consultas), c.pagamentos, c.depois, c.aud)) } };
  },
  reserva: (c) => {
    const t = saldo.tarifaDeCredito('c1', c.em, undefined, clone(c.consultas), c.pagamentos, c.perfil || undefined, undefined, c.reservar);
    return { esperado: c.esperado, obtido: { availableMinutes: t.availableMinutes, exactAvailableMinutes: t.exactAvailableMinutes, availableAmount: t.availableAmount, unitValue: t.unitValue, creditRounding: t.creditRounding, paymentIds: t.paymentIds, lots: t.availableLots.map((l) => [l.paymentId, l.cents, l.minutes]) } };
  },
  saida: (c) => ({ esperado: c.esperado, obtido: { pode: saidas.podeRegistrarSaida(c.papel, c.conta || undefined), registro: tentar(() => ocorr.registrarOcorrencia(clone(c.estado), c.entrada, 'Assist', c.papel, c.em, { conta: c.conta || undefined }).payments) } }),
  recados: (c) => {
    if (c.tipo === 'conta') { const k = conta(c.conta); return { esperado: c.esperado, obtido: { permitidos: dep.departamentosPermitidos(k), proprios: dep.departamentosDaConta(k), outros: dep.podeVerOutrosDepartamentos(k) } }; }
    if (c.tipo === 'nota') {
      const k = conta(c.conta);
      return { esperado: c.esperado, obtido: { permitida: dep.notaEmDepartamentosPermitidos(c.nota, k), daConta: dep.notaNosDepartamentosDaConta(c.nota, k), ver: rec.visivel(c.nota, k),
        visao: [false, true].flatMap((outros) => [false, true].map((enviadas) => dep.notaCombinaComAVisao(c.nota, k, k.papel, outros, enviadas))) } };
    }
    const msg = (fn) => { const r = tentar(fn); return r.erro ? { erro: r.erro } : r; };
    return { esperado: c.esperado, obtido: { valida: msg(() => rec.validarPeriodo(c.det)), incompleta: msg(() => rec.validarPeriodo(c.det, { permitirClienteIncompleto: true })), resolvida: msg(() => rec.resolverCliente(c.det, c.clientes)) } };
  },
  identidade: (c) => {
    const e = c.entrada; const perfil = c.perfil || undefined;
    return { esperado: c.esperado, obtido: { passo: tentar(() => lanc.passoDaReserva(c.item, e, perfil)),
      financiamento: tentar(() => { const f = lanc.financiamentoDoLancamento(c.item, { payments: e.payments, consultations: e.consultations, now: e.now }, perfil); const { coverage: cv, ...resto } = f; return { ...resto, coverage: { balance: cv.balance, postpaid: cv.postpaid, benefitMinutes: cv.benefitMinutes, hasConfirmedReceipt: cv.hasConfirmedReceipt, confirmedAvailableBalance: cv.confirmedAvailableBalance, awaitingConfirmation: cv.awaitingConfirmation, canConsult: cv.canConsult, canLaunch: cv.canLaunch, label: cv.label } }; }),
      pagamento: lanc.estadoDePagamento(c.item, e.payments, e.consultations) } };
  },
  transferencia: (c) => { const r = tentar(() => transf.transferirSaldo(clone(c.estado), clone(c.entrada), clone(c.contexto))); return { esperado: c.esperado, obtido: r.ok ? { ok: r.ok.payments } : r }; },
  datas: (c) => { const a = clone(c.args); a[7] = a[7] ?? undefined; a[8] = a[8] ?? undefined; return { esperado: c.esperado, obtido: tentar(() => pagp.pagamentosSemAgenda(...a)) }; },
};

/** Mutante do esperado: troca um valor folha (número +0,01, booleano invertido, texto com sufixo). Devolve cópia ou `null` se não há folha. */
function mutar(v, passo) {
  const folhas = []; (function achar(x, caminho) { if (x && typeof x === 'object') Object.keys(x).forEach((k) => achar(x[k], [...caminho, k])); else if (['number', 'boolean', 'string'].includes(typeof x)) folhas.push(caminho); })(v, []);
  if (!folhas.length) return null;
  const alvo = folhas[passo % folhas.length]; const copia = clone(v); let ref = copia; for (const k of alvo.slice(0, -1)) ref = ref[k];
  const ultimo = alvo[alvo.length - 1]; const atual = ref[ultimo];
  ref[ultimo] = typeof atual === 'number' ? atual + 0.01 : typeof atual === 'boolean' ? !atual : `${atual}!`;
  return copia;
}

const resumo = []; let mutantes = 0; let mutantesPegos = 0;
for (const [nome, lista] of Object.entries(ouro.casos)) {
  let n = 0; let m = 0; let mp = 0;
  lista.forEach((caso, i) => {
    const { esperado, obtido } = CATEGORIAS[nome](caso);
    comparar(`${nome} #${i}`, esperado, obtido); n += 1;
    const mut = mutar(esperado, i); if (mut) { m += 1; if (!igual(mut, obtido)) mp += 1; }
  });
  mutantes += m; mutantesPegos += mp; resumo.push(`${nome}=${n}`);
  if (mp !== m) { falhas += 1; console.error(`${nome}: ${m - mp} mutantes do esperado NÃO foram detectados`); }
}
// o ouro precisa exercitar de fato as regras novas (não só casos neutros)
const por = (nome, f) => ouro.casos[nome].filter(f).length;
const cobertura = {
  'arredondamento aplicado': por('credito', (c) => c.esperado.minutos > 0), 'fração usada na alocação': por('credito', (c) => c.esperado.alocacao.roundedMinutes > 0),
  'fatia de recibo dividido usada': por('recibo', (c) => c.esperado.funding.some((l) => !c.pagamentos.find((p) => p.id === l.paymentId).linkedConsultationId)), 'correção nominal que mexeu nas fatias': por('recibo', (c) => c.esperado.reconciliado.ok && JSON.stringify(c.esperado.reconciliado.ok) !== JSON.stringify(c.consultas)),
  'reserva de mais tempo que mudou o saldo': por('reserva', (c) => c.consultas[0].financialReview && ['awaiting-contact', 'awaiting-payment'].includes(c.consultas[0].financialReview.status) && c.reservar),
  'saída liberada por permissão da conta': por('saida', (c) => c.esperado.pode && ['atendente', 'supervisora'].includes(c.papel)), 'saída recusada': por('saida', (c) => !c.esperado.pode),
  'recados visíveis por departamento': por('recados', (c) => c.tipo === 'nota' && c.esperado.ver), 'recados ocultos': por('recados', (c) => c.tipo === 'nota' && !c.esperado.ver), '"Sobre cliente" aceito': por('recados', (c) => c.tipo === 'detalhes' && c.det.subject === 'Sobre cliente' && c.esperado.valida.ok),
  'agendamento de contato (sem cliente)': por('identidade', (c) => !c.item.clientId || !String(c.item.clientId).trim()), 'passo "Completar cadastro"': por('identidade', (c) => c.esperado.passo.ok && c.esperado.passo.ok.label === 'Completar cadastro'),
  'transferência com autorização aceita': por('transferencia', (c) => c.esperado.ok && c.entrada.authorization && c.entrada.authorization.version === 1 && JSON.stringify(c.esperado.ok).includes('"authorization"')), 'autorização recusada': por('transferencia', (c) => c.esperado.erro && c.entrada.authorization),
  'datas de recibo escolhidas': por('datas', (c) => Array.isArray(c.args[8]) && c.args[8].length > 0 && c.esperado.ok && c.esperado.ok.length > 0),
};
for (const [nome, qtd] of Object.entries(cobertura)) if (!qtd) { falhas += 1; console.error(`O ouro não exercita: ${nome}`); }
if (falhas) { console.error(`FALHOU: ${falhas} divergência(s) com o código real do front.`); process.exit(1); }
console.log(`OK: ${conferidos} conferências iguais ao front (${resumo.join(' ')}); ${mutantesPegos}/${mutantes} mutantes do esperado detectados.`);
console.log(`Cobertura: ${Object.entries(cobertura).map(([k, v]) => `${k}=${v}`).join('; ')}`);
