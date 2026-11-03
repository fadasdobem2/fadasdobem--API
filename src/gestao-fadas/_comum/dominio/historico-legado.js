'use strict';

/**
 * "Esta cliente já é do sistema antigo?" (onda 1, A3 / FINANCEIRO-02 / CONSULTAS-05). PURO: recebe o RESUMO do histórico da cliente no legado ASP e devolve
 * os dois campos que o perfil de preço lê (`hasPriorConsultations`, `firstConsultationAt`), os mesmos de `ClientProfile` do front.
 *
 * REGRA (decisão do Patrick, 02/11/2026): consulta anterior em `tbl_consultas` OU pagamento anterior em `tbl_pagtoinformado`/`tbl_pagtoconfirmado`
 * (valor > 0) => a cliente NÃO é "primeira consulta" (cai na tabela regular, R$ 2,96/min), e não na de primeira compra (35/46/67/120).
 *
 * JANELA DE 24 h PRESERVADA: a cliente realmente nova também tem um pagamento ou uma consulta de poucas horas no legado (paga e consulta no mesmo dia). Por isso
 * `firstConsultationAt` é o MENOR instante válido do histórico e a regra da janela do domínio (`elegibilidadePrimeira`, `firstConsultationWindowHours`)
 * continua valendo: dentro de 24 h do primeiro registro ainda é "primeira"; depois não é. Pagamento só tem o DIA (sem hora): conta no FIM do dia
 * (23:59:59 de São Paulo), o que dá à nova a janela completa. Linha com data inválida (ano < 2000, `1899-12-30`, futura) prova que a cliente é antiga
 * mas não dá instante: `hasPriorConsultations: true` sem `firstConsultationAt` => "antiga conhecida" (nunca primeira).
 *
 * Entrada: `{ consultas: {n, primeira}, pagamentos: {n, primeira} }` com `primeira` = menor data VÁLIDA em texto local `AAAA-MM-DD HH:MM:SS` (ou null).
 */

const { pagamentoPlausivel, inicioSemData } = require('../legado-datas');

const aoFimDoDia = (local) => `${local.slice(0, 10)}T23:59:59-03:00`;
const comoInstante = (local) => `${local.slice(0, 10)}T${local.slice(11, 19) || '00:00:00'}-03:00`;

/** Resultado vazio: a cliente nunca apareceu no legado. */
const SEM_HISTORICO = Object.freeze({ hasPriorConsultations: false });

function perfilDoHistorico({ consultas, pagamentos } = {}, agoraLocal) {
  const nC = Number(consultas && consultas.n) || 0;
  const nP = Number(pagamentos && pagamentos.n) || 0;
  if (nC + nP === 0) return SEM_HISTORICO;
  const instantes = [];
  const c = consultas && consultas.primeira && !inicioSemData(consultas.primeira) ? pagamentoPlausivel(`${consultas.primeira}`.replace(' ', 'T'), agoraLocal) : null;
  if (c) instantes.push(comoInstante(c));
  const p = pagamentos && pagamentos.primeira ? pagamentoPlausivel(`${pagamentos.primeira}`.replace(' ', 'T'), agoraLocal) : null;
  if (p) instantes.push(aoFimDoDia(p));
  const primeira = instantes.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  return primeira ? { hasPriorConsultations: true, firstConsultationAt: primeira } : { hasPriorConsultations: true };
}

module.exports = { SEM_HISTORICO, perfilDoHistorico };
