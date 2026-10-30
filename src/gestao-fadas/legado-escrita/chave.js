'use strict';

/**
 * Chave NATURAL da intenção de espelho (reconciliação de órfãs). Como o legado não ganha coluna nem marca, a linha que o INSERT cria
 * só é reconhecida depois por: cliente, tarólogo, `dtConsulta` e `iniConsulta` (os mesmos valores que o mapeamento grava).
 * A chave é fixada UMA vez, na intenção (antes do INSERT), e viaja no `legado_detalhe` como `#k=cliente|tarotId|dt|ini`:
 * se a consulta mudar depois (início pelo tarólogo muda `iniConsulta`), a órfã ainda é achada pelo que foi gravado no INSERT.
 * Não se põe marcador na observação: ela é lida pelo sistema antigo e não pode ganhar texto que a Nice não pediu.
 */

const { dataDoLegado } = require('./mapeamento');

const PREFIXO = '#k=';

/** Chave da intenção a partir do estado atual da consulta (pura). Lança `MapeamentoError` se a data é inválida. */
function chaveDaIntencao(item, agora = new Date()) {
  const idUsuario = Number(item.clientId);
  const ini = dataDoLegado(item.tarologistStartedAt || item.startedAt, 'iniConsulta', agora);
  const dt = dataDoLegado(item.sentToTarologistAt || item.startedAt, 'dtConsulta', agora);
  return { idUsuario, tarotId: `${item.tarotId}`, dtConsulta: dt, iniConsulta: ini };
}

const serializar = (c) => `${PREFIXO}${c.idUsuario}|${c.tarotId}|${c.dtConsulta}|${c.iniConsulta}`;

/** Lê a chave de um `legado_detalhe`; `null` se não há (ou está truncada). */
function lerDoDetalhe(detalhe) {
  const i = `${detalhe || ''}`.lastIndexOf(PREFIXO);
  if (i < 0) return null;
  const p = detalhe.slice(i + PREFIXO.length).split('|');
  if (p.length !== 4 || !/^\d{1,10}$/.test(p[0]) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(p[2]) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(p[3])) return null;
  return { idUsuario: Number(p[0]), tarotId: p[1], dtConsulta: p[2], iniConsulta: p[3] };
}

/** Texto do detalhe (até 300) com a chave no fim: o motivo é cortado para a chave nunca ser truncada. */
function detalheComChave(texto, chave) {
  if (!chave) return `${texto}`.slice(0, 300);
  const sufixo = ` ${serializar(chave)}`;
  return `${`${texto}`.slice(0, 300 - sufixo.length)}${sufixo}`;
}

module.exports = { chaveDaIntencao, serializar, lerDoDetalhe, detalheComChave };
