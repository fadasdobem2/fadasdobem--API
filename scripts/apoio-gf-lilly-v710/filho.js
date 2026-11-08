'use strict';

/**
 * FILHO de scripts/verificar-gf-lilly-v710.js: roda contra o Postgres DESCARTÁVEL (fdb_lv710_*) já migrado. Prova pelo HTTP das rotas da Lilly (token de serviço
 * de teste) e do gate (agenda/consulta/presença, sessão de mentira) o contrato novo da Lilly v710: nameArticle no banco novo, revisão e cotações no contexto,
 * reserva/liberação, fechamento/continuação (flags desligadas por padrão), correção de posição. O legado MySQL é SIMULADO; nenhuma flag GF_LEGADO_* é ligada.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { raiz, conferir, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');
const { criarLegado } = require('../apoio-gf-lilly-contexto/legado-simulado');

Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_LILLY: 'true', GF_FATIA_RESTRICOES: 'true',
  GF_FATIA_AGENDA: 'true', GF_FATIA_CONSULTA: 'true', GF_FATIA_PRESENCA: 'true', GF_FATIA_HORARIOS: 'true', GF_FATIA_PRECOS: 'true', GF_FATIA_PAGAMENTOS: 'true', GF_FATIA_PAINEL: 'true',
  LILLY_SERVICE_TOKEN: 'token-de-teste-com-mais-de-24-caracteres', UMBLER_ORGANIZATION_ID: 'org-teste', LILLY_STAFF_AUTORIZADA: 'membro-autorizada', LILLY_UMBLER_MEMBER_IDS: 'lilly-membro',
});
for (const k of Object.keys(process.env)) if (k.startsWith('GF_LEGADO_')) delete process.env[k];
process.env.GF_LILLY_ACOES_ENABLED = 'true';
for (const k of ['GF_LILLY_FECHAR_CONSULTA_ENABLED', 'GF_LILLY_CONTINUACAO_ENABLED', 'GF_LILLY_CADASTRO_NOVO_ENABLED', 'GF_LILLY_CADASTRO_LEGADO_ENABLED']) delete process.env[k];
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarRotasLilly } = require(r('src/gestao-fadas/gate/rotas-lilly'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const { avulso } = require(r('src/gestao-fadas/features/lilly/dados/executor'));
  const vinculos = require(r('src/gestao-fadas/features/lilly/dados/vinculos.repo'));
  const eventos = require(r('src/gestao-fadas/features/lilly/dados/eventos.repo'));
  const { definirFontes } = require(r('src/gestao-fadas/features/lilly/contexto/fontes'));
  const { hojeOperacional } = require(r('src/gestao-fadas/_comum/dia-operacional'));
  const agendaServico = require(r('src/gestao-fadas/features/agenda/agenda.service'));
  const admissao = require(r('src/gestao-fadas/features/agenda/agenda-admissao.service'));
  const consultaServico = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.service'));
  const contextoFila = require(r('src/gestao-fadas/features/agenda/agenda-fila.contexto'));
  const tarologos = require(r('src/gestao-fadas/features/cadastros/tarologos.service'));
  const fin = require(r('src/gestao-fadas/features/financeiro-cliente/fin.contexto'));

  const existe = async (id) => id !== '999999';
  for (const s of [agendaServico, admissao, consultaServico, require(r('src/gestao-fadas/features/financeiro-cliente/pagamentos.service')), require(r('src/gestao-fadas/features/cadastros/clientes.service'))]) s.definirVerificadorDeCliente(existe);
  require(r('src/gestao-fadas/features/financeiro-cliente/restricoes.service')).definirVerificadorDeCliente(existe);
  agendaServico.definirLeitorDeRotulo(async (id) => `Cliente ${id}`);
  const CADASTRO = { osiris: { id: 'osiris', name: 'Osíris', registrationActive: true }, nyx: { id: 'nyx', name: 'Nyx', registrationActive: true }, livre: { id: 'livre', name: 'Livre', registrationActive: true } };
  contextoFila.definirFonteDeTarologo(async (id) => CADASTRO[id] || null);
  // Catálogo: legado simulado (ids numéricos 9001/9002) + extensão `gf_tarologos_ext` e perfis REAIS do banco novo.
  tarologos.definirFonteLegado({
    listar: async () => [{ idTarologo: 9001, nmuTarologo: 'Mara', ativo: 1, status: 1, meus_horarios: '', oraculos: [] }, { idTarologo: 9002, nmuTarologo: 'Osíris', ativo: 1, status: 1, meus_horarios: '', oraculos: [] }],
    obter: async () => null,
  });
  fin.definirLeitorDeHistorico(async () => new Map());
  fin.definirLeitorDePartida(async (ids) => new Map(ids.map((id) => [id, { centavos: 0, conhecido: true, nome: `Cliente ${id}` }])));
  const legado = criarLegado();
  const semLegado = { usuariosPorTelefone: async () => [], usuariosPorIds: async (ids) => legado.fontes.usuariosPorIds(ids), pagamentosLegado: async () => ({ informed: [], confirmed: [] }) };
  definirFontes({ ...legado.fontes, ...semLegado });
  require(r('src/gestao-fadas/features/lilly/executores/executores.dependencias')).definirDependencias({ clienteExiste: existe, lerCadastro: async () => ({ name: 'Cliente', treatAs: '' }) });

  const uAtend = await criarUsuario('Atendente V710');
  const uOsiris = await criarUsuario('Osiris V710');
  const uLivre = await criarUsuario('Livre V710');
  process.env.LILLY_SERVICE_USER_ID = await criarUsuario('Conta de Serviço Lilly');
  let sessao = { userId: uAtend, role: 'atendente', displayName: 'Khloe' };
  const como = (p) => { sessao = p === 'osiris' ? { userId: uOsiris, role: 'tarologa', displayName: 'Osíris', tarotId: 'osiris' } : p === 'livre' ? { userId: uLivre, role: 'tarologa', displayName: 'Livre', tarotId: 'livre' } : { userId: uAtend, role: 'atendente', displayName: 'Khloe' }; };

  const app = express();
  app.use('/api', criarRotasLilly());
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-v710' }) }, verificarLegado: async () => true }));
  const servidor = http.createServer(app);
  await new Promise((res) => servidor.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${servidor.address().port}/api`;
  const chamar = async (metodo, caminho, { corpo, chave } = {}) => {
    const resp = await fetch(`${base}${caminho}`, { method: metodo, headers: { Authorization: `Bearer ${process.env.LILLY_SERVICE_TOKEN}`, ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(chave ? { 'Idempotency-Key': chave } : {}) }, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) });
    const texto = await resp.text();
    let j = null; try { j = texto ? JSON.parse(texto) : null; } catch (_) { /* texto */ }
    return { status: resp.status, corpo: j, j, t: texto.slice(0, 300) };
  };
  const gate = async (metodo, p, corpo) => {
    const resp = await fetch(`${base}${p}`, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined || metodo === 'GET' ? undefined : JSON.stringify(corpo) });
    const t = await resp.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 300) };
  };
  const consulta = async (sql, valores) => (await sequelize.query(sql, { replacements: valores, logging: false }))[0];
  const contar = async (tabela, onde = 'TRUE', valores = {}) => Number((await consulta(`SELECT count(*) AS n FROM ${tabela} WHERE ${onde}`, valores))[0].n);
  let seq = 0;
  const n = () => `op-${Date.now()}-${(seq += 1)}`;
  const chave = (p = 'k') => `${p}-${Date.now()}-${(seq += 1)}:acao:chat-v`;
  const acao = (kind, extra = {}) => ({ kind, conversationId: 'chat-1', clientId: '900101', tarologistId: undefined, payload: {}, ...extra });
  const exec = (a, k) => chamar('POST', '/lilly/actions', { corpo: { action: a }, chave: k || chave() });
  const validar = (a) => chamar('POST', '/lilly/actions/validate', { corpo: { action: a } });
  const vincular = (clientId, conversationId) => vinculos.salvarVinculo(avulso, { clientId, contactId: `ct-${conversationId}`, conversationId, verified: true, active: true });
  const conciliar = (k) => chamar('GET', `/lilly/actions/${encodeURIComponent(k)}`);
  const evento = async (id, { conversationId = 'chat-1', clientId = null, staff = false, actor, internal, staffId = 'membro-autorizada' } = {}) => eventos.gravarEvento(avulso, {
    id, source: 'umbler', at: new Date().toISOString(), conversationId, contactId: `ct-${conversationId}`, messageId: `${id}-m`, actor: actor || (staff ? 'staff' : 'client'),
    internal: internal ?? staff, clientId, text: 'ok', data: staff ? { staffAuthorized: true, staffId } : {},
  });
  const contexto = async (event) => (await chamar('POST', '/lilly/context', { corpo: { event: { type: 'message', at: new Date().toISOString(), actor: 'client', internal: false, data: {}, ...event } } })).corpo;
  const hoje = hojeOperacional();
  const LILLY_DIR = process.env.LILLY_SERVER_DIR || '/Users/patrick.developer/Desktop/Developer/Projects/Nice/fadasdobemsuspiro/fadasdobemsuspiro/Nice-github/fadasdobem-site/server/lilly';
  /** Código REAL da Lilly (clone somente leitura): só para provar que o que a API entrega é aceito pelas funções dela. `null` se o clone não está disponível. */
  const lilly = async (arquivo) => { try { return await import(require('url').pathToFileURL(path.join(LILLY_DIR, arquivo)).href); } catch (_) { return null; } };
  const presenca = async (tarot, perfil) => { como(perfil); const x = await gate('POST', `/presence/${tarot}/confirm`, { operationKey: n(), expectedRevision: '0' }); como('atendente'); return x; };
  const criarNaFila = (id, clientId, extra = {}) => gate('POST', '/agenda', { operationKey: n(), id, tarotId: 'afila', clientId, client: `Cliente ${clientId}`, date: hoje,
    set: { channel: 'WhatsApp', observation: 'Sem observações.', response: 'Aguardando resposta', contact: { attempt: 1, date: hoje, tags: ['Avisada'] }, workflowStatus: 'Avisada' },
    append: { contactHistory: [{ id: `${id}-av`, actor: 'x', at: '2000-01-01T00:00:00.000Z', date: hoje, attempt: 1, tag: 'Avisada', active: true, before: [], after: ['Avisada'] }] }, ...extra });
  const criarNaFilaDe = (id, tarotId, clientId, extra = {}) => gate('POST', '/agenda', { operationKey: n(), id, tarotId, clientId, client: `Cliente ${clientId}`, date: hoje, set: { channel: 'WhatsApp', observation: 'Sem observações.', response: 'Aguardando resposta' }, ...extra });
  const estavel = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
  const ctx = {
    r, sequelize, avulso, chamar, gate, como, consulta, contar, acao, exec, validar, conciliar, vincular, evento, contexto, conferir, passo, hoje, chave, n, estavel, igual: (a, b) => estavel(a) === estavel(b),
    LILLY_DIR, lilly, presenca, criarNaFila, criarNaFilaDe, CADASTRO, tarologos, fin, definirFontes, legado, uAtend, uOsiris, uLivre,
  };

  const mudo = console.error; console.error = () => {}; console.warn = () => {}; console.info = () => {};
  try {
    for (const caso of ['casos-nome-artigo', 'casos-contexto', 'casos-reserva', 'casos-posicao', 'casos-consulta', 'casos-mutantes']) await require(`./${caso}`)(ctx);
  } catch (e) {
    console.error = mudo; console.log(`  FALHOU  inesperado: ${e.stack}`); resumo().falhas.push('inesperado');
  }
  console.error = mudo;
  conferir('nenhuma flag GF_LEGADO_* ligada durante toda a verificação (nada no MySQL legado)', Object.keys(process.env).filter((k) => k.startsWith('GF_LEGADO_') && process.env[k] === 'true').length === 0);
  servidor.close();
  await sequelize.close();
  const { ok, falhas } = resumo();
  console.log(`\n${ok} verificações passaram, ${falhas.length} falharam.`);
  process.exit(falhas.length ? 1 : 0);
})();
