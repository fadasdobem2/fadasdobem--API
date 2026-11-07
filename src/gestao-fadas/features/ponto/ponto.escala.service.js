'use strict';

/**
 * A escala da atendente: a própria (`my-schedule`, só exceção de hoje ou data futura) e a organizada pela administradora (`schedule`).
 * Regras em `_comum/dominio/ponto-escala.js`. As duas usam a mesma revisão: conflito é 409 e pede recarga. Cada gravação deixa auditoria
 * na MESMA transação.
 */

const { randomUUID } = require('crypto');
const { AUDIT_INSERT, linhaDeAuditoria } = require('../../_comum/auditoria');
const { civilDateInSaoPaulo } = require('../../_comum/dominio/operacao-calendario');
const { validStaffDate, validStaffRoster, editStaffRoster } = require('../../_comum/dominio/ponto-escala');
const { emTransacao } = require('../../novo/escritor');
const { PontoErro } = require('./ponto.erro');
const store = require('./ponto.store');

const revisaoValida = (r) => typeof r === 'number' && Number.isSafeInteger(r) && r >= 0;
const CONFLITO = 'A escala foi alterada em outra sessão. Recarregue antes de salvar.';

async function gravar(pessoa, idConta, escala, revisao, acao) {
  return emTransacao(async (ex) => {
    if (!(await store.gravarEscala(ex, idConta, pessoa.id, escala, revisao))) throw new PontoErro(CONFLITO, 409);
    await ex.execute(AUDIT_INSERT, linhaDeAuditoria(
      { actorUserId: pessoa.id, actorRole: pessoa.role, action: acao, entity: 'ponto_escala', entityId: idConta, before: null, after: { revision: revisao + 1 } },
      { id: randomUUID(), agora: Date.now(), chave: `ponto:${randomUUID().replace(/-/g, '').slice(0, 40)}` },
    ));
    return { roster: escala, revision: revisao + 1 };
  });
}

/** `my-schedule`: GET lê; PUT recebe só `date`, `periods` (lista; vazia = folga; `null` = volta à habitual) e `revision`. */
async function propria(req, pessoa, relogio) {
  if (pessoa.role !== 'atendente') throw new PontoErro('Somente a atendente pode informar sua disponibilidade.', 403);
  if (Object.prototype.hasOwnProperty.call(req.query || {}, 'accountId')) throw new PontoErro('A escala pessoal usa a identidade da sessão.', 400);
  const hoje = civilDateInSaoPaulo(relogio());
  const atual = await store.escalaDe(pessoa.id);
  if (req.method === 'GET') return { status: 200, corpo: { ...atual, today: hoje } };
  if (req.method !== 'PUT') throw new PontoErro('Método não permitido.', 405);
  const { date, periods, revision } = req.body;
  if (Object.keys(req.body).some((k) => !['date', 'revision', 'periods'].includes(k)) || !validStaffDate(date) || date < hoje
    || (periods !== null && !Array.isArray(periods)) || !revisaoValida(revision) || revision < 0) throw new PontoErro('Informe a disponibilidade de hoje ou de uma data futura.', 400);
  if (atual.revision !== revision) throw new PontoErro('A escala mudou. Recarregue antes de salvar.', 409);
  let proxima;
  try { proxima = editStaffRoster(atual.roster || undefined, { kind: 'exception', date, periods }); } catch (e) { throw new PontoErro(e instanceof Error ? e.message : 'Confira os horários.', 400); }
  return { status: 200, corpo: { ...(await gravar(pessoa, pessoa.id, proxima, revision, 'ponto.escala.propria')), today: hoje } };
}

/** `schedule` (administradora): GET lê a escala de `idConta`; PUT recebe `roster` e `revision`. */
async function daAtendente(req, pessoa, idConta) {
  if (req.method === 'GET') return { status: 200, corpo: await store.escalaDe(idConta) };
  if (req.method === 'PUT') {
    const { roster, revision } = req.body;
    if (!revisaoValida(revision) || !validStaffRoster(roster)) throw new PontoErro('Revise os horários da escala.', 400);
    return { status: 200, corpo: await gravar(pessoa, idConta, roster, revision, 'ponto.escala.equipe') };
  }
  throw new PontoErro('Operação não permitida.', 405);
}

module.exports = { propria, daAtendente };
