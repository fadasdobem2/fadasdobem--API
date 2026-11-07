'use strict';

/**
 * O relógio de ponto da atendente (`resource=current`). O servidor é a autoridade do horário: `em` é o relógio dele. A regra é a de
 * `_comum/dominio/ponto-turno.js` (paridade com o front). Uma gravação por conta de cada vez (trava consultiva), então "entradas
 * simultâneas não duplicam turnos" sem laço de repetição.
 */

const { randomUUID } = require('crypto');
const { aplicarComandoDePonto, COMANDOS } = require('../../_comum/dominio/ponto-turno');
const { emTransacao } = require('../../novo/escritor');
const { PontoErro } = require('./ponto.erro');
const store = require('./ponto.store');

const ID_VALIDO = /^[\w.-]{1,160}$/;

async function lerAtual(pessoa) {
  return { status: 200, corpo: { shift: await store.turnoAtual(pessoa.id) } };
}

async function comandar(pessoa, corpo, relogio) {
  const { command: comando, shiftId } = corpo;
  if (!COMANDOS.includes(comando) || (shiftId !== undefined && !(typeof shiftId === 'string' && ID_VALIDO.test(shiftId))) || Object.keys(corpo).some((k) => k !== 'command' && k !== 'shiftId')) {
    throw new PontoErro('Comando ou identificação de turno inválido.', 400);
  }
  return emTransacao(async (ex) => {
    const linha = await store.turnoParaGravar(ex, pessoa.id);
    const anterior = linha ? linha.turno : undefined;
    let proximo;
    try {
      proximo = aplicarComandoDePonto(anterior, { id: pessoa.id, name: pessoa.name }, comando, relogio(), randomUUID(), shiftId);
    } catch (erro) {
      throw new PontoErro(erro instanceof Error ? erro.message : 'Confira o estado do ponto.', 409);
    }
    if (!proximo || proximo === anterior) return { status: 200, corpo: { shift: anterior || null } };
    if (linha && proximo.id === linha.id) {
      const [r] = await store.atualizarTurno(ex, linha, proximo);
      if (r.affectedRows !== 1) throw new PontoErro('O ponto mudou em outra sessão. Confira o registro e tente novamente.', 409);
    } else {
      await store.inserirTurno(ex, proximo);
    }
    return { status: 200, corpo: { shift: proximo } };
  });
}

module.exports = { lerAtual, comandar };
