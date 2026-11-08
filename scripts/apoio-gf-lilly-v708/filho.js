'use strict';

/**
 * FILHO de scripts/verificar-gf-lilly-v708.js: roda contra o Postgres DESCARTÁVEL (fdb_lillyv_*) já migrado. Prova pelo HTTP das rotas da Lilly
 * (token de serviço de teste) o contrato novo da Lilly v708/v709 da Nice: cadastro de quem pagou sem dados (banco NOVO, nunca o legado), pagamento
 * automático com unicidade global, pedido de mais tempo, conversa interna da equipe (`team_reply`) e retorno R no contexto. O legado MySQL é SIMULADO;
 * nenhuma flag GF_LEGADO_* é ligada. Termina com MUTANTES: versões quebradas de cada regra que as verificações acima têm de reprovar.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { raiz, conferir, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');
const { criarLegado } = require('../apoio-gf-lilly-contexto/legado-simulado');

Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GF_FATIA_LILLY: 'true', GF_FATIA_RESTRICOES: 'true',
  LILLY_SERVICE_TOKEN: 'token-de-teste-com-mais-de-24-caracteres', UMBLER_ORGANIZATION_ID: 'org-teste', LILLY_STAFF_AUTORIZADA: 'membro-autorizada,outra-autorizada',
  LILLY_UMBLER_MEMBER_IDS: 'lilly-membro',
});
for (const k of Object.keys(process.env)) if (k.startsWith('GF_LEGADO_')) delete process.env[k];
process.env.GF_LILLY_ACOES_ENABLED = 'true'; // as ações da Lilly (efeito) são opt-in
for (const k of ['GF_LILLY_CADASTRO_LEGADO_ENABLED', 'GF_LILLY_CADASTRO_NOVO_ENABLED', 'GF_LILLY_CADASTRO_EXIGE_APROVACAO', 'GF_LILLY_RETORNO_METRICAS_ENABLED', 'LILLY_STAFF_TODOS_AUTORIZAM', 'LILLY_CLIENT_PROFILE_BASE_URL']) delete process.env[k];
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarRotasLilly } = require(r('src/gestao-fadas/gate/rotas-lilly'));
  const { avulso } = require(r('src/gestao-fadas/features/lilly/dados/executor'));
  const vinculos = require(r('src/gestao-fadas/features/lilly/dados/vinculos.repo'));
  const eventos = require(r('src/gestao-fadas/features/lilly/dados/eventos.repo'));
  const controller = require(r('src/gestao-fadas/features/lilly/lilly.controller'));
  const novo = require(r('src/gestao-fadas/features/clientes/cliente-novo'));
  const { hojeOperacional } = require(r('src/gestao-fadas/_comum/dia-operacional'));
  const { definirFontes } = require(r('src/gestao-fadas/features/lilly/contexto/fontes'));
  const servico = require(r('src/gestao-fadas/features/lilly/contexto/contexto.servico'));

  // O legado não está configurado neste processo: existência, rótulo, tratar-por, telefone e catálogo de tarólogos são funções de teste. Clientes da
  // faixa NOVA (>= 1.000.000.000) seguem o caminho REAL (banco novo).
  const CLIENTES = new Set(['900101', '900102']);
  const legado = criarLegado();
  const existe = async (id) => (novo.ehIdDaFaixaNova(`${id}`) ? novo.clienteNovoExiste(id) : CLIENTES.has(`${id}`));
  require(r('src/gestao-fadas/features/agenda/agenda.service')).definirVerificadorDeCliente(existe);
  require(r('src/gestao-fadas/features/agenda/agenda.service')).definirLeitorDeRotulo(async (id) => (novo.ehIdDaFaixaNova(`${id}`) ? ((await novo.lerCadastroNovo(id)) || {}).name || null : CLIENTES.has(`${id}`) ? `Cliente ${id}` : null));
  require(r('src/gestao-fadas/features/financeiro-cliente/pagamentos.service')).definirVerificadorDeCliente(existe);
  require(r('src/gestao-fadas/features/cadastros/clientes.service')).definirVerificadorDeCliente(existe);
  require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.service')).definirVerificadorDeCliente(existe);
  const CADASTRO = { osiris: { id: 'osiris', name: 'Osíris', registrationActive: true }, nyx: { id: 'nyx', name: 'Nyx', registrationActive: true }, luz: { id: 'luz', name: 'Luz', registrationActive: true }, estrela: { id: 'estrela', name: 'Estrela', registrationActive: false } };
  require(r('src/gestao-fadas/features/agenda/agenda-fila.contexto')).definirFonteDeTarologo(async (id) => CADASTRO[id] || null);
  const semLegado = { usuariosPorTelefone: async () => [], usuariosPorIds: async (ids) => legado.fontes.usuariosPorIds(ids), pagamentosLegado: async () => ({ informed: [], confirmed: [] }) };
  definirFontes({ ...legado.fontes, ...semLegado });
  require(r('src/gestao-fadas/features/lilly/executores/executores.dependencias')).definirDependencias({
    clienteExiste: existe, lerCadastro: async (id) => (novo.ehIdDaFaixaNova(`${id}`) ? novo.lerCadastroNovo(id) : CLIENTES.has(`${id}`) ? { name: '', treatAs: '' } : null),
  });
  process.env.LILLY_SERVICE_USER_ID = await criarUsuario('Conta de Serviço Lilly');

  const app = express();
  app.use('/api', criarRotasLilly());
  const servidor = http.createServer(app);
  await new Promise((res) => servidor.listen(0, '127.0.0.1', res));
  const chamar = async (metodo, caminho, { corpo, chave } = {}) => {
    const resp = await fetch(`http://127.0.0.1:${servidor.address().port}/api${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${process.env.LILLY_SERVICE_TOKEN}`, ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(chave ? { 'Idempotency-Key': chave } : {}) },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    });
    const texto = await resp.text();
    return { status: resp.status, corpo: texto ? JSON.parse(texto) : null };
  };
  const consulta = async (sql, valores) => (await sequelize.query(sql, { replacements: valores, logging: false }))[0];
  const contar = async (tabela, onde = 'TRUE', valores = {}) => Number((await consulta(`SELECT count(*) AS n FROM ${tabela} WHERE ${onde}`, valores))[0].n);
  const acao = (kind, extra = {}) => ({ kind, conversationId: 'chat-1', clientId: '900101', tarologistId: undefined, payload: {}, ...extra });
  const exec = (a, chave) => chamar('POST', '/lilly/actions', { corpo: { action: a }, chave });
  const validar = (a) => chamar('POST', '/lilly/actions/validate', { corpo: { action: a } });
  const conciliar = (chave) => chamar('GET', `/lilly/actions/${encodeURIComponent(chave)}`);
  let seq = 0;
  const chave = (p = 'k') => `${p}-${Date.now()}-${(seq += 1)}:acao:chat-v`;
  const vincular = (clientId, conversationId, contactId = `ct-${conversationId}`) => vinculos.salvarVinculo(avulso, { clientId, contactId, conversationId, verified: true, active: true });
  /** Evento JÁ resolvido pelo Gestão (a "prova"). `staff:true` = nota privada de atendente autorizada. */
  const evento = async (id, { conversationId = 'chat-1', contactId, clientId = null, staff = false, actor, extra = {} } = {}) => eventos.gravarEvento(avulso, {
    id, source: 'umbler', at: new Date().toISOString(), conversationId, contactId: contactId || `ct-${conversationId}`, messageId: `${id}-m`, actor: actor || (staff ? 'staff' : 'client'),
    internal: staff, clientId, text: 'ok', data: staff ? { staffAuthorized: true, staffId: 'membro-autorizada', ...extra } : { ...extra },
  });
  const estavel = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
  const ctx = {
    igual: (a, b) => estavel(a) === estavel(b), r, sequelize, avulso, chamar, consulta, contar, acao, exec, validar, conciliar, vincular, evento, conferir, passo, hojeOperacional,
    chave, novo, controller, servico, definirFontes, legado, CLIENTES, vinculos, eventos, IDS: {},
  };

  const mudo = console.error; console.error = () => {}; console.warn = () => {}; console.info = () => {};
  try {
    for (const caso of ['casos-esquema', 'casos-cadastro', 'casos-cadastro-dados', 'casos-pagamento', 'casos-mais-tempo', 'casos-equipe', 'casos-retorno', 'casos-paridade', 'casos-mutantes']) await require(`./${caso}`)(ctx);
  } catch (e) {
    console.error = mudo; console.log(`  FALHOU  inesperado: ${e.stack}`); resumo().falhas.push('inesperado');
  }
  console.error = mudo;
  const efeitosNoLegado = Object.keys(process.env).filter((k) => k.startsWith('GF_LEGADO_') && process.env[k] === 'true');
  conferir('nenhuma flag GF_LEGADO_* ligada durante toda a verificação (nada no MySQL legado)', efeitosNoLegado.length === 0);
  servidor.close();
  await sequelize.close();
  const { ok, falhas } = resumo();
  console.log(`\n${ok} verificações passaram, ${falhas.length} falharam.`);
  process.exit(falhas.length ? 1 : 0);
})();
