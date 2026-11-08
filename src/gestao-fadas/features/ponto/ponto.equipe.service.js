'use strict';

/** Consultas da administradora: a equipe no dia (`team-day`) e os turnos de uma atendente em um período (`shifts`). Só leitura. */

const { operationalWindow } = require('../../_comum/dominio/operacao-calendario');
const { validStaffDate } = require('../../_comum/dominio/ponto-escala');
const { atendentes } = require('./ponto.identidade');
const { PontoErro } = require('./ponto.erro');
const store = require('./ponto.store');

async function equipeNoDia(req, relogio = Date.now) {
  const data = req.query.date;
  if (!validStaffDate(data)) throw new PontoErro('Informe uma data válida.', 400);
  const { startAt, endAt } = operationalWindow(data);
  const [pessoas, escalas, turnos, atividade] = await Promise.all([atendentes(), store.escalas(), store.turnosDoDia(data, startAt, endAt), store.atividadeDoDia(data, startAt, endAt, relogio())]);
  return { status: 200, corpo: { team: pessoas.map((p) => ({ accountId: p.id, roster: escalas.get(p.id), shifts: turnos.get(p.id) || [], activity: atividade.get(p.id) || null })) } };
}

async function turnos(req, idConta) {
  const de = req.query.from || ''; const ate = req.query.to || '';
  if (!validStaffDate(de) || !validStaffDate(ate) || ate < de || Date.parse(ate) - Date.parse(de) > 366 * 86400000) throw new PontoErro('Informe um período de até um ano.', 400);
  return { status: 200, corpo: { shifts: await store.turnosDoPeriodo(idConta, de, ate) } };
}

module.exports = { equipeNoDia, turnos };
