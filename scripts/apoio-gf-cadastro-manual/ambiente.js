'use strict';

const path = require('path');
const express = require('express');
const { randomUUID } = require('crypto');
const { raiz, criarUsuario } = require('../apoio-gf-banco-novo/comum');

// O filho nunca pode ser usado contra um banco operacional, mesmo invocado diretamente.
if (!/^fdb_cmn_[a-f0-9]{8}$/.test(process.env.DB_NAME || '') || process.env.DB_HOST !== 'localhost') {
  throw new Error('Este roteiro exige o banco local fdb_cmn_* criado pelo runner.');
}
Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', GESTAO_FADAS_ENABLED: 'true', FADAS_ENVIRONMENT: 'test',
  GF_NOVOS_DADOS: 'postgres', GF_FATIA_CADASTROS: 'true', GF_LEGADO_ESCRITA_ENABLED: 'false',
  LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '', LEGADO_DB_PASSWORD: '',
});
for (const flag of ['GF_FATIA_FICHA', 'GF_CLIENTES_NOVOS_LEITURA', 'FADAS_ORIGIN']) delete process.env[flag];
const r = (p) => require(path.join(raiz, p));

const chamadas = { leituras: 0, escritas: 0 };
const linhasLegadas = [{
  id: 900014, nivel: 0, nome_id: 'Legada Revisão', nome2: '', nome: 'Cliente Legada Revisão',
  ddd: '11', telresidencial: '', telcomercial: '', cel: '', whats: '+55 11 97777-9999', email: 'legada.revisao@example.invalid', email2: '', cpf: '', status_cpf_id: 0,
  datanascimento: '1980-04-05 00:00:00', horanascimento: '', cidadeNascimento: '', ufNascimento: '', IDpaisNascimento: 0,
  endereco: '', numero: '', complemento: '', bairro: '', cep: '', cidade: '', estado: '', idPais: 0,
  data_cadastro: '2020-01-01 10:00:00', saldo: '0.00', valorAPagar: '0.00', id_cliente_valido: 0,
}];
const legado = {};
for (const nome of ['LegadoUsuario', 'LegadoConsulta', 'LegadoPagamentoInformado', 'LegadoPagamentoConfirmado', 'LegadoPagamentoNaoLocalizado', 'LegadoFormaConsulta', 'LegadoOpcaoPagamento', 'LegadoBanco', 'LegadoTarologo']) {
  legado[nome] = { findAll: async () => { chamadas.leituras += 1; return []; } };
  for (const metodo of ['create', 'update', 'destroy', 'bulkCreate', 'upsert', 'increment', 'decrement']) {
    legado[nome][metodo] = async () => { chamadas.escritas += 1; throw new Error('ESCRITA NO LEGADO RECUSADA PELO TESTE'); };
  }
}
legado.LegadoUsuario.findAll = async (opcoes = {}) => {
  chamadas.leituras += 1;
  const id = opcoes.where && opcoes.where.id;
  return id === undefined ? linhasLegadas : linhasLegadas.filter((l) => [].concat(id).map(Number).includes(l.id));
};
r('src/models/legado').iniciarLegado = () => ({ models: legado });

async function abrir({ offline = false } = {}) {
  const { sequelize } = r('src/config/database');
  let bancoOffline = 0;
  if (offline) {
    const bloquearBanco = async () => { bancoOffline += 1; throw new Error('Banco bloqueado na verificação HTTP offline'); };
    sequelize.query = bloquearBanco;
    sequelize.connectionManager.getConnection = bloquearBanco;
  }
  const { criarGate } = r('src/gestao-fadas/gate');
  const usuario = offline ? randomUUID() : await criarUsuario('Cadastro Manual Teste');
  let identidade;
  let estado = 'identity';
  const como = (role = 'administradora') => { estado = 'identity'; identidade = { userId: usuario, role, displayName: 'Equipe teste manual', ...(role === 'tarologa' ? { tarotId: '9001' } : {}) }; };
  como();
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: estado, identity: identidade, sessionId: 'sessao-cmn' }) }, verificarLegado: async () => true }));
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => servidor.once('listening', resolve));
  const origem = `http://127.0.0.1:${servidor.address().port}`;
  async function chamar(metodo, rota, corpo, cabecalhos = {}) {
    const headers = { 'content-type': 'application/json', ...(metodo === 'GET' ? {} : { origin: origem }), ...cabecalhos };
    for (const [k, v] of Object.entries(headers)) if (v === null) delete headers[k];
    const resposta = await fetch(`${origem}/api${rota}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const texto = await resposta.text();
    let dados = null; try { dados = JSON.parse(texto); } catch (_) { /* erro não JSON fica visível na asserção */ }
    return { status: resposta.status, j: dados, t: texto.slice(0, 400), headers: resposta.headers };
  }
  const chave = () => `manual-${randomUUID()}`;
  const criar = (changes, operationKey = chave(), headers, extra = {}) => chamar('POST', '/catalog/clients', { operationKey, changes, ...extra }, headers);
  const sql = async (texto, replacements = []) => (await sequelize.query(texto, { replacements }))[0];
  const contagem = async () => Number((await sql('SELECT COUNT(*) AS n FROM gf_clientes_novos'))[0].n);
  return {
    sequelize, usuario, origem, como, sessao: (valor) => { estado = valor; }, chamar, chave, criar, sql, contagem, chamadas, bancoOffline: () => bancoOffline,
    fechar: async () => { servidor.closeAllConnections?.(); await new Promise((resolve) => servidor.close(resolve)); await sequelize.close(); },
  };
}

let numero = 0;
function dados(extra = {}) {
  numero += 1;
  return { fullName: `Cliente${numero} Exemplo Manual`, phones: [`+55 11 98${String(numero).padStart(7, '0')}`], ...extra };
}
module.exports = { abrir, dados };
