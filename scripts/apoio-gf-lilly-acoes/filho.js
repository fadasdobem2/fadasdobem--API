'use strict';

/**
 * FILHO de scripts/verificar-gf-lilly-acoes.js: roda contra o Postgres DESCARTÁVEL (fdb_lillya_*) já migrado. Prova pelo HTTP das rotas da
 * Lilly (token de serviço de teste) cada executor: caminho feliz, repetição idempotente, corpo diferente (409), flag desligada (403),
 * validate recusando e as regras de cada kind. O legado MySQL é SIMULADO (existência de cliente, nome, catálogo de tarólogos trocados por
 * funções de teste); nenhuma flag GF_LEGADO_* é ligada. Nenhum dado real.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { raiz, conferir, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GF_FATIA_LILLY: 'true', GF_FATIA_RESTRICOES: 'true',
  LILLY_SERVICE_TOKEN: 'token-de-teste-com-mais-de-24-caracteres', UMBLER_ORGANIZATION_ID: 'org-teste', LILLY_STAFF_AUTORIZADA: 'membro-autorizada,outra-autorizada',
});
for (const k of Object.keys(process.env)) if (k.startsWith('GF_LEGADO_')) delete process.env[k];
delete process.env.GF_LILLY_ACOES_ENABLED; delete process.env.GF_LILLY_CADASTRO_LEGADO_ENABLED;
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarRotasLilly } = require(r('src/gestao-fadas/gate/rotas-lilly'));
  const { avulso } = require(r('src/gestao-fadas/features/lilly/dados/executor'));
  const vinculos = require(r('src/gestao-fadas/features/lilly/dados/vinculos.repo'));
  const eventos = require(r('src/gestao-fadas/features/lilly/dados/eventos.repo'));
  const { hojeOperacional } = require(r('src/gestao-fadas/_comum/dia-operacional'));
  // O legado não está configurado neste processo: existência, rótulo, tratar-por e catálogo de tarólogos são funções de teste.
  const CLIENTES = new Set(['900101', '900102', '900111', '900112', '900113', '900114', '900115', '900116', '900121']);
  const existe = async (id) => CLIENTES.has(`${id}`);
  require(r('src/gestao-fadas/features/agenda/agenda.service')).definirVerificadorDeCliente(existe);
  require(r('src/gestao-fadas/features/agenda/agenda.service')).definirLeitorDeRotulo(async (id) => (CLIENTES.has(`${id}`) ? `Cliente ${id}` : null));
  require(r('src/gestao-fadas/features/financeiro-cliente/pagamentos.service')).definirVerificadorDeCliente(existe);
  require(r('src/gestao-fadas/features/cadastros/clientes.service')).definirVerificadorDeCliente(existe);
  require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.service')).definirVerificadorDeCliente(existe);
  const CADASTRO = { osiris: { id: 'osiris', name: 'Osíris', registrationActive: true }, nyx: { id: 'nyx', name: 'Nyx', registrationActive: true }, estrela: { id: 'estrela', name: 'Estrela', registrationActive: false } };
  require(r('src/gestao-fadas/features/agenda/agenda-fila.contexto')).definirFonteDeTarologo(async (id) => CADASTRO[id] || null);
  const legadoTratarPor = {};
  require(r('src/gestao-fadas/features/lilly/executores/executores.dependencias')).definirDependencias({
    clienteExiste: existe, lerCadastro: async (id) => (CLIENTES.has(`${id}`) ? { name: '', treatAs: legadoTratarPor[id] || '' } : null),
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
  const validar = (a, extra = {}) => chamar('POST', '/lilly/actions/validate', { corpo: { action: a, ...extra } });
  let seq = 0;
  const vincular = (clientId, conversationId, contactId = `ct-${conversationId}`) => vinculos.salvarVinculo(avulso, { clientId, contactId, conversationId, verified: true, active: true });
  const autorizar = async (idEvento, { conversationId = 'chat-1', clientId = '900101', staff = true, extra = {} } = {}) => eventos.gravarEvento(avulso, {
    id: idEvento, source: 'umbler', at: new Date().toISOString(), conversationId, contactId: `ct-${conversationId}`, messageId: `${idEvento}-m`, actor: staff ? 'staff' : 'client',
    internal: staff, clientId, text: 'ok', data: staff ? { staffAuthorized: true, staffId: 'membro-autorizada', ...extra } : { ...extra },
  });
  const estavel = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
  const ctx = {
    igual: (a, b) => estavel(a) === estavel(b),
    r, sequelize, avulso, chamar, consulta, contar, acao, exec, validar, vincular, autorizar, conferir, passo, hojeOperacional, legadoTratarPor,
    chave: (p = 'k') => `${p}-${Date.now()}-${(seq += 1)}:acao:chat-1`, HOJE: hojeOperacional(),
  };

  const mudo = console.error; console.error = () => {}; console.warn = () => {};
  try {
    for (const caso of ['casos-validacao', 'casos-cadastro', 'casos-pagamento', 'casos-agenda', 'casos-consulta']) await require(`./${caso}`)(ctx);
  } catch (e) {
    console.error = mudo; console.log(`  FALHOU  inesperado: ${e.stack}`); resumo().falhas.push('inesperado');
  }
  console.error = mudo;
  const efeitosNoLegado = Object.keys(process.env).filter((k) => k.startsWith('GF_LEGADO_') && process.env[k] === 'true');
  conferir('nenhuma flag GF_LEGADO_* ligada durante toda a verificação', efeitosNoLegado.length === 0);
  servidor.close();
  await sequelize.close();
  const { ok, falhas } = resumo();
  console.log(`\n${ok} verificações passaram, ${falhas.length} falharam.`);
  process.exit(falhas.length ? 1 : 0);
})();
