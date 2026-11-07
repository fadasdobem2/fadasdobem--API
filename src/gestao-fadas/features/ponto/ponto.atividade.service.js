'use strict';

/**
 * Diário de ações confirmadas do Gestão por atendente (`resource=ingest` e `resource=activity`). Quem escreve é um SERVIDOR com token
 * (`STAFF_ACTIVITY_INGEST_TOKEN`, 32+ caracteres), nunca o navegador: sem cookie, sem origem, sem sessão. O ID do evento é estável: repetir os
 * mesmos dados devolve 200, outro conteúdo com o mesmo ID é 409. Só entram fatos de negócio (nada de página visitada, histórico, presença ou sessão).
 * A leitura devolve o que foi recebido (cobertura `confirmed-events-received`); a fonte externa por URL (`STAFF_ACTIVITY_URL`) ainda não está ligada.
 */

const { createHash, timingSafeEqual } = require('crypto');
const { emTransacao } = require('../../novo/escritor');
const { PontoErro } = require('./ponto.erro');
const store = require('./ponto.store');

const CATEGORIAS = ['agenda', 'cliente', 'consulta', 'mais-tempo', 'pagamento', 'profissional', 'recado'];
const CAMPOS_TEXTO = ['actorName', 'clientId', 'clientName', 'tarotId', 'tarotName', 'sourceEventId', 'commandId'];
const CODIGO = /^[a-z][a-z0-9_.]{1,119}$/;
const FORA_DO_TRABALHO = /^(?:page|history|presence|session|navigation)\./;
const FUTURO_TOLERADO_MS = 300_000;

/** `auditValueKey`: JSON com chaves em ordem estável e sem campos indefinidos (mesmo conteúdo = mesma chave). */
function chaveDoValor(valor) {
  const limpar = (v) => (Array.isArray(v) ? v.map(limpar)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, limpar(x)])) : v);
  return JSON.stringify(limpar(valor)) ?? '';
}

/** Instante ISO exato com milissegundos (`2026-11-06T14:00:00.000Z`), como o front grava. */
function instante(valor) {
  const em = Date.parse(valor);
  return Number.isFinite(em) && new Date(em).toISOString() === valor ? em : NaN;
}

const digest = (t) => createHash('sha256').update(t, 'utf8').digest();

/** Credencial de servidor: sem cookie nem origem de navegador e com o Bearer certo (comparação em tempo constante). */
function autorizarRecepcao(req, token) {
  if (!token || token.length < 32) throw new PontoErro('Recepção de eventos não configurada.', 503);
  const auth = req.headers.authorization || '';
  if (req.headers.origin || req.headers['sec-fetch-site'] || req.headers.cookie || !auth.startsWith('Bearer ')) throw new PontoErro('Credencial de integração obrigatória.', 403);
  if (!timingSafeEqual(digest(token), digest(auth.slice(7)))) throw new PontoErro('Credencial de integração inválida.', 403);
}

function validarEvento(e, atendentes, agora) {
  const ator = atendentes.find((p) => p.id === e.actorId);
  const valido = e && typeof e === 'object' && typeof e.id === 'string' && CATEGORIAS.includes(e.category) && typeof e.action === 'string' && typeof e.recordId === 'string'
    && typeof e.detail === 'string' && ['captured', 'existing'].includes(e.origin) && (e.at === undefined || Number.isFinite(Date.parse(e.at)));
  if (!valido || !ator || e.actorKind !== 'person' || !Number.isFinite(instante(e.at ?? '')) || Date.parse(e.at) > agora + FUTURO_TOLERADO_MS
    || !e.id.trim() || e.id.length > 300 || !e.recordId.trim() || e.recordId.length > 300 || !e.action.trim() || e.action.length > 200
    || e.detail.length > 4000 || !e.actionCode || typeof e.actionCode !== 'string' || !CODIGO.test(e.actionCode) || FORA_DO_TRABALHO.test(e.actionCode)) {
    throw new PontoErro('Informe uma ação operacional com ID, autoria e horário confirmados.', 400);
  }
  // Só referências de negócio: nada de cabeçalho, sessão, tela ou corpo bruto de integração.
  const evento = { id: e.id, category: e.category, action: e.action, actionCode: e.actionCode, actorId: ator.id, actorKind: 'person', at: e.at, recordId: e.recordId, detail: e.detail, origin: e.origin };
  for (const campo of CAMPOS_TEXTO) {
    if (e[campo] === undefined) continue;
    if (typeof e[campo] !== 'string' || e[campo].length > 300) throw new PontoErro('Referência de atividade inválida.', 400);
    evento[campo] = e[campo];
  }
  return evento;
}

async function receber(req, token, atendentes, agora) {
  autorizarRecepcao(req, token);
  const bruto = req.body && req.body.event;
  const evento = validarEvento(bruto, atendentes, agora);
  const conteudo = chaveDoValor(evento);
  return emTransacao(async (ex) => {
    const [r] = await ex.execute(
      'INSERT INTO gf_ponto_eventos (id, id_conta, ocorreu_em, recebido_em, conteudo) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
      [evento.id, evento.actorId, evento.at, new Date(agora).toISOString(), conteudo],
    );
    if (r.affectedRows === 1) return { status: 201, corpo: { id: evento.id, created: true } };
    const [linhas] = await ex.execute('SELECT conteudo FROM gf_ponto_eventos WHERE id = ?', [evento.id]);
    if (chaveDoValor(store.json(linhas[0].conteudo)) !== conteudo) throw new PontoErro('Já existe um evento diferente com este ID.', 409);
    return { status: 200, corpo: { id: evento.id, created: false } };
  });
}

async function ler(req, idConta, token) {
  const de = req.query.from || ''; const ate = req.query.to || '';
  const primeiro = instante(de); const ultimo = instante(ate);
  if (!Number.isFinite(primeiro) || !Number.isFinite(ultimo) || ultimo < primeiro || ultimo - primeiro > 366 * 86400000) throw new PontoErro('Informe um período válido de até um ano.', 400);
  // Desligar ou girar o token de recepção não esconde o que já foi aceito.
  const recepcao = Boolean(token && token.length >= 32);
  const [haRegistro] = recepcao ? [true] : await store.ler('SELECT id FROM gf_ponto_eventos LIMIT 1', {});
  if (!haRegistro) throw new PontoErro('A fonte de atividades confirmadas do Gestão ainda não está conectada.', 503);
  const linhas = await store.ler(
    'SELECT conteudo FROM gf_ponto_eventos WHERE id_conta = :c AND ocorreu_em BETWEEN :de::timestamptz AND :ate::timestamptz ORDER BY ocorreu_em, id LIMIT 5001',
    { c: idConta, de, ate },
  );
  if (linhas.length > 5000) throw new PontoErro('Reduza o período para consultar todas as atividades.', 422);
  return { status: 200, corpo: { events: linhas.map((l) => store.json(l.conteudo)), coverage: 'confirmed-events-received' } };
}

module.exports = { receber, ler, chaveDoValor, instante };
