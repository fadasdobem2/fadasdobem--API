'use strict';

/**
 * Saldo de ABERTURA da cliente CALCULADO do histórico do legado (ASP), sem planilha (decisão do Patrick, 30/10/2026; Maturacao/52).
 * Função PURA: recebe as linhas já lidas (pagamentos e consultas da cliente) e devolve o saldo em centavos. Regras do código do front:
 *   - crédito: pagamento Informado já conta (status 0 = fluxo automático/Mercado Pago, 1 = Informado), 2 = Confirmado; só "A confirmar",
 *     cancelado, bloqueado ou pendente ficam fora (`finance/cash-ledger.ts`, `finance/payment-records.ts`);
 *   - minutos do pagamento pela tabela fixa de pacotes (`domain/consultation-coverage.ts#legacyPurchaseMinutes`, que inclui R$ 35, 46, 67 e
 *     120 da primeira consulta: o histórico do ASP não tem a marca "PIX + janela de 24 h" que o front exige para pagamento NOVO, e a
 *     cliente recebeu esses minutos); valor fora da tabela vale a tarifa regular de R$ 2,96;
 *   - consumo: minutos da consulta que aconteceu (`tmpConsulta` > 0) menos os minutos de bônus (`vlBonus`), em reais, por lote de compra
 *     na ordem de entrada (FIFO) com a tarifa de CADA compra (`domain/credit-tariff.ts`); o que passar do crédito vira dívida a R$ 2,96;
 *   - pagamento novo quita primeiro a dívida (igual ao front). Sem validade de crédito. Sem mínimo de 15 minutos (o ASP cobrava o tempo real).
 * Nada aqui lê banco nem relógio.
 */

const b = require('./financeiro-base');

const TARIFA_REGULAR = b.PRECOS_PADRAO.regularMinuteValue;
const TEXTOS_FORA = new Set(['pendente', 'bloqueado', 'cancelado']);
const EPS = 1e-7;

const instanteValido = (v) => (typeof v === 'string' && /^(19[89]\d|20\d\d)-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(v) ? v.slice(0, 19).replace('T', ' ') : null);

/** Centavos de um DECIMAL em texto (`"88.80"`); null se não for dinheiro positivo. */
function centavosDe(valor) {
  const m = String(valor ?? '').trim().match(/^(\d{1,15})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const c = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0);
  return c > 0 ? c : null;
}

/** O pagamento do legado conta como crédito? Número 0, 1 ou 2 e texto vazio, "informado" ou "confirmado" (sem número: cópia confirmada). */
function contaComoCredito({ numero, texto }) {
  const n = numero === null || numero === undefined || numero === '' ? null : Number(numero);
  if (n !== null && ![0, 1, 2].includes(n)) return false;
  return !TEXTOS_FORA.has(String(texto ?? '').trim().toLowerCase());
}

/** Lote de compra pela tabela fixa do front: pacote conhecido tem a tarifa da compra; o resto, R$ 2,96. */
function loteDaCompra(centavos) {
  const pacote = b.minutosDoPacoteLegado(centavos / 100) || 0;
  const unitario = pacote ? centavos / 100 / pacote : TARIFA_REGULAR;
  return { cents: centavos, minutes: pacote || centavos / 100 / unitario, unit: unitario };
}

/** Minutos cobrados de uma consulta do legado: os realizados menos o bônus; consulta que não aconteceu (0 ou aberta) não cobra. */
function minutosCobrados({ minutos, bonus }) {
  const feitos = Number(minutos);
  if (!Number.isFinite(feitos) || feitos <= 0) return 0;
  return Math.max(0, feitos - Math.max(0, Number(bonus) || 0));
}

/**
 * @param {{pagamentos: Array<{pagoEm?:string, criadoEm?:string, valor:string, numero:*, texto:*}>, consultas: Array<{fim?:string, ini?:string, dia?:string, minutos:*, bonus:*}>}} historico
 * @returns {{centavos:number, creditosCentavos:number, consumoCentavos:number, minutosConsumidos:number, pagamentos:number, consultas:number, dividaCentavos:number}}
 */
function saldoDaAbertura({ pagamentos = [], consultas = [] }, { ate } = {}) {
  const eventos = [];
  let ordem = 0;
  // `ate` (conferência da migração): só entra o que aconteceu até o corte da cliente (instante de parede `YYYY-MM-DD HH:MM:SS`, inclusive). Instante ilegível fica dentro, como sempre.
  const depois = { pagamentos: 0, consultas: 0 };
  const apos = (t) => Boolean(ate) && t !== '' && t > ate;
  for (const p of pagamentos) {
    const centavos = contaComoCredito({ numero: p.numero, texto: p.texto }) ? centavosDe(p.valor) : null;
    const t = instanteValido(p.pagoEm) || instanteValido(p.criadoEm) || '';
    if (centavos && apos(t)) { depois.pagamentos += 1; continue; }
    if (centavos) eventos.push({ t, rank: 0, ordem: ordem++, centavos });
  }
  for (const k of consultas) {
    const minutos = minutosCobrados({ minutos: k.minutos, bonus: k.bonus });
    const t = instanteValido(k.fim) || instanteValido(k.ini) || instanteValido(k.dia) || '';
    if (Number(k.minutos) > 0 && apos(t)) { depois.consultas += 1; continue; }
    if (Number(k.minutos) > 0) eventos.push({ t, rank: 1, ordem: ordem++, minutos });
  }
  eventos.sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : x.rank - y.rank || x.ordem - y.ordem));

  const lotes = []; let divida = 0; let creditos = 0; let consumo = 0; let minutosConsumidos = 0; let nPag = 0; let nCons = 0;
  for (const e of eventos) {
    if (e.rank === 0) {
      nPag += 1; creditos += e.centavos;
      const quitado = Math.min(divida, e.centavos); divida -= quitado;
      const resto = e.centavos - quitado;
      if (resto > 0) { const l = loteDaCompra(e.centavos); lotes.push({ cents: resto, minutes: Math.max(0, l.minutes - quitado / 100 / l.unit), unit: l.unit }); }
      continue;
    }
    nCons += 1; minutosConsumidos += e.minutos;
    let falta = e.minutos;
    while (falta > EPS && lotes.length) {
      const lote = lotes[0];
      const tomados = Math.min(falta, lote.minutes);
      const gasto = tomados >= lote.minutes - EPS ? lote.cents : Math.min(lote.cents, Math.round(tomados * lote.unit * 100));
      lote.cents -= gasto; lote.minutes -= tomados; falta -= tomados; consumo += gasto;
      if (lote.cents <= 0 || lote.minutes <= EPS) lotes.shift();
    }
    if (falta > EPS) { const d = Math.round(falta * TARIFA_REGULAR * 100); divida += d; consumo += d; }
  }
  const saldo = lotes.reduce((s, l) => s + l.cents, 0) - divida;
  return { centavos: saldo, creditosCentavos: creditos, consumoCentavos: consumo, minutosConsumidos, pagamentos: nPag, consultas: nCons, dividaCentavos: divida, ...(ate ? { depoisDoCorte: depois } : {}) };
}

module.exports = { TARIFA_REGULAR, contaComoCredito, loteDaCompra, minutosCobrados, centavosDe, saldoDaAbertura };
