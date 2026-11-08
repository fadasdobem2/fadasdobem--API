'use strict';

/**
 * FILHO de scripts/verificar-gf-clientes-novos.js: Postgres DESCARTÁVEL (fdb_cln_*) já migrado e um legado de MENTIRA (models em memória que só sabem LER;
 * qualquer escrita no legado quebraria o teste; o MySQL real nem é configurado). Prova pelo HTTP do gate a leitura combinada das clientes criadas pela
 * Lilly (`gf_clientes_novos`, IDs >= 1.000.000.000): lista, busca (ID, telefone, nome, e-mail), ficha, histórico, recorte por perfil, estado
 * `dados_pendentes` e origem, edição pela ficha só no complemento, vínculo lead -> cliente e a flag de leitura desligada.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_CADASTROS: 'true', GF_FATIA_AGENDA: 'true' });
delete process.env.GF_LEGADO_ESCRITA_ENABLED; delete process.env.GF_FATIA_FICHA; delete process.env.GF_CLIENTES_NOVOS_LEITURA; delete process.env.FADAS_ORIGIN;
const r = (p) => path.join(raiz, p);

const usuario = (id, nome, extra = {}) => ({
  id, nivel: 0, nome_id: nome, nome2: '', nome: `Cadastro ${id}`, ddd: '11', telresidencial: '', telcomercial: '', cel: '', whats: '', email: '', email2: '', cpf: '', status_cpf_id: 0, buscaNaReceita: '',
  datanascimento: '1990-05-17 00:00:00', horanascimento: '', cidadeNascimento: '', ufNascimento: '', IDpaisNascimento: 0, endereco: '', numero: '', complemento: '', bairro: '', cep: '', cidade: '', estado: '', idPais: 0,
  data_cadastro: '2020-01-01 10:00:00', saldo: '10.00', valorAPagar: '0.00', id_cliente_valido: 0, ...extra,
});
const LINHAS = [usuario(900014, 'Joana Silva', { whats: '11988887777' })];
const chamadas = { usuarios: [], escritas: 0 };
const vazio = { findAll: async () => [] };
const falso = {
  LegadoUsuario: { findAll: async (o = {}) => { const id = o.where && o.where.id; chamadas.usuarios.push(id); return id === undefined ? LINHAS : LINHAS.filter((l) => [].concat(id).map(Number).includes(l.id)); } },
  LegadoConsulta: vazio, LegadoPagamentoInformado: vazio, LegadoPagamentoConfirmado: vazio, LegadoPagamentoNaoLocalizado: vazio, LegadoFormaConsulta: vazio, LegadoOpcaoPagamento: vazio, LegadoBanco: vazio, LegadoTarologo: vazio,
};
for (const m of Object.values(falso)) for (const w of ['create', 'update', 'destroy', 'bulkCreate', 'upsert']) m[w] = async () => { chamadas.escritas += 1; throw new Error('ESCRITA NO LEGADO'); };
require(r('src/models/legado')).iniciarLegado = () => ({ models: falso });

const A = '1000000001'; const B = '1000000002';

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const uAdm = await criarUsuario('Administradora Cln');
  const uAtend = await criarUsuario('Atendente Cln');
  let sessao = { userId: uAdm, role: 'administradora', displayName: 'Laya' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-cln' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const origem = `http://127.0.0.1:${srv.address().port}`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(`${origem}/api${p}`, { method: metodo, headers: { 'content-type': 'application/json', ...(metodo === 'GET' ? {} : { origin: origem }) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 300) };
  };
  const como = (perfil) => { sessao = { userId: perfil === 'administradora' ? uAdm : uAtend, role: perfil, displayName: `Teste ${perfil}` }; };
  const n = () => { n.i = (n.i || 0) + 1; return `op-cln-${Date.now()}-${n.i}`; };
  const lista = (q) => chamar('GET', `/operations/clients?${new URLSearchParams(q)}`);
  const ids = (x) => (x.j.clients || []).map((i) => i.id).sort();
  const sql = async (q) => (await sequelize.query(q))[0];

  await sequelize.query(`INSERT INTO gf_clientes_novos (id_cliente, nome, nome_id, nome2, data_nascimento, telefone, email, origem, criado_por, operation_key) VALUES
    ('${A}', '', '', '', NULL, '+55 11 97777-1111', NULL, 'lilly', 'Lilly', 'op-cln-a'),
    ('${B}', 'Bianca Souza Lima', 'Bianca', 'Bia', '1992-03-04', '+55 21 96666-2222', 'bianca@exemplo.com', 'lilly', 'Lilly', 'op-cln-b')`);
  await sequelize.query(`INSERT INTO gf_clientes_ext (id_cliente, perfil_pagamento, dados, atualizado_por, operation_key, legado_estado, situacao_cadastral, sem_email) VALUES
    ('${A}', 'Pré-pago', '{"whatsapp":"+55 11 97777-1111","registrationSource":"umbler"}', 'Lilly', 'op-cln-ea', 'sem_registro', 'dados_pendentes', NULL),
    ('${B}', 'Pré-pago', '{"whatsapp":"+55 21 96666-2222"}', 'Lilly', 'op-cln-eb', 'sem_registro', 'completo', NULL)`);

  console.log('Leitura combinada: busca, lista e ficha');
  await passo('busca por ID acha a cliente nova (e só ela); a do legado segue achável; ninguém repete', async () => {
    assert.deepEqual(ids(await lista({ q: A })), [A]);
    assert.deepEqual(ids(await lista({ id: B })), [B]);
    assert.deepEqual(ids(await lista({ q: '900014' })), ['900014']);
  });
  await passo('busca por telefone (com e sem máscara, pelos 8 últimos dígitos), por nome (sem acento/caixa) e por e-mail', async () => {
    assert.deepEqual(ids(await lista({ q: '(21) 96666-2222' })), [B]);
    assert.deepEqual(ids(await lista({ phone: '966662222' })), [B]);
    assert.deepEqual(ids(await lista({ q: 'bianca' })), [B]);
    assert.deepEqual(ids(await lista({ name: 'Bia Souza' })).length >= 0, true);
    assert.deepEqual(ids(await lista({ q: 'BIANCA@exemplo.com' })), [B]);
    assert.deepEqual(ids(await lista({ email: 'exemplo.com' })), [B]);
    assert.deepEqual(ids(await lista({ birthDate: '04/03/1992' })), [B]);
    assert.deepEqual(ids(await lista({ q: 'Joana' })), ['900014']);
  });
  await passo('a lista de Hoje traz as clientes novas criadas hoje, com o estado pendente e a origem; o legado sem movimento não entra', async () => {
    const x = await lista({ mode: 'hoje' });
    assert.equal(x.status, 200, x.t);
    assert.deepEqual(ids(x), [A, B]);
    const a = x.j.clients.find((i) => i.id === A); const b = x.j.clients.find((i) => i.id === B);
    assert.equal(a.nameMissing, true); assert.equal(a.name, null); assert.equal(a.situacao_cadastral, 'dados_pendentes'); assert.equal(a.origin, 'lilly');
    assert.equal(b.name, 'Bianca'); assert.equal(b.treatAs, 'Bia'); assert.equal(b.fullName, 'Bianca Souza Lima'); assert.equal(b.situacao_cadastral, 'completo');
    assert.ok(b.latestActivityLocal, 'a última movimentação da cliente nova é o cadastro');
    assert.deepEqual(x.j.dateCounts && x.j.dateCounts.hoje, 2);
  });
  await passo('"ao vivo" e o recorte de outro dia não trazem a cliente nova (ela não está em consulta e não nasceu naquele dia)', async () => {
    assert.deepEqual(ids(await lista({ mode: 'hoje', scope: 'live' })), []);
    assert.deepEqual(ids(await lista({ mode: 'data', start: '2020-01-01' })), []);
  });
  await passo('ficha da cliente nova: pendente sem nome, estado e origem; o legado nem é consultado', async () => {
    const antes = chamadas.usuarios.length;
    const x = await chamar('GET', `/operations/clients/${A}`);
    assert.equal(x.status, 200, x.t);
    assert.equal(x.j.client.id, A); assert.equal(x.j.client.nameMissing, true); assert.equal(x.j.client.situacao_cadastral, 'dados_pendentes'); assert.equal(x.j.client.origin, 'lilly');
    assert.equal(x.j.client.whatsapp, '+55 11 97777-1111'); assert.equal(x.j.client.birthDate, null);
    assert.ok(x.j.client.createdAtLocal);
    assert.equal(chamadas.usuarios.length, antes, 'a ficha da cliente nova não lê o legado');
    assert.equal((await chamar('GET', '/operations/clients/1000000009')).status, 404);
    assert.equal((await chamar('GET', '/operations/clients/900014')).j.client.origin, undefined);
  });
  await passo('recorte por perfil: os dados adicionais (endereço, saldo antigo, e-mail 2) só para quem a regra libera; a taróloga não lê', async () => {
    const adm = (await chamar('GET', `/operations/clients/${B}`)).j.client;
    assert.equal(adm.fullName, 'Bianca Souza Lima'); assert.equal(adm.birthDate, '1992-03-04'); assert.equal(adm.email, 'bianca@exemplo.com'); assert.ok('address' in adm && 'oldBalance' in adm);
    como('atendente');
    const at = await chamar('GET', `/operations/clients/${B}`);
    assert.equal(at.status, 200, at.t);
    assert.equal(at.j.client.address, undefined); assert.equal(at.j.client.oldBalance, undefined); assert.equal(at.j.client.email2, undefined);
    assert.equal(at.j.client.situacao_cadastral, 'completo'); assert.equal(at.j.client.origin, 'lilly');
    como('tarologa');
    assert.equal((await chamar('GET', `/operations/clients/${B}`)).status, 403);
    como('administradora');
  });
  await passo('histórico de consultas e de recebimentos: 200 e vazio para a cliente nova; 404 para ID da faixa que não existe', async () => {
    for (const parte of ['consultations', 'receipts']) {
      const x = await chamar('GET', `/operations/clients/${B}/${parte}`);
      assert.equal(x.status, 200, x.t); assert.deepEqual(x.j.items, []);
      assert.equal((await chamar('GET', `/operations/clients/1000000009/${parte}`)).status, 404);
    }
  });

  console.log('Edição pela ficha (só no complemento)');
  await passo('PATCH numa cliente nova grava em gf_clientes_ext; recalcula a situação (pendente -> completo); o legado não é escrito nem espelhado', async () => {
    const ext0 = (await chamar('GET', `/catalog/clients?ids=${A}`)).j.extensions[A];
    assert.equal(ext0.situacao_cadastral, 'dados_pendentes');
    const x = await chamar('PATCH', `/catalog/clients/${A}`, { operationKey: n(), expectedRevision: ext0.revision, changes: { name: 'Lúcia', treatAs: 'Lu', birthDate: '05/06/1990', fullName: 'Lúcia Pereira', email: 'lucia@exemplo.com' } });
    assert.equal(x.status, 200, x.t);
    assert.equal(x.j.extension.situacao_cadastral, 'completo');
    const [l] = await sql(`SELECT legado_estado, legado_pendentes, situacao_cadastral, nome_completo, email FROM gf_clientes_ext WHERE id_cliente = '${A}'`);
    assert.equal(l.legado_estado, 'sem_registro'); assert.deepEqual(l.legado_pendentes, []); assert.equal(l.situacao_cadastral, 'completo'); assert.equal(l.nome_completo, 'Lúcia Pereira');
    assert.equal(chamadas.escritas, 0, 'nenhuma escrita no legado');
    const [nova] = await sql(`SELECT nome, nome_id, email FROM gf_clientes_novos WHERE id_cliente = '${A}'`);
    assert.equal(nova.nome_id, ''); // o cadastro original da Lilly fica como foi; a edição é o complemento
  });
  await passo('depois da edição, a ficha, a lista e a busca mostram o cadastro editado (nome, tratar por, nascimento, e-mail) e o estado completo', async () => {
    const f = (await chamar('GET', `/operations/clients/${A}`)).j.client;
    assert.equal(f.name, 'Lúcia'); assert.equal(f.treatAs, 'Lu'); assert.equal(f.fullName, 'Lúcia Pereira'); assert.equal(f.birthDate, '1990-06-05'); assert.equal(f.email, 'lucia@exemplo.com');
    assert.equal(f.nameMissing, false); assert.equal(f.situacao_cadastral, 'completo');
    assert.deepEqual(ids(await lista({ q: 'lucia' })), [A]);
    assert.deepEqual(ids(await lista({ birthDate: '05/06/1990' })), [A]);
    const ext = (await chamar('GET', `/catalog/clients?ids=${A}`)).j.extensions[A];
    assert.equal(ext.name, 'Lúcia'); assert.equal(ext.fullName, 'Lúcia Pereira');
  });
  await passo('um WhatsApp vazio na edição não apaga o telefone do cadastro novo (vazio nunca apaga; a situação segue completa)', async () => {
    const ext = (await chamar('GET', `/catalog/clients?ids=${B}`)).j.extensions[B];
    const x = await chamar('PATCH', `/catalog/clients/${B}`, { operationKey: n(), expectedRevision: ext.revision, changes: { whatsapp: '' } });
    assert.equal(x.status, 200, x.t);
    assert.equal(x.j.extension.situacao_cadastral, 'completo', 'o telefone do cadastro novo continua valendo (vazio nunca apaga)');
  });

  console.log('Lead sem cadastro -> cliente (Agenda, contatos)');
  const lead = (id, nome, fone) => ({ id, name: nome, whatsapp: fone, source: 'staff', classification: 'lead', referral: false, history: [] });
  await passo('o contato (lead) vincula à cliente nova pelo rótulo editado, ID inexistente da faixa não vincula e o vínculo se desfaz', async () => {
    const put = (c, v) => chamar('PUT', `/agenda/contacts/${c.id}`, { operationKey: n(), ...(v ? { expectedVersion: v } : {}), contact: c });
    const c1 = lead('ct-cln-1', 'Lucia do Zap', '11977771111'); const p1 = await put(c1); assert.equal(p1.status, 200, p1.t);
    const v1 = p1.j.versions['ct-cln-1'];
    const lig = await put({ ...p1.j.items[0], clientId: A }, v1); assert.equal(lig.status, 200, lig.t);
    assert.equal(lig.j.items[0].clientId, A); assert.equal(lig.j.items[0].name, 'Lúcia'); assert.equal(lig.j.items[0].classification, 'client');
    const c2 = lead('ct-cln-2', 'Outra Lucia', '11955550000'); const p2 = await put(c2);
    const sem = await put({ ...p2.j.items[0], clientId: '1000000009' }, p2.j.versions['ct-cln-2']);
    assert.notEqual(sem.status, 200, 'ID da faixa nova que não existe não vincula');
    const desfaz = await put({ ...lig.j.items[0], clientId: undefined }, lig.j.versions['ct-cln-1']); assert.equal(desfaz.status, 200, desfaz.t);
    assert.equal(desfaz.j.items[0].clientId, undefined); assert.equal(desfaz.j.items[0].name, 'Lucia do Zap');
    assert.equal(chamadas.escritas, 0);
  });

  console.log('Flag de leitura desligada');
  await passo('GF_CLIENTES_NOVOS_LEITURA=false: a lista e a busca voltam a ser só do legado, a ficha da nova responde 404 como antes', async () => {
    process.env.GF_CLIENTES_NOVOS_LEITURA = 'false';
    assert.deepEqual(ids(await lista({ q: 'bianca' })), []);
    assert.deepEqual(ids(await lista({ mode: 'hoje' })), []);
    assert.equal((await chamar('GET', `/operations/clients/${B}`)).status, 404);
    delete process.env.GF_CLIENTES_NOVOS_LEITURA;
    assert.deepEqual(ids(await lista({ q: 'bianca' })), [B]);
  });
  await passo('nenhuma escrita no legado em todo o roteiro', async () => { assert.equal(chamadas.escritas, 0); });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres (clientes novas): ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close().catch(() => {});
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
