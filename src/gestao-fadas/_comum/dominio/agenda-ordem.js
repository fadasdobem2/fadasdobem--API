'use strict';

/**
 * Domínio puro da ORDEM DA FILA, porte versionado de `features/agenda/agenda-order-command.ts` (impressão `queue-v1`) e da regra de
 * conflito de `features/agenda/agenda-order-sync.ts` (`authority`, `branchesFrom`, `follows`, `commandFor`) do front do suspiro.
 *   - `revisaoDaFila`: `agendaQueueRevision`. A impressão tem de sair IGUAL à do navegador, byte a byte (casos de ouro no verificador);
 *   - `decidirOrdem`: com a fila atual e o comando que chega, diz se aplica, recusa ou substitui. Supervisão (supervisora,
 *     administradora, assistente) vence a atendente quando os dois partem da mesma revisão; ordem posterior da atendente sobre a
 *     revisão atual é aceita.
 * Sem banco, sem Express.
 */

const { encerrado } = require('./agenda-contato');

const chaveDaFila = (tarotId) => `queue:${tarotId}`;
const filaAberta = (itens, tarotId) => itens.filter((i) => i.tarotId === tarotId && !encerrado(i));

/** `stable` do front: remove `undefined`, ordena as chaves com `localeCompare` (como o navegador). */
function estavel(v) {
  if (Array.isArray(v)) return v.map(estavel);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, estavel(x)]));
  }
  return v;
}

/** `revisionFingerprint` do front: quatro acumuladores de 32 bits (Math.imul) sobre os códigos UTF-16 do texto. */
function impressao(texto) {
  let a = 0x9e3779b9; let b = 0x85ebca6b; let c = 0xc2b2ae35; let d = 0x27d4eb2f;
  for (let i = 0; i < texto.length; i += 1) {
    const code = texto.charCodeAt(i);
    a = Math.imul(a ^ code, 0x85ebca6b); b = Math.imul(b ^ code, 0xc2b2ae35); c = Math.imul(c ^ code, 0x27d4eb2f); d = Math.imul(d ^ code, 0x165667b1);
  }
  return `queue-v1:${texto.length}:${[a, b, c, d].map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('')}`;
}

/** `agendaQueueRevision`: só os itens ABERTOS da fila, por id; contato, dinheiro e relógio não entram. */
function revisaoDaFila(itens, tarotId) {
  const linhas = filaAberta(itens, tarotId).map((i) => ({
    id: i.id, position: i.position, overrides: i.positionOverrides,
    command: i.orderCommand && i.orderCommand.queueKey === chaveDaFila(tarotId) ? i.orderCommand.id : undefined,
  })).sort((x, y) => x.id.localeCompare(y.id));
  return impressao(JSON.stringify(estavel(linhas)));
}

/** `authority` do front: gestão (supervisora, administradora, assistente) vale 1, atendente 0. */
const autoridade = (papel) => (papel === 'supervisora' || papel === 'administradora' || papel === 'assistente' ? 1 : 0);
const segue = (comando, anterior) => Boolean(comando.lineage && comando.lineage.some((x) => x.id === anterior.id));
const partiuDe = (comando, revisao) => comando.baseRevision === revisao || Boolean(comando.lineage && comando.lineage.some((x) => x.baseRevision === revisao));

/** `commandFor`: o comando vigente da fila (o mais recente entre os que os itens abertos carregam). */
function comandoVigente(itens, tarotId) {
  const mapa = new Map();
  for (const i of filaAberta(itens, tarotId)) {
    const c = i.orderCommand;
    if (c && c.id !== 'pending' && c.actorRole && c.actorRole !== 'tarologa' && Number.isFinite(Date.parse(c.at)) && c.queueKey === chaveDaFila(tarotId)) mapa.set(c.id, c);
  }
  return [...mapa.values()].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))[0];
}

/**
 * Decide o destino de um comando que chega (`comando` com `baseRevision`, `lineage?`, `actorRole`) sobre a fila atual.
 * `{ acao: 'aplicar' | 'recusar', motivo?: 'authority'|'stale'|'concurrent', substitui?: comando }`.
 *   - revisão de base igual à atual, ou comando que descende da atual: aplica;
 *   - o vigente e o que chega partem da mesma revisão (concorrentes): vence a maior autoridade; empate fica com o já gravado;
 *   - qualquer outro caso é fila velha: recusa ("Não foi possível mover a cliente. Tente arrastar novamente.").
 */
function decidirOrdem(itens, tarotId, comando) {
  const atual = revisaoDaFila(itens, tarotId);
  if (comando.baseRevision === atual) return { acao: 'aplicar' };
  const vigente = comandoVigente(itens, tarotId);
  if (partiuDe(comando, atual)) return { acao: 'aplicar' };
  if (vigente && !segue(comando, vigente) && partiuDe(comando, vigente.baseRevision) && partiuDe(vigente, vigente.baseRevision)) {
    if (autoridade(comando.actorRole) > autoridade(vigente.actorRole)) return { acao: 'aplicar', substitui: vigente };
    return { acao: 'recusar', motivo: autoridade(comando.actorRole) !== autoridade(vigente.actorRole) ? 'authority' : 'concurrent' };
  }
  return { acao: 'recusar', motivo: 'stale' };
}

module.exports = { chaveDaFila, filaAberta, estavel, impressao, revisaoDaFila, autoridade, comandoVigente, decidirOrdem };
