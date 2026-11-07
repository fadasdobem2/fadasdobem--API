'use strict';

/**
 * Domínio puro do ponto da atendente (turno, pausa, retorno, sinal perdido e encerramento), porte versionado de
 * `features/atendimento/staff-clock.ts` do front da Nice (v702/v706). O servidor é a autoridade do relógio (`em` vem de quem chama).
 * Regras: turno só encerra por comando explícito; sem sinal por 3 batimentos (3 min) vira "saída sem confirmação" e NUNCA infere saída;
 * novo turno só depois de encerrar, ou de uma perda de sinal que atravessou o dia Fadas; batimento com menos de 30 s não grava.
 * Sem banco, sem Express. Se o front mudar a regra, regerar os casos de `scripts/verificar-gf-ponto.js`.
 */

const { operationalDateAt } = require('./operacao-calendario');

const STAFF_CLOCK_HEARTBEAT_MS = 60_000;
const SEM_SINAL_APOS_MS = 3 * STAFF_CLOCK_HEARTBEAT_MS;
const COMANDOS = Object.freeze(['enter', 'start', 'heartbeat', 'pause', 'resume', 'end', 'disconnect']);
const MANUAIS = ['pause', 'resume', 'end', 'start'];
const ACOES = ['start', 'pause', 'resume', 'end'];

const ultimaAcaoDoTurno = (turno) => [...turno.events].reverse().find((e) => ACOES.includes(e.kind));

function estadoDoTurno(turno, agora = Date.now()) {
  if (turno.endedAt) return 'ended';
  const ultimo = turno.events[turno.events.length - 1];
  if (agora - Date.parse(turno.lastSeenAt) > SEM_SINAL_APOS_MS || (ultimo && ultimo.kind) === 'lost') return 'unconfirmed';
  const acao = ultimaAcaoDoTurno(turno);
  return (acao && acao.kind) === 'pause' ? 'paused' : 'working';
}

function podeIniciarTurno(turno, em = Date.now(), historia) {
  if (turno.endedAt) return true;
  return estadoDoTurno(turno, em) === 'unconfirmed' && operationalDateAt(turno.lastSeenAt, historia) !== operationalDateAt(new Date(em), historia);
}

/**
 * `applyStaffClockCommand`: devolve o turno novo, o MESMO objeto `anterior` (nada a gravar) ou `undefined`.
 * Erros têm a frase do front (a tela mostra exatamente esse texto).
 */
function aplicarComandoDePonto(anterior, ator, comando, em, novoId, idEsperado) {
  if (anterior && anterior.accountId !== ator.id) throw new Error('A identidade do ponto mudou.');
  if (!Number.isFinite(em) || (anterior && em < Date.parse(anterior.lastSeenAt))) throw new Error('O relógio está anterior ao último registro.');
  const carimbo = new Date(em).toISOString();
  const data = operationalDateAt(carimbo);
  const manual = MANUAIS.includes(comando);
  if (anterior && manual && idEsperado !== anterior.id) throw new Error('O turno mudou. Confira seu ponto antes de repetir a ação.');
  if (idEsperado && (anterior && anterior.id) !== idEsperado) return anterior;

  if (!anterior || podeIniciarTurno(anterior, em)) {
    // Um turno pode começar num dia Fadas e terminar em outro: o F5 depois da saída usa a data da saída para não abrir turno novo na hora.
    const acessoNovo = comando === 'enter' && (!anterior || !anterior.endedAt || operationalDateAt(anterior.endedAt) !== data);
    if (comando === 'start' || acessoNovo) {
      return {
        id: novoId, accountId: ator.id, accountName: ator.name, operationalDate: data,
        startedAt: carimbo, lastSeenAt: carimbo, events: [{ kind: 'start', at: carimbo }],
      };
    }
    if (manual && !(comando === 'end' && anterior && anterior.endedAt)) throw new Error('Inicie um turno para usar este comando.');
    return anterior;
  }

  if (comando === 'start') return anterior;
  const ultimo = anterior.events[anterior.events.length - 1];
  const ultimoTipo = ultimo && ultimo.kind;
  if (comando === 'disconnect') {
    if (ultimoTipo === 'lost') return anterior;
    return { ...anterior, events: [...anterior.events, { kind: 'lost', at: carimbo, evidence: 'offline' }] };
  }

  const eventos = [...anterior.events];
  if (estadoDoTurno(anterior, em) === 'unconfirmed') {
    // Sem desconexão explícita, vale o último sinal observado; nunca se infere uma saída.
    if (ultimoTipo !== 'lost') eventos.push({ kind: 'lost', at: anterior.lastSeenAt, evidence: 'last-signal' });
    eventos.push({ kind: 'restored', at: carimbo });
  }
  const acao = ultimaAcaoDoTurno(anterior);
  const pausado = (acao && acao.kind) === 'pause';
  if (comando === 'end') eventos.push({ kind: 'end', at: carimbo });
  if (comando === 'pause' && !pausado) eventos.push({ kind: 'pause', at: carimbo });
  if (comando === 'resume' && pausado) eventos.push({ kind: 'resume', at: carimbo });
  if (eventos.length === anterior.events.length && em - Date.parse(anterior.lastSeenAt) < STAFF_CLOCK_HEARTBEAT_MS / 2) return anterior;
  return { ...anterior, events: eventos, lastSeenAt: carimbo, ...(comando === 'end' ? { endedAt: carimbo } : {}) };
}

module.exports = { STAFF_CLOCK_HEARTBEAT_MS, SEM_SINAL_APOS_MS, COMANDOS, ultimaAcaoDoTurno, estadoDoTurno, podeIniciarTurno, aplicarComandoDePonto };
