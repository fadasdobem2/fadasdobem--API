'use strict';

/**
 * Ambiente da integração: variáveis de teste, legado SIMULADO (clientes, tarólogos, histórico), banco semeado, Express local com o router REAL da
 * Lilly e o FadasAdapter REAL da Nice apontado para ele. O adaptador exige https (httpsBase); o `fetchImpl` injetado (padrão aceito pelo
 * construtor) só reescreve o host para http://127.0.0.1:porta, sem tocar no código dela.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { pathToFileURL } = require('url');
const { raiz, criarUsuario } = require('../apoio-gf-banco-novo/comum');
const { criarLegado } = require('../apoio-gf-lilly-contexto/legado-simulado');
const { semear, AGORA } = require('../apoio-gf-lilly-contexto/semear');

const TOKEN = 'token-de-teste-com-mais-de-24-caracteres';
const BASE_FALSA = 'https://gestao-fadas.teste.local/api';
const LILLY_DIR = process.env.LILLY_SERVER_DIR || '/Users/patrick.developer/Desktop/Developer/Projects/Nice/fadasdobemsuspiro/fadasdobemsuspiro/Nice-github/fadasdobem-site/server/lilly';

Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GF_FATIA_LILLY: 'true', GF_FATIA_RESTRICOES: 'true',
  LILLY_SERVICE_TOKEN: TOKEN, UMBLER_ORGANIZATION_ID: 'org-teste', LILLY_STAFF_AUTORIZADA: 'membro-autorizada,outra-autorizada',
});
for (const k of Object.keys(process.env)) if (k.startsWith('GF_LEGADO_')) delete process.env[k];
delete process.env.GF_LILLY_ACOES_ENABLED; delete process.env.GF_LILLY_CADASTRO_LEGADO_ENABLED; delete process.env.LILLY_CLIENT_PROFILE_BASE_URL;

const r = (p) => path.join(raiz, p);
const importar = (arq) => import(pathToFileURL(path.join(LILLY_DIR, arq)).href);

async function criarAmbiente() {
  if (!fs.existsSync(path.join(LILLY_DIR, 'adapters.mjs'))) throw new Error(`Código da Lilly não encontrado em ${LILLY_DIR} (defina LILLY_SERVER_DIR).`);
  const { sequelize } = require(r('src/config/database'));
  const { criarRotasLilly } = require(r('src/gestao-fadas/gate/rotas-lilly'));
  const { avulso } = require(r('src/gestao-fadas/features/lilly/dados/executor'));
  const controller = require(r('src/gestao-fadas/features/lilly/lilly.controller'));
  const { definirFontes } = require(r('src/gestao-fadas/features/lilly/contexto/fontes'));
  const tarologos = require(r('src/gestao-fadas/features/cadastros/tarologos.service'));
  const fin = require(r('src/gestao-fadas/features/financeiro-cliente/fin.contexto'));

  const legado = criarLegado();
  const CLIENTES = new Set(legado.usuarios.map((u) => `${u.id}`));
  const existe = async (id) => CLIENTES.has(`${id}`);
  tarologos.definirFonteLegado({
    listar: async () => [
      { idTarologo: 9001, nmuTarologo: 'Mara', ativo: 1, status: 1, meus_horarios: '', oraculos: [] },
      { idTarologo: 9002, nmuTarologo: 'Luz', ativo: 1, status: 1, meus_horarios: '', oraculos: [] },
      { idTarologo: 9003, nmuTarologo: 'Inativa', ativo: 0, status: 1, meus_horarios: '', oraculos: [] },
    ],
    obter: async () => null,
  });
  fin.definirLeitorDeHistorico(async () => new Map());
  definirFontes({ ...legado.fontes });
  const agenda = require(r('src/gestao-fadas/features/agenda/agenda.service'));
  agenda.definirVerificadorDeCliente(existe);
  agenda.definirLeitorDeRotulo(async (id) => (CLIENTES.has(`${id}`) ? `Cliente ${id}` : null));
  require(r('src/gestao-fadas/features/financeiro-cliente/pagamentos.service')).definirVerificadorDeCliente(existe);
  require(r('src/gestao-fadas/features/cadastros/clientes.service')).definirVerificadorDeCliente(existe);
  require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.service')).definirVerificadorDeCliente(existe);
  const CADASTRO = { 9001: { id: '9001', name: 'Mara', registrationActive: true }, 9002: { id: '9002', name: 'Luz', registrationActive: true }, 9003: { id: '9003', name: 'Inativa', registrationActive: false } };
  require(r('src/gestao-fadas/features/agenda/agenda-fila.contexto')).definirFonteDeTarologo(async (id) => CADASTRO[id] || null);
  const legadoTratarPor = {};
  require(r('src/gestao-fadas/features/lilly/executores/executores.dependencias')).definirDependencias({
    clienteExiste: existe, lerCadastro: async (id) => (CLIENTES.has(`${id}`) ? { name: '', treatAs: legadoTratarPor[id] || '' } : null),
  });
  process.env.LILLY_SERVICE_USER_ID = await criarUsuario('Conta de Serviço Lilly');
  await semear({ sequelize, r, avulso });

  // Umbler FALSA do lado da API (leitor injetado no resolver): o que ela "diz" é a verdade; o corpo do webhook é só gatilho.
  const umbler = { conversa: null, mensagem: null, falha: null };
  controller.definirDependencias({
    leitor: {
      async lerConversa() { if (umbler.falha) throw umbler.falha; return umbler.conversa; },
      async lerMensagem() { if (umbler.falha) throw umbler.falha; return umbler.mensagem; },
    },
  });

  const app = express();
  app.use('/api', criarRotasLilly());
  const servidor = http.createServer(app);
  await new Promise((res) => servidor.listen(0, '127.0.0.1', res));
  const porta = servidor.address().port;
  const chamadas = [];
  const fetchImpl = (url, opts) => {
    chamadas.push({ url, metodo: opts.method, chave: opts.headers && opts.headers['Idempotency-Key'] });
    return fetch(url.replace('https://gestao-fadas.teste.local', `http://127.0.0.1:${porta}`), opts);
  };
  const { FadasAdapter, IntegrationError } = await importar('adapters.mjs');
  const adapter = new FadasAdapter({ baseUrl: BASE_FALSA, token: TOKEN, fetchImpl });
  /** Chamada crua (para códigos HTTP e cabeçalhos que o adaptador não produz). */
  const cru = async (metodo, caminho, { corpo, chave, token = TOKEN, texto } = {}) => {
    const resp = await fetch(`http://127.0.0.1:${porta}/api${caminho}`, {
      method: metodo,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(corpo !== undefined || texto !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(chave ? { 'Idempotency-Key': chave } : {}) },
      ...(texto !== undefined ? { body: texto } : corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    });
    const t = await resp.text();
    let json = null; try { json = t ? JSON.parse(t) : null; } catch { /* não-JSON */ }
    return { status: resp.status, corpo: json, texto: t };
  };
  const consulta = async (sql, valores) => (await sequelize.query(sql, { replacements: valores, logging: false }))[0];
  const contar = async (tabela, onde = 'TRUE', valores = {}) => Number((await consulta(`SELECT count(*) AS n FROM ${tabela} WHERE ${onde}`, valores))[0].n);
  return {
    r, importar, LILLY_DIR, sequelize, avulso, servidor, porta, adapter, IntegrationError, FadasAdapter, fetchImpl, chamadas, cru, consulta, contar,
    umbler, legado, legadoTratarPor, definirFontes, AGORA, TOKEN, BASE_FALSA,
    fechar: async () => { servidor.close(); await sequelize.close(); },
  };
}

module.exports = { criarAmbiente, r };
