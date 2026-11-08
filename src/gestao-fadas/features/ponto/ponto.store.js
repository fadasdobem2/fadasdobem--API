'use strict';

/**
 * Acesso ao banco novo da fatia Ponto e escala (pacote da Nice, docs/banco/17_Ponto_Escala_Atividade_v702.md). Escrita: SQL no executor do banco novo (`novo/escritor.js`, só INSERT/UPDATE/SELECT em
 * gf_*, sem DELETE). Leitura: SELECT direto no Postgres da A (funciona com a escrita desligada). `conteudo` é o JSON que o front lê.
 */

const { QueryTypes } = require('sequelize');

const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const sequelize = () => require('../../../config/database').sequelize;
const ler = (sql, replacements) => sequelize().query(sql, { type: QueryTypes.SELECT, replacements });

const ULTIMO = 'SELECT id, conteudo, revisao FROM gf_ponto_turnos WHERE id_conta = ? ORDER BY iniciado_em DESC, criado_em DESC LIMIT 1';

/** Último turno da conta, só leitura. */
async function turnoAtual(idConta) {
  const [l] = await ler('SELECT conteudo FROM gf_ponto_turnos WHERE id_conta = :c ORDER BY iniciado_em DESC, criado_em DESC LIMIT 1', { c: idConta });
  return l ? json(l.conteudo) : null;
}

/** Dentro da transação: uma gravação por conta de cada vez e o último turno travado. */
async function turnoParaGravar(ex, idConta) {
  await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_ponto:${idConta}`]);
  const [linhas] = await ex.execute(`${ULTIMO} FOR UPDATE`, [idConta]);
  return linhas[0] ? { id: linhas[0].id, turno: json(linhas[0].conteudo), revisao: Number(linhas[0].revisao) } : null;
}

const fimDe = (t) => t.endedAt || t.lastSeenAt;

function inserirTurno(ex, turno) {
  return ex.execute(
    'INSERT INTO gf_ponto_turnos (id, id_conta, data_operacional, iniciado_em, ultimo_em, conteudo, revisao) VALUES (?, ?, ?, ?, ?, ?, 1)',
    [turno.id, turno.accountId, turno.operationalDate, turno.startedAt, fimDe(turno), JSON.stringify(turno)],
  );
}

function atualizarTurno(ex, linha, turno) {
  return ex.execute(
    'UPDATE gf_ponto_turnos SET conteudo = ?, ultimo_em = ?, revisao = revisao + 1, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND id_conta = ? AND revisao = ?',
    [JSON.stringify(turno), fimDe(turno), linha.id, turno.accountId, linha.revisao],
  );
}

async function turnosDoPeriodo(idConta, de, ate) {
  const l = await ler('SELECT conteudo FROM gf_ponto_turnos WHERE id_conta = :c AND data_operacional BETWEEN :de AND :ate ORDER BY iniciado_em, criado_em', { c: idConta, de, ate });
  return l.map((x) => json(x.conteudo));
}

/** Turnos que tocam o dia Fadas (começaram antes do fim da janela e acabaram depois do início), agrupados por conta. */
async function turnosDoDia(data, inicio, fim) {
  const l = await ler(
    'SELECT id_conta, conteudo FROM gf_ponto_turnos WHERE iniciado_em < :fim AND (data_operacional = :data OR ultimo_em >= :inicio) ORDER BY iniciado_em, id',
    { fim, data, inicio },
  );
  const porConta = new Map();
  for (const x of l) porConta.set(x.id_conta, [...(porConta.get(x.id_conta) || []), json(x.conteudo)]);
  return porConta;
}

/**
 * Presença INFORMADA x DETECTADA (v711): o que o diário de ações confirmadas prova do trabalho no dia operacional (primeira e última ação, quantas),
 * lido do diário que só acrescenta (nenhuma segunda gravação pode perder ou duplicar presença). Só entram ações até `agora`.
 * Devolve `Map(idConta -> { operationalDate, firstActivityAt, lastActivityAt, activityCount })`; `idConta` opcional restringe a uma conta.
 */
async function atividadeDoDia(data, inicio, fim, agora, idConta) {
  const l = await ler(
    `SELECT id_conta, MIN(ocorreu_em) AS primeira, MAX(ocorreu_em) AS ultima, COUNT(*) AS total FROM gf_ponto_eventos
     WHERE ocorreu_em >= :inicio::timestamptz AND ocorreu_em < :fim::timestamptz AND ocorreu_em <= :agora::timestamptz${idConta ? ' AND id_conta = :conta' : ''} GROUP BY id_conta`,
    { inicio, fim, agora: new Date(agora).toISOString(), conta: idConta || null },
  );
  return new Map(l.map((x) => [x.id_conta, { operationalDate: data, firstActivityAt: new Date(x.primeira).toISOString(), lastActivityAt: new Date(x.ultima).toISOString(), activityCount: Number(x.total) }]));
}

async function escalaDe(idConta) {
  const [l] = await ler('SELECT conteudo, revisao FROM gf_ponto_escalas WHERE id_conta = :c', { c: idConta });
  return { roster: l ? json(l.conteudo) : null, revision: l ? Number(l.revisao) : 0 };
}

async function escalas() {
  const l = await ler('SELECT id_conta, conteudo FROM gf_ponto_escalas', {});
  return new Map(l.map((x) => [x.id_conta, json(x.conteudo)]));
}

/** `revisao` 0 insere (corrida perde sem erro); senão só atualiza se a revisão ainda for a lida. Devolve se gravou. */
async function gravarEscala(ex, idConta, autor, escala, revisao) {
  await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_ponto_escala:${idConta}`]);
  const [r] = revisao === 0
    ? await ex.execute('INSERT INTO gf_ponto_escalas (id_conta, conteudo, revisao, atualizado_por) VALUES (?, ?, 1, ?) ON CONFLICT (id_conta) DO NOTHING', [idConta, JSON.stringify(escala), autor])
    : await ex.execute('UPDATE gf_ponto_escalas SET conteudo = ?, revisao = revisao + 1, atualizado_por = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id_conta = ? AND revisao = ?', [JSON.stringify(escala), autor, idConta, revisao]);
  return r.affectedRows === 1;
}

module.exports = { json, ler, turnoAtual, turnoParaGravar, inserirTurno, atualizarTurno, turnosDoPeriodo, turnosDoDia, atividadeDoDia, escalaDe, escalas, gravarEscala };
