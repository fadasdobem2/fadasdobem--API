'use strict';

/**
 * Tradução PURA da consulta do Postgres (`OperationalConsultation` do front) para as colunas de `tbl_consultas`, com as armadilhas
 * do dicionário (Maturacao/22 e 28 seção 4.7) tratadas num lugar só:
 *   - `fimConsulta` zero (`0000-00-00 00:00:00`) = consulta ABERTA; é o único campo que aceita o zero. Todas as outras datas são
 *     validadas: recusa zero, inválida e ano fora de 2000..(ano atual + 1);
 *   - `tmpConsulta` em MINUTOS inteiros (int(8)), `ceil(segundos / 60)`; `vlBonus` são MINUTOS de bônus (int(3)); `vlDesconto` é
 *     PERCENTUAL inteiro (int(3)), nunca dinheiro: o espelho não calcula desconto, grava 0;
 *   - `valor_consulta` é o TOTAL cobrado e não se recalcula depois: só viaja quando o servidor o tem (senão `null` mantém o do legado);
 *   - `nmuAtendente` e `atendenteFinalizou` são varchar(25); tudo sem 4 bytes (as colunas são utf8, 3 bytes: emoji quebraria);
 *   - `idFormaPagto` e `idFormaConsulta`: mapeamento PROVISÓRIO de `provisorio.js` (pré-paga 8, pós-paga 1; WhatsApp 4, PABX 1, Telefone 5, resto 6), pendente da Nice;
 *   - "Finalizada pelo tarólogo" NÃO fecha a consulta no legado (sem repasse até a conferência, pergunta 8.2 do contrato): segue aberta.
 *   - o legado não tem coluna de situação: Devolvida, Não houve, Anulada e Erro fecham a linha com 0 minutos e o estado entra em
 *     `obsConsulta` sem marca nenhuma (o ASP já fecha com 0 minuto e sem texto); a situação real fica só no sistema novo.
 */

const ABERTA = '0000-00-00 00:00:00';
const FECHAM_COM_MINUTOS = new Set(['Concluída', 'Cancelada', 'Desistiu']);
const FECHAM_SEM_MINUTOS = new Set(['Devolvida', 'Não houve', 'Anulada', 'Erro']);

class MapeamentoError extends Error { constructor(m) { super(m); this.name = 'MapeamentoError'; } }

const dois = (n) => String(n).padStart(2, '0');
/** Horário de São Paulo, `AAAA-MM-DD HH:MM:SS`, o formato dos DATETIME do legado (sem fuso). Valida o instante. */
function dataDoLegado(iso, rotulo, agora = new Date()) {
  const t = Date.parse(iso);
  if (typeof iso !== 'string' || !Number.isFinite(t)) throw new MapeamentoError(`${rotulo}: data inválida.`);
  const ano = new Date(t).getUTCFullYear();
  if (ano < 2000 || ano > agora.getUTCFullYear() + 1) throw new MapeamentoError(`${rotulo}: ano fora do intervalo aceito (${ano}).`);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const texto = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  if (texto.startsWith('0000') || /^0{4}-00/.test(texto)) throw new MapeamentoError(`${rotulo}: data zerada não é aceita.`);
  return texto;
}

/** Sem caracteres de 4 bytes (emoji e afins) nem controle; corta em `max` caracteres. */
function textoUtf8Basico(valor, max) {
  // eslint-disable-next-line no-control-regex
  const limpo = String(valor ?? '').replace(/[\u{10000}-\u{10FFFF}]/gu, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
  return max ? Array.from(limpo).slice(0, max).join('') : limpo;
}

const { formaDeConsulta: canalDoLegado, formaDePagamentoDaConsulta } = require('./provisorio'); // PROVISÓRIO, pendente da Nice

const minutosInteiros = (segundos) => {
  const s = Number(segundos);
  if (!Number.isFinite(s) || s < 0 || s > 86400) throw new MapeamentoError('Duração fora do intervalo aceito.');
  return Math.ceil(s / 60);
};

/** Decimal em texto com 2 casas (dinheiro nunca em float para o MySQL). `null` quando o servidor não tem o total. */
function totalDecimal(item, minutos) {
  const v = item.minuteValue;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100000 || !FECHAM_COM_MINUTOS.has(item.status)) return null;
  return (Math.round(minutos * v * 100) / 100).toFixed(2);
}

/**
 * Valores da linha do legado para o estado atual da consulta. Devolve `{ colunas, total, fechada }`; `colunas` com TODAS as chaves de
 * `COLUNAS_INSERT` (o UPDATE usa o subconjunto de `COLUNAS_UPDATE`). `idTarologoLegado`: inteiro já resolvido (login ou número).
 */
function linhaDoLegado(item, idTarologoLegado, agora = new Date()) {
  const idUsuario = Number(item.clientId);
  if (!Number.isInteger(idUsuario) || idUsuario < 1 || idUsuario > 2147483647) throw new MapeamentoError('Cliente fora do intervalo do legado.');
  if (!Number.isInteger(idTarologoLegado) || idTarologoLegado < 1) throw new MapeamentoError('Tarólogo sem código no legado.');
  const inicioIso = item.tarologistStartedAt || item.startedAt;
  const inicio = dataDoLegado(inicioIso, 'iniConsulta', agora);
  const fecha = (FECHAM_COM_MINUTOS.has(item.status) || FECHAM_SEM_MINUTOS.has(item.status)) && item.endedAt;
  const minutos = FECHAM_COM_MINUTOS.has(item.status) ? minutosInteiros(item.durationSeconds) : 0;
  const fim = fecha ? dataDoLegado(item.endedAt, 'fimConsulta', agora) : ABERTA;
  // Sem marca na observação: o ASP já registra consulta que não aconteceu como fechada com 0 minuto, sem texto nenhum (1.562 em 12 meses).
  // A situação real (Devolvida, Anulada, Erro, Não houve) fica só no sistema novo. Decisão do Patrick, 30/10/2026.
  const obs = textoUtf8Basico(item.observation || '').slice(0, 60000);
  const finalizou = fecha ? textoUtf8Basico((item.finishReview && item.finishReview.by) || (item.tarologistFinishReport && item.tarologistFinishReport.reporterName) || item.attendant || '', 25) : '';
  return {
    fechada: Boolean(fecha),
    total: totalDecimal(item, minutos),
    colunas: {
      idUsuario, idTarologo: idTarologoLegado, dtConsulta: dataDoLegado(item.sentToTarologistAt || item.startedAt, 'dtConsulta', agora), iniConsulta: inicio, fimConsulta: fim,
      tmpConsulta: minutos, idFormaConsulta: canalDoLegado(item.channel), idFormaPagto: formaDePagamentoDaConsulta(item.paymentProfile), obsConsulta: obs,
      dtVencto: inicio, vlDesconto: 0, vlBonus: item.bonusGrant && Number.isInteger(item.bonusGrant.minutes) ? Math.min(999, Math.max(0, item.bonusGrant.minutes)) : 0,
      nmuAtendente: textoUtf8Basico(item.attendant || '', 25), atendenteFinalizou: finalizou, IDProdutoConsulta: 1, valor_consulta: '0.00',
    },
  };
}

module.exports = { ABERTA, MapeamentoError, dataDoLegado, textoUtf8Basico, canalDoLegado, minutosInteiros, linhaDoLegado };
