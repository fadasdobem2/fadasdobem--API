'use strict';

/**
 * Regras PURAS das Consultas reais (sem banco, sem relógio): porte fiel de
 * `features/consultas/real-consultations-model.ts` (B). Os nomes do DTO ficam IDÊNTICOS aos da B (inglês) para o futuro
 * "gate" de compatibilidade com o front do suspiro; só as funções têm nome em português.
 *
 *   buildRealConsultationsCut -> montarRecorteConsultas      buildRealConsultations -> montarConsultas
 *
 * Regras (contrato `operations-http.md` da B):
 *  - dia operacional 06h-06h do INÍCIO da consulta; em curso = sem fim válido OU sem minutagem (R4);
 *  - "abertas desde antes" só quando o intervalo inclui hoje (R7); filtro de tarólogo vale também para elas;
 *  - zero gravado em consulta sem fim NÃO é preço (D10): vem `null` e `amountState: 'em-andamento'`;
 *  - totais somam só as finalizadas do recorte inteiro (em centavos); só `finished` é paginado (500), do início mais
 *    recente ao mais antigo; `inProgress` vem sempre inteiro.
 */

const { somarDinheiro } = require('./helpers/dinheiro');
const { chaveDiaOperacional } = require('./helpers/periodo');
const { paginar } = require('./helpers/pagina');
const { ENDED_BEFORE_START, rotuloCliente } = require('./helpers/leitura-legado');

/**
 * Evidência da modalidade pelo `idFormaPagto` legado (R4). Só o código 8 ("Pré Pago") prova pré-paga; nenhum código
 * prova pós-paga, então "pos" não tem linha aqui. Nova evidência entra como linha, por decisão registrada.
 */
const MODALITY_EVIDENCE = new Map([['8', 'pre']]);

function minutosDecorridos(inicioLocal, agoraLocal) {
  // Os dois textos são o mesmo relógio de parede; lê-los como UTC cancela qualquer deslocamento.
  const diff = Date.parse(`${agoraLocal}Z`) - Date.parse(`${inicioLocal}Z`);
  return Math.max(0, Math.floor(diff / 60000));
}

function paraConsultaReal(linha, operationalDate, situation, nowLocal) {
  const finished = situation === 'finalizada';
  // O legado grava 0.00 enquanto a consulta está aberta: esse zero não é preço, então não chega à tela (D10).
  const recordedAmount = !finished && linha.recordedAmount === '0.00' ? null : linha.recordedAmount;
  return {
    id: linha.id, clientId: linha.clientId, ...rotuloCliente(linha.clientId, linha.clientIdentification),
    tarotId: linha.tarotId, tarotName: linha.tarotName,
    startedAtLocal: linha.startedAtLocal, endedAtLocal: linha.endedAtLocal, operationalDate, situation,
    elapsedMinutes: finished || linha.startedAtLocal === null ? null : minutosDecorridos(linha.startedAtLocal, nowLocal),
    recordedMinutes: linha.recordedMinutes, recordedAmount,
    amountState: !finished ? 'em-andamento' : recordedAmount === null ? 'nao-informado' : 'registrado',
    modality: MODALITY_EVIDENCE.get(linha.paymentOption.code ?? '') ?? null,
    discountPercent: linha.discountPercent, bonusMinutes: linha.appliedBonusMinutes, abatement: linha.recordedAbatement,
    paymentOption: linha.paymentOption, channel: linha.channel, issues: [...linha.issues],
  };
}

function porInicio(a, b) {
  return (a.startedAtLocal ?? '').localeCompare(b.startedAtLocal ?? '') || Number(a.id) - Number(b.id);
}

/**
 * O recorte inteiro, todas as finalizadas antes da página: as páginas da tela são fatias dele e a exportação o leva todo (R23).
 * `entrada` = { rows, range: { start, end }, nowLocal, tarotId? } (rows = saída de `lerConsultaLegado`).
 */
function montarRecorteConsultas(entrada) {
  const { range, nowLocal } = entrada;
  const today = chaveDiaOperacional(nowLocal);
  const includesToday = range.start <= today && today <= range.end;
  const inProgress = [];
  const finished = [];
  const earlier = [];

  for (const linha of entrada.rows) {
    if (!linha.startedAtLocal) continue;
    if (entrada.tarotId !== undefined && linha.tarotId !== entrada.tarotId) continue;
    const day = chaveDiaOperacional(linha.startedAtLocal);
    const open = linha.endedAtLocal === null || linha.recordedMinutes === null;
    if (day >= range.start && day <= range.end) {
      if (open) inProgress.push(paraConsultaReal(linha, day, 'em-curso', nowLocal));
      else finished.push(paraConsultaReal(linha, day, 'finalizada', nowLocal));
    } else if (open && day < range.start && includesToday) {
      earlier.push(paraConsultaReal(linha, day, 'aberta-antes', nowLocal));
    }
  }
  // As finalizadas do início mais recente (decisão D5), como a tela as lista, então as páginas também; as abertas, da mais antiga.
  inProgress.sort(porInicio);
  finished.sort((a, b) => porInicio(b, a));
  earlier.sort(porInicio);

  return {
    range: { start: range.start, end: range.end },
    inProgress, finished, openSinceEarlier: includesToday ? { items: earlier } : null,
    totals: {
      inProgress: inProgress.length, openSinceEarlier: includesToday ? earlier.length : 0, finished: finished.length,
      // Só as finalizadas entram na soma; as sem fim ficam de fora, mesmo com valor gravado (D10).
      recordedAmount: somarDinheiro(finished.map((item) => item.recordedAmount)),
      recordedMinutes: finished.reduce((total, item) => total + (item.recordedMinutes ?? 0), 0),
      // Consulta sem fim não "falta" nada, só não terminou: apenas finalizada pode faltar valor ou minutos. Pela R4 uma
      // sem minutos é aberta, então uma finalizada sempre tem minutos e essa contagem é sempre 0.
      missingAmount: finished.filter((item) => item.recordedAmount === null).length,
      missingMinutes: finished.filter((item) => item.recordedMinutes === null).length,
    },
  };
}

/** O recorte com `finished` fatiado na página pedida (500 por página); página além da última lança PaginaForaDoIntervalo. */
function montarConsultas(entrada) {
  const corte = montarRecorteConsultas(entrada);
  const paginado = paginar(corte.finished, entrada.page);
  return {
    range: corte.range, inProgress: corte.inProgress, finished: paginado.items,
    openSinceEarlier: corte.openSinceEarlier, page: paginado.page, totals: corte.totals,
  };
}

/**
 * REFERÊNCIA para o futuro gate: na B a leitura de Consultas/Pagamentos (`canReadRealOperations`) é só da administradora
 * e da assistente (`features/domain/permissions.ts`). Na A quem manda é o RBAC `consultas.ver` (consultas.routes.js);
 * esta tabela NÃO é usada em runtime, só prova a paridade com a B.
 */
const PERFIS_LEITURA_OPERACOES_REAIS = Object.freeze(['administradora', 'assistente']);
const podeLerOperacoesReais = (perfil) => PERFIS_LEITURA_OPERACOES_REAIS.includes(perfil);

module.exports = {
  ENDED_BEFORE_START, MODALITY_EVIDENCE, PERFIS_LEITURA_OPERACOES_REAIS, podeLerOperacoesReais, montarRecorteConsultas, montarConsultas,
};
