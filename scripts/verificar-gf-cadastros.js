'use strict';

/**
 * Verificação da fatia Cadastros (catálogo de tarólogos, Cadastro de tarólogos e extensão de cliente; Maturacao/29 seção 9).
 *   1) OFFLINE (sempre): domínio puro (validação do cadastro com as mensagens do front, projeções, catálogo), validação de cliente,
 *      flag da fatia, gate desligado = 404 (e `/tarologos-cadastro` segue 503), 401 sem sessão, 405 com Allow, formato de erro.
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): cria `fdb_cad_<aleatório>` em localhost:5432, migra por run-migrations, roda
 *      scripts/apoio-gf-cadastros/filho.js (HTTP do gate, idempotência, 409, auditoria, perfis, link e envio público) e apaga o banco.
 *      DB_* só no ambiente dos filhos; nunca lê o .env nem toca em outro banco. O legado MySQL nem é configurado.
 *   npm run verificar:gf-cadastros            (completo)       node scripts/verificar-gf-cadastros.js --offline   (sem banco; entra em verificar:legado)
 */

const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const express = require('express');
const pg = require('./apoio-esquema/pg');

const raiz = path.join(__dirname, '..');
const r = (p) => require(path.join(raiz, p));
let ok = 0;
const falhas = [];
async function passo(nome, fn) {
  try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 240)}`); }
}
const dizErro = (fn, texto) => assert.throws(fn, (e) => String(e.message).includes(texto), `esperava "${texto}"`);

async function offline() {
  const cad = r('src/gestao-fadas/_comum/dominio/cadastro-tarologo');
  const cat = r('src/gestao-fadas/_comum/dominio/catalogo-tarologos');
  const cli = r('src/gestao-fadas/features/cadastros/clientes.validacao');
  const publico = (extra = {}) => ({
    professionalName: 'Ana Luz', fullName: 'Ana de Souza', birthDate: '1990-05-17', cpf: '529.982.247-25', phone: '(11) 91234-5678', email: 'ana@exemplo.com',
    bank: { pix: 'ana@exemplo.com' }, paymentMethods: ['pix'], ...extra,
  });

  console.log('Domínio: cadastro de tarólogos (mensagens do front)');
  await passo('envio público completo é aceito; repasse fixa em 30 e calendário é nulo', () => {
    const d = cad.validarCadastro(publico(), { publica: true });
    assert.equal(d.commissionRate, 30); assert.equal(d.paymentSchedule, null); assert.equal(d.preferredPaymentMethod, 'pix');
  });
  await passo('campos de repasse, acesso e aprovação no envio público são recusados', () => {
    dizErro(() => cad.validarCadastro(publico({ commissionRate: 50 }), { publica: true }), 'O formulário não pode alterar repasse, acesso ou aprovação.');
    dizErro(() => cad.validarCadastro(publico({ tarotId: 'x' }), { publica: true }), 'O formulário não pode alterar repasse, acesso ou aprovação.');
  });
  await passo('obrigatórios do envio público e mensagens de CPF, e-mail, nascimento, celular, UF e CEP', () => {
    dizErro(() => cad.validarCadastro({ professionalName: '' }), 'Informe o nome profissional.');
    dizErro(() => cad.validarCadastro(publico({ cpf: '' }), { publica: true }), 'Informe CPF.');
    dizErro(() => cad.validarCadastro(publico({ cpf: '111.111.111-11' })), 'Confira o CPF informado.');
    dizErro(() => cad.validarCadastro(publico({ email: 'sem-arroba' })), 'Confira o e-mail informado.');
    dizErro(() => cad.validarCadastro(publico({ birthDate: '2031-01-01' })), 'Confira a data de nascimento.');
    dizErro(() => cad.validarCadastro(publico({ phone: '123' })), 'Confira os números de celular.');
    dizErro(() => cad.validarCadastro(publico({ address: { state: 'SPP' } })), 'Informe a UF com duas letras.');
    dizErro(() => cad.validarCadastro(publico({ address: { postalCode: '123' } })), 'Confira o CEP informado.');
    dizErro(() => cad.validarCadastro(publico({ bank: {}, paymentMethods: [] }), { publica: true }), 'Selecione Pix ou conta bancária para recebimento.');
    dizErro(() => cad.validarCadastro(publico({ paymentMethods: ['pix', 'bank'], bank: { pix: 'x' } }), { publica: true }), 'Informe banco, agência e conta ou desmarque essa forma de recebimento.');
  });
  await passo('horário semanal é normalizado como o front e o inválido recebe a mensagem do dia', () => {
    const d = cad.validarCadastro(publico({ weeklySchedule: { segunda: '9 às 12 e 14 às 18', terca: 'Folga', quarta: '22h às 6h' } }));
    assert.equal(d.weeklySchedule.segunda, '9h às 12h · 14h às 18h'); assert.equal(d.weeklySchedule.terca, 'Folga'); assert.equal(d.weeklySchedule.quarta, '22h às 6h');
    dizErro(() => cad.validarCadastro(publico({ weeklySchedule: { quinta: 'qualquer coisa' } })), 'Confira os horários de quinta.');
    dizErro(() => cad.validarCadastro(publico({ weeklySchedule: { sexta: '15h às 9h' } })), 'Confira os horários de sexta.');
  });
  await passo('canais, competências, percentual e calendário de pagamento (edição da gestão)', () => {
    dizErro(() => cad.validarCadastro(publico({ channels: ['Zap'] })), 'Os canais disponíveis são Chat e Voz.');
    dizErro(() => cad.validarCadastro(publico({ capabilityGroups: { outro: [] } })), 'Grupo de competências inválido.');
    dizErro(() => cad.validarCadastro(publico({ capabilityGroups: { tarot: ['a'] }, capabilityNone: ['tarot'] })), 'Confira as competências');
    dizErro(() => cad.validarCadastro(publico({ commissionRate: 101 })), 'O percentual de repasse deve ficar entre 0 e 100');
    assert.deepEqual(cad.validarCadastro(publico({ commissionRate: 32.5, paymentSchedule: { kind: 'monthdays', days: [20, 5], weekendPolicy: 'keep' } })).paymentSchedule, { kind: 'monthdays', days: [5, 20], weekendPolicy: 'keep' });
    dizErro(() => cad.validarCadastro(publico({ paymentSchedule: { kind: 'weekday', weekday: 'segunda-feira' } })), 'Confira o calendário de pagamento.');
  });
  await passo('foto: só PNG/JPEG/WebP em data URL, caminho local ou HTTPS; orçamento de fotos', () => {
    dizErro(() => cad.validarCadastro(publico({ avatar: 'http://x/y.png' })), 'Use uma foto PNG, JPEG ou WebP');
    cad.validarCadastro(publico({ avatar: 'https://exemplo.com/a.png' }));
    cad.validarCadastro(publico({ avatar: '/avatars/tarologos/ana.png' }));
    dizErro(() => cad.validarCadastro(publico({ gallery: Array(5).fill('https://exemplo.com/a.png') })), 'Inclua até quatro fotos adicionais.');
  });
  await passo('projeções: perfil público, link individual (lista branca) e ficha aprovada', () => {
    const d = cad.validarCadastro(publico({ commissionRate: 40, biography: 'Oi', oracles: ['Tarot'] }));
    const p = cad.perfilPublico(d, '9005');
    assert.deepEqual(Object.keys(p).sort(), ['avatar', 'biography', 'channels', 'definitions', 'equipment', 'gallery', 'oracles', 'portrait', 'professionalName', 'spreads', 'tarotId', 'techniques', 'themes', 'weeklySchedule']);
    const l = cad.projecaoDoLink(d);
    assert.ok(!('commissionRate' in l) && !('paymentSchedule' in l) && l.fullName === 'Ana de Souza');
    const a = cad.projecaoAprovada({ id: 'f1', revisao: 3, dados: d, tarotId: '9005' });
    assert.equal(a.registrationId, 'f1'); assert.equal(a.revision, 3); assert.equal(a.commissionRate, 40); assert.equal(a.tarotId, '9005');
  });

  console.log('Domínio: catálogo de tarólogos');
  await passo('item do legado puro: id é o idTarologo; inativo no legado vira cadastro inativo; nome ausente não some', () => {
    const a = cat.montarItem({ legado: { idTarologo: 9001, nmuTarologo: ' Ana ', ativo: 1 }, perfil: null, ext: null });
    assert.equal(a.id, '9001'); assert.equal(a.name, 'Ana'); assert.equal(a.profile.registrationActive, true); assert.equal(a.revision, 0);
    assert.equal(cat.montarItem({ legado: { idTarologo: 9002, nmuTarologo: 'B', ativo: 0 }, perfil: null, ext: null }).registrationActive, false);
    assert.equal(cat.montarItem({ legado: { idTarologo: 9003, nmuTarologo: null, ativo: null }, perfil: null, ext: null }).name, 'Tarólogo 9003');
  });
  await passo('perfil editado vence o legado; extensão antiga só completa o que falta; privados saem do recorte da equipe', () => {
    const it = cat.montarItem({
      legado: { idTarologo: 9001, nmuTarologo: 'Ana', ativo: 1 },
      perfil: { tarot_id: '9001', nome: 'Ana Luz', avatar: 'https://exemplo.com/a.png', cadastro_ativo: false, perfil: { biography: 'Oi', personalWhatsapp: '11' }, conta_slug: 'ana', registro_id: 'f1', registro_revisao: 2, revisao: 4 },
      ext: { primeiro_nome_civil: 'Ana', personal_whatsapp: '99', avatar_whatsapp: '88', foto_atual_ref: 'x' },
    });
    assert.equal(it.name, 'Ana Luz'); assert.equal(it.registrationActive, false); assert.equal(it.revision, 4); assert.equal(it.accountLinked, true);
    assert.equal(it.directory.personalWhatsapp, '11'); assert.equal(it.directory.avatarWhatsapp, '88'); assert.equal(it.profile.registrationId, 'f1');
    const sem = cat.semPrivados(it.directory);
    assert.ok(!('personalWhatsapp' in sem) && !('realFirstName' in sem) && sem.biography === 'Oi');
  });
  await passo('edição do diretório: só campos conhecidos, listas sem repetição, tipos checados', () => {
    assert.deepEqual(cat.validarDiretorio({ oracles: ['A', 'A', 'B'], inventado: 'x', biography: 'ok' }), { oracles: ['A', 'B'], biography: 'ok' });
    dizErro(() => cat.validarDiretorio({ oracles: 'A' }), 'seleção inválida');
    dizErro(() => cat.validarDiretorio({ capabilityGroups: { x: [] } }), 'Grupo de competências inválido.');
    dizErro(() => cat.validarDiretorio({ biography: 5 }), 'informe um texto');
  });

  console.log('Validação: extensão de cliente (legacy-client-write.ts)');
  await passo('nome 1 a 50, tratar por até 50 (vazio apaga), WhatsApp até 45, nascimento dd/mm/aaaa válido e nunca apagado', () => {
    assert.deepEqual(cli.validarMudancas({ name: ' Maria ', treatAs: '', whatsapp: '11 9', birthDate: '29/02/2024', paymentProfile: 'Pós-pago' }), { name: 'Maria', treatAs: '', whatsapp: '11 9', birthDate: '29/02/2024', paymentProfile: 'Pós-pago' });
    dizErro(() => cli.validarMudancas({ name: '' }), 'preencha este campo');
    dizErro(() => cli.validarMudancas({ name: 'x'.repeat(51) }), 'use até 50 caracteres');
    dizErro(() => cli.validarMudancas({ whatsapp: 'x'.repeat(46) }), 'use até 45 caracteres');
    dizErro(() => cli.validarMudancas({ birthDate: '' }), 'não pode ser apagada');
    dizErro(() => cli.validarMudancas({ birthDate: '30/02/2020' }), 'dd/mm/aaaa');
    dizErro(() => cli.validarMudancas({ name: 'Ana 😀' }), 'quatro bytes');
    dizErro(() => cli.validarMudancas({ paymentProfile: 'Outro' }), 'Selecione Pré ou Pós.');
    dizErro(() => cli.validarMudancas({}), 'Nenhuma alteração');
  });
  await passo('o carimbo do Pré/Pós só muda quando o valor muda; campos omitidos são preservados', () => {
    const a = cli.aplicar(null, { paymentProfile: 'Pré-pago', name: 'A' }, '2026-11-01T10:00:00.000Z');
    assert.equal(a.perfil_pagamento_em, '2026-11-01T10:00:00.000Z');
    const b = cli.aplicar({ ...a, dados: a.dados }, { treatAs: 'Má' }, '2026-11-02T10:00:00.000Z');
    assert.equal(b.perfil_pagamento_em, a.perfil_pagamento_em); assert.equal(b.dados.name, 'A'); assert.equal(b.dados.treatAs, 'Má');
  });

  console.log('Gate');
  const { criarGate } = r('src/gestao-fadas/gate');
  const { cadastrosLigado } = r('src/gestao-fadas/gate/rotas-cadastros');
  let sessao = { status: 'absent' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => sessao }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const origem = `http://127.0.0.1:${srv.address().port}`;
  const chamar = async (metodo, p, corpo, cab = {}) => {
    const resp = await fetch(`${origem}/api${p}`, { method: metodo, headers: { 'content-type': 'application/json', ...cab }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, h: resp.headers };
  };
  const antes = process.env.GF_FATIA_CADASTROS;
  try {
    await passo('flag lida de GF_FATIA_CADASTROS (só "true" liga)', () => {
      assert.equal(cadastrosLigado({ GF_FATIA_CADASTROS: 'true' }), true);
      assert.equal(cadastrosLigado({ GF_FATIA_CADASTROS: '1' }), false);
      assert.equal(cadastrosLigado({}), false);
    });
    delete process.env.GF_FATIA_CADASTROS;
    await passo('desligada: /catalog responde 404 NOT_FOUND antes da sessão e /tarologos-cadastro segue 503 sem texto novo', async () => {
      const a = await chamar('GET', '/catalog/tarologists');
      assert.equal(a.status, 404); assert.equal(a.j.error.code, 'NOT_FOUND'); assert.equal(a.h.get('cache-control'), 'no-store');
      const b = await chamar('GET', '/tarologos-cadastro');
      assert.equal(b.status, 503); assert.match(b.j.error, /não está integrado/);
    });
    process.env.GF_FATIA_CADASTROS = 'true';
    await passo('ligada, sem sessão: 401; método errado: 405 com Allow antes da sessão', async () => {
      const a = await chamar('GET', '/catalog/tarologists');
      assert.equal(a.status, 401); assert.equal(a.j.error.code, 'SESSION_REQUIRED');
      const b = await chamar('POST', '/catalog/tarologists');
      assert.equal(b.status, 405); assert.equal(b.h.get('allow'), 'GET');
      const c = await chamar('GET', '/catalog/clients/123');
      assert.equal(c.status, 405); assert.equal(c.h.get('allow'), 'PATCH');
    });
    await passo('/tarologos-cadastro ligada: sem sessão de administradora a gestão leva 403 com needsSignIn; link inválido é 410; origem errada 403; não-JSON 415', async () => {
      const a = await chamar('GET', '/tarologos-cadastro');
      assert.equal(a.status, 403); assert.equal(a.j.needsSignIn, true); assert.match(a.j.error, /autorização administrativa/);
      const b = await chamar('GET', '/tarologos-cadastro?token=abc');
      assert.equal(b.status, 410); assert.match(b.j.error, /Este link não está disponível/);
      const c = await chamar('POST', '/tarologos-cadastro', { data: {} }, { origin: 'http://outro.exemplo' });
      assert.equal(c.status, 403); assert.equal(c.j.error, 'Origem não autorizada.');
      const d = await fetch(`${origem}/api/tarologos-cadastro`, { method: 'POST', headers: { origin: origem, 'content-type': 'text/plain' }, body: 'x' });
      assert.equal(d.status, 415);
      sessao = { status: 'identity', identity: { userId: 'u', role: 'atendente', displayName: 'A' }, sessionId: 's' };
      const e = await chamar('PUT', '/tarologos-cadastro', { revision: 0, status: 'pending', data: {} }, { origin: origem });
      assert.equal(e.status, 403); assert.equal(e.j.needsSignIn, false);
    });
    await passo('taróloga sem tarotId no catálogo: 403 ACCESS_DENIED; atendente não grava o perfil de tarólogo', async () => {
      sessao = { status: 'identity', identity: { userId: 'u-1', role: 'tarologa', displayName: 'T' }, sessionId: 's1' };
      assert.equal((await chamar('GET', '/catalog/tarologists')).status, 403);
      sessao = { status: 'identity', identity: { userId: 'u-2', role: 'atendente', displayName: 'A' }, sessionId: 's2' };
      const x = await chamar('PUT', '/catalog/tarologists/9001/profile', { operationKey: 'chave-0001', expectedRevision: 0 });
      assert.equal(x.status, 403); assert.equal(x.j.error.code, 'ACCESS_DENIED');
    });
  } finally {
    if (antes === undefined) delete process.env.GF_FATIA_CADASTROS; else process.env.GF_FATIA_CADASTROS = antes;
    srv.close();
  }
}

async function comBanco() {
  const banco = pg.nomeBanco('cad');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-cadastros', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_cad_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_cad_* restante).');
  }
  return codigo;
}

(async () => {
  await offline();
  console.log(`\nOffline: ${ok} ok, ${falhas.length} falhas`);
  if (falhas.length) process.exit(1);
  if (process.argv.includes('--offline')) process.exit(0);
  process.exit(await comBanco());
})().catch((e) => { console.error(e); process.exit(2); });
