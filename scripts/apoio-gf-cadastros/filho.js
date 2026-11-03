'use strict';

/**
 * FILHO de scripts/verificar-gf-cadastros.js: roda contra o Postgres DESCARTÁVEL (fdb_cad_*) já migrado, com DB_* só no ambiente
 * deste processo. Prova pelo HTTP do gate (sessão de mentira, usuários reais da A no banco, tarólogos e clientes do legado
 * SUBSTITUÍDOS por listas fixas: o MySQL legado nem é configurado): catálogo, perfil com idempotência, 409 de versão e de chave,
 * corrida, perfis, vínculo de conta, Cadastro de tarólogos (ficha, aprovação, link e envio público) e extensão de cliente.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_CADASTROS: 'true' });
delete process.env.FADAS_ORIGIN;
const r = (p) => path.join(raiz, p);

const LEGADO = [
  { idTarologo: 9001, nmuTarologo: 'Tarólogo A', ativo: 1, meus_horarios: '\r\n\t<div><b>Seg a Sex:</b> 10h as 18h<br>Sab: 9h&nbsp;as 12h</div>\r\n\t', email: 'contato.a@exemplo.com' }, { idTarologo: 9002, nmuTarologo: 'Tarólogo B', ativo: 1 },
  { idTarologo: 9003, nmuTarologo: 'Tarólogo C', ativo: 0, meus_horarios: '\r\n\t\t\r\n', email: 'sem-arroba' }, { idTarologo: 9005, nmuTarologo: 'Tarólogo E', ativo: 1 },
];

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const tarologos = require(r('src/gestao-fadas/features/cadastros/tarologos.service'));
  const clientes = require(r('src/gestao-fadas/features/cadastros/clientes.service'));
  const cadastro = require(r('src/gestao-fadas/features/cadastros/cadastro-tarologo.service'));
  tarologos.definirFonteLegado({ listar: async () => LEGADO.map((l) => ({ ...l })), obter: async (id) => LEGADO.find((l) => l.idTarologo === id) || null });
  cadastro.definirVerificadorLegado(async (id) => LEGADO.some((l) => l.idTarologo === id));
  clientes.definirVerificadorDeCliente(async (id) => ['900013', '900014'].includes(id));

  const uAdmin = await criarUsuario('Administradora Cadastros');
  const uStaff = await criarUsuario('Atendente Cadastros');
  const uTar = await criarUsuario('Taróloga Cadastros');
  let sessao = { userId: uAdmin, role: 'administradora', displayName: 'Administradora Cadastros' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-cad' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const origem = `http://127.0.0.1:${srv.address().port}`;
  const chamar = async (metodo, p, corpo, cab = {}) => {
    const resp = await fetch(`${origem}/api${p}`, { method: metodo, headers: { 'content-type': 'application/json', ...(metodo === 'GET' ? {} : { origin: origem }), ...cab }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 240), h: resp.headers };
  };
  const como = (perfil, extra = {}) => { sessao = { userId: perfil === 'administradora' ? uAdmin : perfil === 'tarologa' ? uTar : uStaff, role: perfil, displayName: `Teste ${perfil}`, ...extra }; };
  const n = () => { n.i = (n.i || 0) + 1; return `op-${Date.now()}-${n.i}`; };
  const contar = async (sql) => Number((await sequelize.query(sql))[0][0].n);
  const lerCatalogo = async () => (await chamar('GET', '/catalog/tarologists'));
  const item = (res, id) => res.j.tarologists.find((t) => t.id === id);
  const perfil = (id, corpo) => chamar('PUT', `/catalog/tarologists/${id}/profile`, { operationKey: n(), ...corpo });

  console.log('Esquema');
  await passo('5 tabelas da fatia existem e a migração roda de novo sem erro', async () => {
    const [t] = await sequelize.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('gf_tarologos_perfil','gf_cadastros_tarologo','gf_cadastros_tarologo_envios','gf_cadastros_tarologo_links','gf_clientes_ext')");
    assert.equal(t.length, 5);
    await require(r('migrations/20261112000000-gestao-fadas-cadastros')).up({ sequelize });
  });

  console.log('Catálogo de tarólogos: leitura e perfis');
  como('administradora');
  const c0 = await lerCatalogo();
  await passo('administradora lê os 4 do legado com o id do legado, DTO puro e no-store; inativo no legado fica inativo', async () => {
    assert.equal(c0.status, 200, c0.t);
    assert.deepEqual(c0.j.tarologists.map((t) => t.id), ['9001', '9002', '9003', '9005']);
    assert.equal(item(c0, '9003').registrationActive, false); assert.equal(item(c0, '9001').revision, 0);
    assert.equal(c0.h.get('cache-control'), 'no-store'); assert.ok(!('sucesso' in c0.j));
  });
  await passo('atendente lê todos, mas SEM nascimento, nome civil e WhatsApps; taróloga só o próprio, com tudo', async () => {
    const e1 = await perfil('9001', { expectedRevision: 0, directory: { personalWhatsapp: '11 91111-1111', realFirstName: 'Ana', birthDate: '1990-01-02', biography: 'Bio A' } });
    assert.equal(e1.status, 200, e1.t);
    como('atendente');
    const a = await lerCatalogo();
    assert.equal(a.j.tarologists.length, 4);
    assert.equal(item(a, '9001').directory.biography, 'Bio A');
    for (const k of ['personalWhatsapp', 'realFirstName', 'birthDate', 'avatarWhatsapp']) assert.ok(!(k in item(a, '9001').directory), k);
    como('tarologa', { tarotId: '9001' });
    const t = await lerCatalogo();
    assert.deepEqual(t.j.tarologists.map((x) => x.id), ['9001']);
    assert.equal(item(t, '9001').directory.personalWhatsapp, '11 91111-1111');
    como('tarologa', { tarotId: '4242' });
    assert.deepEqual((await lerCatalogo()).j.tarologists, []);
    como('administradora');
  });

  console.log('Catálogo de tarólogos: horários da semana e e-mail de contato');
  await passo('meus_horarios do legado (HTML) vira linhas de texto em profile.official; só espaço em branco vira lista vazia', async () => {
    const a = await lerCatalogo();
    assert.deepEqual(item(a, '9001').profile.official, ['Seg a Sex: 10h as 18h', 'Sab: 9h as 12h']);
    assert.deepEqual(item(a, '9003').profile.official, []); assert.deepEqual(item(a, '9002').profile.official, []);
  });
  await passo('a LISTA nunca leva o e-mail (administradora, atendente, supervisora, taróloga), mesmo com o legado tendo', async () => {
    for (const [perfil, extra] of [['administradora'], ['assistente'], ['supervisora'], ['atendente'], ['tarologa', { tarotId: '9001' }]]) {
      como(perfil, extra);
      const l = await lerCatalogo();
      assert.equal(l.status, 200, `${perfil}: ${l.t}`);
      assert.ok(!JSON.stringify(l.j).includes('contactEmail') && !JSON.stringify(l.j).includes('contato.a@'), `${perfil} vazou e-mail na lista`);
    }
    como('administradora');
  });
  await passo('DETALHE: só a administradora recebe contactEmail; os demais recebem o tarólogo sem o campo; nunca pass', async () => {
    const adm = await chamar('GET', '/catalog/tarologists/9001');
    assert.equal(adm.status, 200, adm.t);
    assert.equal(adm.j.tarologist.id, '9001'); assert.equal(adm.j.tarologist.directory.contactEmail, 'contato.a@exemplo.com');
    assert.deepEqual(adm.j.tarologist.profile.official, ['Seg a Sex: 10h as 18h', 'Sab: 9h as 12h']);
    assert.ok(!/"pass"/i.test(adm.t) && !/senha/i.test(JSON.stringify(adm.j)));
    assert.equal(adm.h.get('cache-control'), 'no-store');
    for (const [perfil, extra] of [['assistente'], ['supervisora'], ['atendente'], ['tarologa', { tarotId: '9001' }]]) {
      como(perfil, extra);
      const r = await chamar('GET', '/catalog/tarologists/9001');
      assert.equal(r.status, 200, `${perfil}: ${r.t}`);
      assert.ok(!('contactEmail' in r.j.tarologist.directory), `${perfil} recebeu o e-mail`);
      assert.ok(!JSON.stringify(r.j).includes('contato.a@'), `${perfil} vazou o e-mail`);
    }
    como('tarologa', { tarotId: '9002' });
    assert.equal((await chamar('GET', '/catalog/tarologists/9001')).status, 404, 'taróloga não lê outro tarólogo');
    como('administradora');
    assert.equal((await chamar('GET', '/catalog/tarologists/9003')).j.tarologist.directory.contactEmail, undefined, 'sem forma de e-mail: não vai');
    assert.equal((await chamar('GET', '/catalog/tarologists/777777')).status, 404);
    assert.equal((await chamar('GET', '/catalog/tarologists/a%20b')).status >= 400, true);
  });

  console.log('Catálogo de tarólogos: gravação');
  const k1 = n();
  const corpo1 = { operationKey: k1, expectedRevision: 1, name: 'Ana Luz', avatar: 'https://exemplo.com/ana.png', directory: { oracles: ['Tarot', 'Tarot'], techniques: ['Reiki'], biography: 'Nova bio' } };
  const g1 = await chamar('PUT', '/catalog/tarologists/9001/profile', corpo1);
  await passo('PUT perfil (administradora): 200, nome, foto e diretório gravados, revisão sobe, campo ausente fica ausente', async () => {
    assert.equal(g1.status, 200, g1.t);
    const t = g1.j.tarologist;
    assert.equal(g1.j.revision, 2); assert.equal(t.name, 'Ana Luz'); assert.equal(t.profile.avatar, 'https://exemplo.com/ana.png');
    assert.deepEqual(t.directory.oracles, ['Tarot']); assert.equal(t.directory.biography, 'Nova bio');
    assert.equal(t.directory.personalWhatsapp, '11 91111-1111', 'o que não veio é preservado');
    assert.ok(!('avatarWhatsapp' in t.directory));
    const x = await lerCatalogo(); assert.equal(item(x, '9001').name, 'Ana Luz'); assert.equal(item(x, '9001').revision, 2);
  });
  await passo('mesma chave e mesmo corpo repete a resposta sem gravar de novo; mesma chave com outro corpo: 409 OPERATION_KEY_CONFLICT', async () => {
    const antes = await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'cadastros.tarologo.perfil'");
    const rep = await chamar('PUT', '/catalog/tarologists/9001/profile', corpo1);
    assert.equal(rep.status, 200); assert.equal(rep.j.revision, 2);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'cadastros.tarologo.perfil'"), antes);
    const outro = await chamar('PUT', '/catalog/tarologists/9001/profile', { ...corpo1, name: 'Outra' });
    assert.equal(outro.status, 409); assert.equal(outro.j.error.code, 'OPERATION_KEY_CONFLICT');
  });
  await passo('revisão velha: 409 VERSION_CHANGED e nada muda', async () => {
    const x = await perfil('9001', { expectedRevision: 1, name: 'Velha' });
    assert.equal(x.status, 409); assert.equal(x.j.error.code, 'VERSION_CHANGED'); assert.equal(x.j.error.message, 'O cadastro mudou desde que você abriu a tela. Atualize e tente novamente.');
    assert.equal(item(await lerCatalogo(), '9001').name, 'Ana Luz');
  });
  await passo('corrida: duas gravações com a mesma revisão -> uma vence (200) e a outra recebe 409', async () => {
    const [a, b] = await Promise.all([perfil('9002', { expectedRevision: 0, name: 'Beta Um' }), perfil('9002', { expectedRevision: 0, name: 'Beta Dois' })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.status}/${b.status}`);
    assert.equal(item(await lerCatalogo(), '9002').revision, 1);
  });
  await passo('regras: nome vazio, lista mal formada, grupo desconhecido, foto fora do padrão: 422 com a mensagem do front; id inexistente: 404', async () => {
    const rev = item(await lerCatalogo(), '9005').revision;
    const v = async (corpo) => perfil('9005', { expectedRevision: rev, ...corpo });
    assert.equal((await v({ name: '  ' })).status, 422);
    const l = await v({ directory: { oracles: 'x' } }); assert.equal(l.status, 422); assert.match(l.j.error.message, /seleção inválida/);
    assert.equal((await v({ directory: { capabilityGroups: { zz: [] } } })).status, 422);
    assert.equal((await v({ avatar: 'http://x/y.png' })).status, 422);
    assert.equal((await perfil('7777', { expectedRevision: 0, name: 'X' })).status, 404);
    assert.equal((await perfil('tarot-nao-existe', { expectedRevision: 0, name: 'X' })).status, 404);
    assert.equal(item(await lerCatalogo(), '9005').revision, rev);
  });
  await passo('perfis: atendente 403; taróloga edita só o próprio e não a situação do cadastro; sem tarotId 403', async () => {
    como('atendente');
    assert.equal((await perfil('9005', { expectedRevision: 0, name: 'Z' })).status, 403);
    como('tarologa', { tarotId: '9001' });
    const r1 = item(await lerCatalogo(), '9001').revision;
    const ok = await perfil('9001', { expectedRevision: r1, directory: { biography: 'Minha bio' } });
    assert.equal(ok.status, 200, ok.t);
    assert.equal((await perfil('9002', { expectedRevision: 1, directory: { biography: 'x' } })).status, 403);
    assert.equal((await perfil('9001', { expectedRevision: r1 + 1, registrationActive: false })).status, 403);
    como('tarologa');
    assert.equal((await perfil('9001', { expectedRevision: r1 + 1, name: 'S' })).status, 403);
    como('administradora');
  });
  await passo('situação do cadastro (ativo) gravada pela administradora vence o legado', async () => {
    const rev = item(await lerCatalogo(), '9003').revision;
    const x = await perfil('9003', { expectedRevision: rev, registrationActive: true });
    assert.equal(x.status, 200, x.t); assert.equal(x.j.tarologist.registrationActive, true); assert.equal(x.j.tarologist.active, false);
  });

  console.log('Vínculo da conta da taróloga');
  await passo('só a administradora vincula; o mesmo slug não vai a dois tarólogos (422); soltar com null; chave repetida não duplica', async () => {
    como('atendente');
    assert.equal((await chamar('PUT', '/catalog/tarologists/9005/account', { operationKey: n(), expectedRevision: 0, accountSlug: 'estrela' })).status, 403);
    como('administradora');
    const rev = item(await lerCatalogo(), '9005').revision;
    const k = n();
    const a = await chamar('PUT', '/catalog/tarologists/9005/account', { operationKey: k, expectedRevision: rev, accountSlug: 'estrela' });
    assert.equal(a.status, 200, a.t); assert.equal(a.j.tarologist.accountLinked, true);
    assert.equal((await chamar('PUT', '/catalog/tarologists/9005/account', { operationKey: k, expectedRevision: rev, accountSlug: 'estrela' })).j.revision, a.j.revision);
    const dup = await chamar('PUT', '/catalog/tarologists/9002/account', { operationKey: n(), expectedRevision: item(await lerCatalogo(), '9002').revision, accountSlug: 'estrela' });
    assert.equal(dup.status, 422); assert.match(dup.j.error.message, /já está vinculada/);
    const solto = await chamar('PUT', '/catalog/tarologists/9005/account', { operationKey: n(), expectedRevision: a.j.revision, accountSlug: null });
    assert.equal(solto.status, 200); assert.equal(solto.j.tarologist.accountLinked, false);
  });

  console.log('Cadastro de tarólogos (/tarologos-cadastro)');
  const ficha = (extra = {}) => ({
    professionalName: 'Cadastro Novo', fullName: 'Nome Completo', birthDate: '1991-03-04', cpf: '529.982.247-25', phone: '(11) 91234-5678', email: 'novo@exemplo.com',
    bank: { pix: 'novo@exemplo.com' }, paymentMethods: ['pix'], biography: 'Apresentação', oracles: ['Tarot'], weeklySchedule: { segunda: '9 às 12' }, ...extra,
  });
  const chaveEnvio = () => `${'k'.repeat(10)}${Date.now()}${n.i = (n.i || 0) + 1}`.slice(0, 40).padEnd(16, 'x');
  let enviada; let enviadaChave;
  await passo('envio público (sem sessão): 200 pending; a mesma chave repete o recibo; a mesma chave com outros dados é 409', async () => {
    sessao = { userId: 'x', role: 'atendente', displayName: 'Qualquer' };
    enviadaChave = chaveEnvio();
    enviada = await chamar('POST', '/tarologos-cadastro', { data: ficha(), idempotencyKey: enviadaChave });
    assert.equal(enviada.status, 200, enviada.t); assert.equal(enviada.j.status, 'pending'); assert.ok(enviada.j.id);
    const rep = await chamar('POST', '/tarologos-cadastro', { data: ficha(), idempotencyKey: enviadaChave });
    assert.equal(rep.status, 200); assert.equal(rep.j.id, enviada.j.id); assert.equal(rep.j.receivedAt, enviada.j.receivedAt);
    const outro = await chamar('POST', '/tarologos-cadastro', { data: ficha({ professionalName: 'Outro' }), idempotencyKey: enviadaChave });
    assert.equal(outro.status, 409); assert.match(outro.j.error, /já foi utilizado com outros dados/);
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_cadastros_tarologo'), 1);
  });
  await passo('envio público não aceita aprovação, vínculo, repasse; chave curta; dados sem CPF', async () => {
    assert.equal((await chamar('POST', '/tarologos-cadastro', { data: ficha(), idempotencyKey: chaveEnvio(), status: 'approved' })).status, 400);
    const k = await chamar('POST', '/tarologos-cadastro', { data: ficha(), idempotencyKey: 'curta' }); assert.equal(k.status, 400);
    const c = await chamar('POST', '/tarologos-cadastro', { data: ficha({ cpf: '' }), idempotencyKey: chaveEnvio() });
    assert.equal(c.status, 400); assert.equal(c.j.error, 'Informe CPF.');
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_cadastros_tarologo'), 1);
  });
  como('administradora');
  await passo('gestão: lista e ficha; quem não é administradora leva 403 com needsSignIn false; sem escrita: 503 com o texto do front', async () => {
    const l = await chamar('GET', '/tarologos-cadastro');
    assert.equal(l.status, 200, l.t); assert.equal(l.j.records.length, 1);
    assert.deepEqual(Object.keys(l.j.records[0]).sort(), ['createdAt', 'email', 'fullName', 'id', 'professionalName', 'revision', 'status', 'updatedAt']);
    const f = await chamar('GET', `/tarologos-cadastro?id=${enviada.j.id}`);
    assert.equal(f.j.record.status, 'pending'); assert.equal(f.j.record.data.weeklySchedule.segunda, '9h às 12h'); assert.equal(f.j.record.updatedBy, 'public-form');
    assert.equal((await chamar('GET', '/tarologos-cadastro?id=nao-existe')).status, 404);
    assert.equal((await chamar('GET', '/tarologos-cadastro?tarotId=9001')).j.record, null);
    como('atendente');
    const neg = await chamar('GET', '/tarologos-cadastro'); assert.equal(neg.status, 403); assert.equal(neg.j.needsSignIn, false);
    como('administradora');
  });
  let aprovada;
  await passo('aprovar: PUT com revisão 1 e tarotId -> 200 approved, perfil público, e o tarólogo entra no catálogo (mesma transação, auditado)', async () => {
    const id = enviada.j.id;
    const sem = await chamar('PUT', '/tarologos-cadastro', { id, revision: 1, status: 'approved', data: ficha(), tarotId: '' });
    assert.equal(sem.status, 400); assert.match(sem.j.error, /Vincule um identificador profissional válido/);
    aprovada = await chamar('PUT', '/tarologos-cadastro', { id, revision: 1, status: 'approved', tarotId: 'tarot-cadastro-1', data: ficha({ commissionRate: 35 }) });
    assert.equal(aprovada.status, 200, aprovada.t);
    assert.equal(aprovada.j.record.status, 'approved'); assert.equal(aprovada.j.record.revision, 2); assert.equal(aprovada.j.publicProfile.tarotId, 'tarot-cadastro-1');
    assert.equal(aprovada.j.record.approvedData.commissionRate, 35);
    const cat = await lerCatalogo();
    const novo = item(cat, 'tarot-cadastro-1');
    assert.ok(novo, 'entrou no catálogo'); assert.equal(novo.name, 'Cadastro Novo'); assert.equal(novo.legacyId, null);
    assert.equal(novo.profile.registrationId, id); assert.equal(novo.profile.registrationRevision, 2); assert.equal(novo.directory.biography, 'Apresentação');
    assert.deepEqual(novo.profile.official, ['Segunda: 9h às 12h']);
    const ap = await chamar('GET', '/tarologos-cadastro?approved=1');
    assert.equal(ap.j.profiles.length, 1); assert.equal(ap.j.profiles[0].registrationId, id); assert.equal(ap.j.profiles[0].commissionRate, 35);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'cadastros.tarologo.aprovar'"), 1);
  });
  await passo('conflitos da ficha: revisão velha 409; vínculo não troca (409); mesmo tarotId em outra ficha (409); criar com revisão ≠ 0 (409)', async () => {
    const id = enviada.j.id;
    const velha = await chamar('PUT', '/tarologos-cadastro', { id, revision: 1, status: 'pending', tarotId: 'tarot-cadastro-1', data: ficha() });
    assert.equal(velha.status, 409); assert.match(velha.j.error, /O cadastro mudou desde sua abertura/);
    const troca = await chamar('PUT', '/tarologos-cadastro', { id, revision: 2, status: 'approved', tarotId: 'tarot-outro', data: ficha() });
    assert.equal(troca.status, 409); assert.match(troca.j.error, /vínculo profissional desta ficha não pode ser substituído/);
    const dup = await chamar('PUT', '/tarologos-cadastro', { id: 'outra-ficha', revision: 0, status: 'approved', tarotId: 'tarot-cadastro-1', data: ficha() });
    assert.equal(dup.status, 409); assert.match(dup.j.error, /Já existe um cadastro para esta profissional/);
    assert.equal((await chamar('PUT', '/tarologos-cadastro', { id: 'nova-ficha', revision: 3, status: 'pending', data: ficha() })).status, 409);
    const nova = await chamar('PUT', '/tarologos-cadastro', { id: 'nova-ficha', revision: 0, status: 'pending', data: ficha({ professionalName: 'Criada pela gestão' }) });
    assert.equal(nova.status, 200); assert.equal(nova.j.record.revision, 1); assert.equal(nova.j.record.updatedBy.includes('Teste'), true, nova.j.record.updatedBy);
  });
  let link;
  await passo('link individual: só a administradora cria; revisão errada 409; o link mostra a ficha SEM repasse; o envio atualiza e consome o link', async () => {
    const id = enviada.j.id;
    como('atendente');
    assert.equal((await chamar('POST', '/tarologos-cadastro', { action: 'create-update-link', id, revision: 2 })).status, 403);
    como('administradora');
    assert.equal((await chamar('POST', '/tarologos-cadastro', { action: 'create-update-link', id, revision: 1 })).status, 409);
    assert.equal((await chamar('POST', '/tarologos-cadastro', { action: 'create-update-link', id, revision: -1 })).status, 400);
    link = await chamar('POST', '/tarologos-cadastro', { action: 'create-update-link', id, revision: 2 });
    assert.equal(link.status, 200, link.t); assert.match(link.j.url, /\/form-tarologo\?token=[a-f0-9]{64}$/);
    const token = link.j.url.split('token=')[1];
    sessao = { userId: 'x', role: 'atendente', displayName: 'Qualquer' };
    const v = await chamar('GET', `/tarologos-cadastro?token=${token}`);
    assert.equal(v.status, 200, v.t); assert.equal(v.j.valid, true); assert.equal(v.j.professionalName, 'Cadastro Novo');
    assert.ok(!('commissionRate' in v.j.data) && !('paymentSchedule' in v.j.data));
    const k = chaveEnvio();
    const env = await chamar('POST', '/tarologos-cadastro', { data: ficha({ biography: 'Bio pelo link' }), token, idempotencyKey: k });
    assert.equal(env.status, 200, env.t); assert.equal(env.j.id, id);
    como('administradora');
    const f = await chamar('GET', `/tarologos-cadastro?id=${id}`);
    assert.equal(f.j.record.status, 'pending'); assert.equal(f.j.record.revision, 3); assert.equal(f.j.record.data.biography, 'Bio pelo link');
    assert.equal(f.j.record.data.commissionRate, 35, 'o repasse não vem do link');
    assert.equal(f.j.record.approvedData.biography, 'Apresentação', 'a aprovada anterior fica até nova aprovação');
    sessao = { userId: 'x', role: 'atendente', displayName: 'Qualquer' };
    assert.equal((await chamar('GET', `/tarologos-cadastro?token=${token}`)).status, 410);
    assert.equal((await chamar('POST', '/tarologos-cadastro', { data: ficha(), token, idempotencyKey: chaveEnvio() })).status, 410);
    assert.equal((await chamar('POST', '/tarologos-cadastro', { data: ficha({ biography: 'Bio pelo link' }), token, idempotencyKey: k })).status, 200, 'o mesmo envio repete o recibo');
    como('administradora');
  });
  await passo('o catálogo só muda quando a gestão aprova de novo (envio pelo link não toca o perfil)', async () => {
    assert.equal(item(await lerCatalogo(), 'tarot-cadastro-1').directory.biography, 'Apresentação');
  });
  await passo('escrita desligada: PUT e envio público respondem 503 com o texto do front; a leitura segue', async () => {
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
    try {
      const x = await chamar('PUT', '/tarologos-cadastro', { id: 'x1', revision: 0, status: 'pending', data: ficha() });
      assert.equal(x.status, 503); assert.match(x.j.error, /Seu rascunho foi mantido/);
      assert.equal((await chamar('POST', '/tarologos-cadastro', { data: ficha(), idempotencyKey: chaveEnvio() })).status, 503);
      assert.equal((await chamar('GET', '/tarologos-cadastro')).status, 200);
      assert.equal((await perfil('9001', { expectedRevision: 0, name: 'Z' })).j.error.code, 'WRITE_DISABLED');
    } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
  });

  console.log('Extensão de cliente');
  await passo('PATCH (atendente): Pré/Pós e identidade gravados em gf_clientes_ext; GET devolve; carimbo só muda quando o Pré/Pós muda', async () => {
    como('atendente');
    const a = await chamar('PATCH', '/catalog/clients/900013', { operationKey: n(), expectedRevision: 0, changes: { paymentProfile: 'Pré-pago', treatAs: 'Má', birthDate: '04/03/1991' } });
    assert.equal(a.status, 200, a.t);
    assert.equal(a.j.extension.paymentProfile, 'Pré-pago'); assert.equal(a.j.extension.revision, 1); assert.ok(a.j.extension.paymentProfileUpdatedAt);
    const b = await chamar('PATCH', '/catalog/clients/900013', { operationKey: n(), expectedRevision: 1, changes: { whatsapp: '11 90000-0000' } });
    assert.equal(b.status, 200); assert.equal(b.j.extension.revision, 2); assert.equal(b.j.extension.treatAs, 'Má', 'o omitido é preservado');
    assert.equal(b.j.extension.paymentProfileUpdatedAt, a.j.extension.paymentProfileUpdatedAt);
    const g = await chamar('GET', '/catalog/clients?ids=900013,900014');
    assert.equal(g.status, 200); assert.deepEqual(Object.keys(g.j.extensions), ['900013']); assert.equal(g.j.extensions['900013'].whatsapp, '11 90000-0000');
  });
  await passo('cliente: revisão velha 409, mesma chave repete, outro corpo na chave 409, inexistente 404, regra 422, taróloga 403, auditoria', async () => {
    const velha = await chamar('PATCH', '/catalog/clients/900013', { operationKey: n(), expectedRevision: 1, changes: { name: 'X' } });
    assert.equal(velha.status, 409); assert.equal(velha.j.error.code, 'VERSION_CHANGED'); assert.equal(velha.j.error.message, 'Este cadastro mudou. Feche e abra novamente para conferir.'); // texto do front (real-client-file-api.ts)
    const k = n();
    const um = await chamar('PATCH', '/catalog/clients/900014', { operationKey: k, expectedRevision: 0, changes: { name: 'Ana' } });
    assert.equal(um.status, 200);
    assert.equal((await chamar('PATCH', '/catalog/clients/900014', { operationKey: k, expectedRevision: 0, changes: { name: 'Ana' } })).j.extension.revision, 1);
    assert.equal((await chamar('PATCH', '/catalog/clients/900014', { operationKey: k, expectedRevision: 0, changes: { name: 'Bia' } })).j.error.code, 'OPERATION_KEY_CONFLICT');
    const nao = await chamar('PATCH', '/catalog/clients/999999', { operationKey: n(), expectedRevision: 0, changes: { name: 'X' } });
    assert.equal(nao.status, 404); assert.equal(nao.j.error.code, 'CLIENT_NOT_FOUND');
    assert.equal((await chamar('PATCH', '/catalog/clients/900014', { operationKey: n(), expectedRevision: 1, changes: { name: 'x'.repeat(51) } })).status, 422);
    assert.equal((await chamar('PATCH', '/catalog/clients/0123', { operationKey: n(), expectedRevision: 0, changes: { name: 'X' } })).status, 400);
    como('tarologa', { tarotId: '9001' });
    assert.equal((await chamar('PATCH', '/catalog/clients/900014', { operationKey: n(), expectedRevision: 1, changes: { name: 'X' } })).status, 403);
    assert.equal((await chamar('GET', '/catalog/clients?ids=900013')).status, 403);
    assert.ok(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'cadastros.cliente.editar'") >= 3);
  });

  console.log('Auditoria e legado');
  como('administradora');
  await passo('toda gravação deixou auditoria e gf_operacoes bate com a auditoria de perfil/conta/cliente', async () => {
    const aud = await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao IN ('cadastros.tarologo.perfil','cadastros.tarologo.conta','cadastros.cliente.editar')");
    const ops = await contar("SELECT COUNT(*) AS n FROM gf_operacoes WHERE escopo LIKE 'cadastros.%'");
    assert.equal(aud, ops);
    const [l] = await sequelize.query("SELECT DISTINCT ator_funcao FROM gf_auditoria WHERE acao LIKE 'cadastros.%'");
    assert.ok(l.every((x) => ['administradora', 'atendente', 'tarologa'].includes(x.ator_funcao)));
  });
  await passo('fatia desligada em tempo de execução: 404 no catálogo e /tarologos-cadastro volta ao 503 da rota pública', async () => {
    process.env.GF_FATIA_CADASTROS = 'false';
    try {
      assert.equal((await lerCatalogo()).status, 404);
      assert.equal((await chamar('GET', '/tarologos-cadastro')).status, 503);
    } finally { process.env.GF_FATIA_CADASTROS = 'true'; }
  });
  await passo('nada foi pedido ao MySQL legado: tudo passou com o legado NÃO configurado e a escrita no legado desligada', async () => {
    assert.equal(`${process.env.LEGADO_DB_HOST || ''}`, ''); assert.equal(`${process.env.LEGADO_DB_NAME || ''}`, '');
    assert.notEqual(process.env.GF_LEGADO_ESCRITA_ENABLED, 'true');
  });

  console.log('Serviço do cadastro (ouro do registration-service do front, Maturacao/44)');
  await require('../apoio-gf-regras-b/servico-filho').rodarServico({ chamar, como, sequelize, passo, assert });

  srv.close();
  await sequelize.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres: ${ok} ok, ${falhas.length} falhas`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
