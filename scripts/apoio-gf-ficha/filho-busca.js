'use strict';

/**
 * FILHO de scripts/verificar-gf-ficha.js (busca e lista): contra o Postgres DESCARTÁVEL (fdb_fch_*) e um legado de MENTIRA (os models do legado
 * são trocados por linhas de teste em memória; o MySQL real NÃO é tocado nem configurado). Prova a busca combinada legado + extensão
 * (`gf_clientes_ext`): com `GF_FATIA_FICHA` ligada a lista acha o nome EDITADO e mostra o cadastro como a ficha; desligada, o contrato da B.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true' });
delete process.env.GF_LEGADO_ESCRITA_ENABLED;
const r = (p) => path.join(raiz, p);

const usuario = (id, nome, extra = {}) => ({
  id, nivel: 0, nome_id: nome, nome2: '', nome: `Cadastro ${id}`, ddd: '11', telresidencial: '', telcomercial: '', cel: '', whats: '', email: '', email2: '', cpf: '', status_cpf_id: 0, buscaNaReceita: '',
  datanascimento: '1990-05-17 00:00:00', horanascimento: '', cidadeNascimento: '', ufNascimento: '', IDpaisNascimento: 0, endereco: '', numero: '', complemento: '', bairro: '', cep: '', cidade: '', estado: '', idPais: 0,
  data_cadastro: '2020-01-01 10:00:00', saldo: '10.00', valorAPagar: '0.00', id_cliente_valido: 0, ...extra,
});
const LINHAS = [usuario(900013, 'Maria Antiga'), usuario(900014, 'Joana Silva', { whats: '11988887777' }), usuario(900015, 'Carlos Souza')];
const vazio = { findAll: async () => [] };
const falso = {
  // O pré-filtro do legado pode devolver mais; a regra da v608 decide. Só `where.id` é honrado (a leitura de cadastros por id).
  LegadoUsuario: { findAll: async (o = {}) => { const id = o.where && o.where.id; return id === undefined ? LINHAS : LINHAS.filter((l) => [].concat(id).map(Number).includes(l.id)); } },
  LegadoConsulta: vazio, LegadoPagamentoInformado: vazio, LegadoPagamentoConfirmado: vazio, LegadoPagamentoNaoLocalizado: vazio, LegadoFormaConsulta: vazio, LegadoOpcaoPagamento: vazio, LegadoBanco: vazio, LegadoTarologo: vazio,
};
require(r('src/models/legado')).iniciarLegado = () => ({ models: falso });

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const adm = await criarUsuario('Administradora Fbu');
  const sessao = { userId: adm, role: 'administradora', displayName: 'Laya' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-fbu' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const lista = async (q) => { const resp = await fetch(`${base}/operations/clients?${new URLSearchParams(q)}`); const j = await resp.json(); return { status: resp.status, j }; };
  const nomes = (x) => (x.j.clients || []).map((i) => `${i.id}:${i.name}`);

  await sequelize.query(`INSERT INTO gf_clientes_ext (id_cliente, dados, atualizado_por, operation_key) VALUES ('900013', '{"name":"Ariadne Nova","treatAs":"Ari","whatsapp":"11955554444","birthDate":"02/03/1985"}', 'Teste', 'op-fbu-0001'), ('900015', '{"treatAs":"Carlão"}', 'Teste', 'op-fbu-0002')`);

  console.log('Busca combinada legado + extensão');
  await passo('flag desligada: contrato da B (a busca acha só o nome do legado; o nome editado não)', async () => {
    delete process.env.GF_FATIA_FICHA;
    assert.deepEqual(nomes(await lista({ q: 'Maria' })), ['900013:Maria Antiga']);
    assert.deepEqual(nomes(await lista({ q: 'Ariadne' })), []);
  });
  process.env.GF_FATIA_FICHA = 'true';
  await passo('flag ligada: a busca simples acha o nome editado (sem acento e sem caixa) e mostra o nome editado; o nome antigo deixa de casar', async () => {
    const x = await lista({ q: 'ariadne' }); assert.equal(x.status, 200, JSON.stringify(x.j).slice(0, 200)); assert.deepEqual(nomes(x), ['900013:Ariadne Nova']);
    assert.equal(x.j.clients[0].treatAs, 'Ari');
    assert.deepEqual(nomes(await lista({ q: 'Maria' })), []);
  });
  await passo('o campo Nome da busca detalhada, vários termos e o tratar-por editado também acham; quem não foi editado segue achando', async () => {
    assert.deepEqual(nomes(await lista({ name: 'Ariadne Nova' })), ['900013:Ariadne Nova']);
    assert.deepEqual(nomes(await lista({ q: 'Nova Ariadne' })), ['900013:Ariadne Nova']);
    assert.deepEqual(nomes(await lista({ q: 'Joana' })), ['900014:Joana Silva']);
    assert.deepEqual(nomes(await lista({ q: 'Souza' })).sort(), ['900015:Carlos Souza']);
  });
  await passo('o WhatsApp e o nascimento editados também entram na busca; o nascimento do legado não casa mais', async () => {
    assert.deepEqual(nomes(await lista({ phone: '955554444' })), ['900013:Ariadne Nova']);
    assert.deepEqual(nomes(await lista({ birthDate: '02/03/1985' })), ['900013:Ariadne Nova']);
    assert.ok(!nomes(await lista({ birthDate: '17/05/1990' })).some((n) => n.startsWith('900013')));
  });
  await passo('a busca por ID e a lista sem extensão seguem iguais; busca sem resultado devolve lista vazia', async () => {
    assert.deepEqual(nomes(await lista({ q: '900014' })), ['900014:Joana Silva']);
    assert.deepEqual(nomes(await lista({ q: 'Inexistente' })), []);
  });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres (busca): ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close().catch(() => {});
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
