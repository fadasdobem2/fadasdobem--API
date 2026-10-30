'use strict';

/**
 * Refazer ocorrências financeiras e transferências de saldo no servidor (Maturacao/42, item 3). Reconhece QUAL função do front rodou pelo que o
 * registro do navegador ganhou (ocorrência nova, evento novo numa ocorrência, movimento `balance-transfer` novo), reconstrói a entrada pela
 * assinatura que o próprio front guardou (`commandSignatures`, `operationSignature`), refaz com o contexto REAL e o instante/autor do navegador
 * (tem de dar o registro IGUAL; senão 422) e grava o refeito com o instante/autor DO SERVIDOR. O perfil de crédito vem do servidor, não do navegador.
 */

const { igual } = require('./pagamentos-igual');
const { PagamentoInvalidoError } = require('./pagamentos-regras');
const O = require('./pagamentos-ocorrencias');
const C = require('./pagamentos-ocorrencias-conciliar');
const T = require('./pagamentos-transferencia');

const NAO_CONFERE = 'Não foi possível identificar esta alteração.';
const recusa = () => { throw new PagamentoInvalidoError(NAO_CONFERE); };

const POR_EVENTO = {
  'Decisão financeira registrada': ['atualizar', O.atualizarOcorrencia], 'Retirada pelo banco': ['atualizar', O.atualizarOcorrencia],
  'Contestação aceita pelo banco': ['atualizar', O.atualizarOcorrencia], 'Contestação não aceita pelo banco': ['atualizar', O.atualizarOcorrencia],
  'Pagamento localizado': ['reconciliar', C.reconciliarOcorrencia], 'Dinheiro retornou': ['reconciliar', C.reconciliarOcorrencia],
  'Pagamento vinculado à regularização': ['regularizar', C.regularizarOcorrencia], 'Contato registrado': ['contatar', C.contatarOcorrencia],
};

/** O comando de ocorrência que o navegador aplicou, ou `null` se a revisão não mexeu nas ocorrências; recusa se mexeu em mais de uma. */
function comandoDeOcorrencia(antes, depois) {
  const a = antes.financialOccurrences || []; const d = depois.financialOccurrences || [];
  if (!d.length && !a.length) return null;
  const novas = d.filter((o) => !a.some((x) => x.id === o.id));
  const mexidas = d.filter((o) => { const x = a.find((y) => y.id === o.id); return x && !igual(x, o); });
  if (d.length < a.length || novas.length + mexidas.length === 0) return d.length < a.length ? recusa() : null;
  if (novas.length + mexidas.length > 1) recusa();
  if (novas.length) {
    const o = novas[0]; const ev = o.events && o.events[0];
    if (!ev || o.events.length !== 1) recusa();
    return { tipo: 'registrar', funcao: O.registrarOcorrencia, operationId: ev.id, ocorrencia: o };
  }
  const o = mexidas[0]; const antiga = a.find((x) => x.id === o.id);
  if (o.events.length !== antiga.events.length + 1) recusa();
  const ev = o.events[o.events.length - 1];
  const par = POR_EVENTO[ev.action];
  if (!par) recusa();
  return { tipo: par[0], funcao: par[1], operationId: ev.id, ocorrencia: o };
}

/** Entrada do comando = a assinatura que o front guardou; o perfil de crédito é o do servidor. */
function entradaDaAssinatura(comando, contexto) {
  const assinatura = (comando.ocorrencia.commandSignatures || {})[comando.operationId];
  if (typeof assinatura !== 'string') recusa();
  let entrada;
  try { entrada = JSON.parse(assinatura); } catch { recusa(); }
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) recusa();
  if (entrada.creditProfile) entrada = { ...entrada, creditProfile: contexto.profile };
  return { entrada, assinatura };
}

/** Refaz a ocorrência. `ator`: `{ nome, perfil }`. Devolve `{ tipo, registro }` ou `null`. */
function refazerOcorrencia(antes, depois, ator, agora, contexto) {
  const comando = comandoDeOcorrencia(antes, depois);
  if (!comando) return null;
  const estado = { payments: contexto.payments.map((p) => (p.id === antes.id ? antes : p)), consultations: contexto.consultations };
  const { entrada, assinatura } = entradaDaAssinatura(comando, contexto);
  const rodar = (nome, em) => {
    const r = comando.funcao(estado, entrada, nome, ator.perfil, em, { assinatura });
    const p = r.payments.find((x) => x.id === antes.id);
    if (!p || r === estado) recusa();
    return p;
  };
  const conferido = rodar(depois.updatedBy, depois.updatedAt);
  if (!igual(conferido, depois)) recusa();
  return { tipo: `ocorrencia-${comando.tipo}`, registro: comMotivos(rodar(ator.nome, agora), depois) };
}

/** Copia o retrato do motivo financeiro que o navegador capturou (movimentos novos e o do pagamento). */
function comMotivos(registro, depois) {
  const motivo = (m) => m && typeof m === 'object' && typeof m.id === 'string' && typeof m.nature === 'string' && typeof m.name === 'string' ? m : undefined;
  const movimentos = (registro.movements || []).map((m) => { const d = (depois.movements || []).find((x) => x.id === m.id); const r = d && motivo(d.financialReason); return r && !m.financialReason ? { ...m, financialReason: r } : m; });
  return { ...registro, ...(registro.movements ? { movements: movimentos } : {}) };
}

// --- transferência de saldo -----------------------------------------------------------------------------------------------
/** Pernas de transferência novas neste pagamento (ids que o guardado não tem). */
function pernasNovas(antes, depois) {
  const tinha = new Set((antes.movements || []).map((m) => m.id));
  return (depois.movements || []).filter((m) => m.kind === 'balance-transfer' && !tinha.has(m.id));
}

/** `{ source, target, operationId, amount, note, reversalOf, nomes }` a partir da assinatura da perna (`operationSignature`). */
function dadosDaTransferencia(perna) {
  const t = perna.balanceTransfer;
  if (!t || typeof t.operationId !== 'string' || typeof perna.operationSignature !== 'string') recusa();
  let a; try { a = JSON.parse(perna.operationSignature); } catch { recusa(); }
  if (!a || a.source !== t.sourceClientId || a.target !== t.targetClientId || !Number.isSafeInteger(a.amount)) recusa();
  return { id: t.operationId, source: a.source, target: a.target, amount: a.amount / 100, note: a.note, reversalOf: a.reversalOf, nomes: { [a.source]: t.sourceClient, [a.target]: t.targetClient } };
}

/**
 * Refaz UMA perna da transferência: o estado de ANTES da operação (sem nenhuma perna dela) recebe `transferClientBalance`; a perna deste pagamento tem
 * de ser a mesma que o navegador mandou. `contexto`: `{ payments, consultations, perfis, nomes (só clientes que existem), valorRegular }`, das clientes de origem.
 */
function refazerTransferencia(antes, depois, ator, agora, contexto) {
  const pernas = pernasNovas(antes, depois);
  if (!pernas.length) return null;
  const dados = dadosDaTransferencia(pernas[0]);
  if (pernas.some((p) => p.balanceTransfer.operationId !== dados.id)) recusa();
  const semPernas = (p) => (p.movements && p.movements.some((m) => m.balanceTransfer && m.balanceTransfer.operationId === dados.id) ? { ...p, movements: p.movements.filter((m) => !(m.balanceTransfer && m.balanceTransfer.operationId === dados.id)) } : p);
  const pagamentos = contexto.payments.map((p) => (p.id === antes.id ? antes : p)).map(semPernas);
  const estado = { payments: pagamentos, consultations: contexto.consultations };
  const entrada = { id: dados.id, sourceClientId: dados.source, targetClientId: dados.target, amount: dados.amount, note: dados.note, ...(dados.reversalOf ? { reversalOf: dados.reversalOf } : {}) };
  const nomes = {}; for (const id of [dados.source, dados.target]) if (contexto.nomes[id]) nomes[id] = dados.nomes[id];
  const rodar = (nome, em) => {
    const r = T.transferirSaldo(estado, entrada, { profiles: contexto.perfis, names: nomes, regularMinuteValue: contexto.valorRegular, actor: nome, role: ator.perfil, at: em });
    const p = r.payments.find((x) => x.id === antes.id);
    if (!p || r === estado) recusa();
    return p;
  };
  const conferido = rodar(depois.updatedBy, depois.updatedAt);
  if (!igual(conferido, depois)) recusa();
  return { tipo: 'transferencia-saldo', registro: rodar(ator.nome, agora) };
}

module.exports = { refazerOcorrencia, refazerTransferencia, comandoDeOcorrencia, pernasNovas, dadosDaTransferencia };
