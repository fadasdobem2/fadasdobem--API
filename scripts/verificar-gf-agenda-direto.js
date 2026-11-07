'use strict';

/**
 * Verificação do agendamento direto, do rótulo da cliente e do fechamento de turno da Agenda (Maturacao/56, grupo C: C1, C2, C3).
 *   1) OFFLINE (sempre): domínio contra o OURO gerado do código real do front (scripts/gerar-ouro-gf-agenda-direto.js: 600 agendamentos,
 *      160 turnos), regras só do servidor com a frase do front, e MUTANTES (cada um muda uma regra do domínio e tem de ser pego pelo ouro,
 *      com a frase do front na divergência).
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): `fdb_agd_<aleatório>`, scripts/apoio-gf-agenda/filho-direto.js (HTTP do gate: recusas com a
 *      frase do front, aviso que continua aviso, idempotência, versão, auditoria, rótulo do servidor, turno do servidor). Apaga o banco no fim.
 *   node scripts/verificar-gf-agenda-direto.js [--offline]
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Module = require('module');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const raiz = path.join(__dirname, '..');
const r = (p) => require(path.join(raiz, p));
let ok = 0;
const falhas = [];
async function passo(nome, fn) {
  try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 300)}`); }
}
const DOMINIO = 'src/gestao-fadas/_comum/dominio';

/** Carrega um arquivo do domínio com UMA troca de texto (mutante); a troca tem de existir. */
function mutante(arquivo, de, para) {
  const f = path.join(raiz, arquivo);
  const fonte = fs.readFileSync(f, 'utf8');
  assert.ok(fonte.includes(de), `o texto do mutante não existe em ${arquivo}: ${de}`);
  const m = new Module(f, module);
  m.filename = f; m.paths = Module._nodeModulePaths(path.dirname(f));
  m._compile(fonte.replace(de, para), f);
  return m.exports;
}

const entradaDe = (c) => ({ agenda: c.agenda, consultations: c.consultas, profiles: [c.perfil], intakeEvents: c.eventos, restrictions: c.restricoes, now: c.now, date: c.hoje, contacts: c.contatos || [], exigirModalidade: Boolean(c.exigirModalidade) });
const pedidoDe = (c) => ({ antes: c.antes || undefined, id: 'ag-1', solicitacao: c.pedido || undefined, tarologoDesconhecido: false,
  depois: { clientId: c.form.clientId, leadId: c.form.leadId, channel: c.form.channel, requestedMinutes: c.form.requestedMinutes, tarotId: c.form.tarotId, date: c.form.date, standbyDate: c.form.standbyDate, scheduledTime: c.form.scheduledTime, contactPlan: c.plano } });
function mensagemDireta(modulo, c) {
  try { modulo.validarAgendamentoDireto(entradaDe(c), pedidoDe(c)); return ''; } catch (e) { return e.message; }
}
const comparaTurno = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
const primeiraDivergencia = (modulo, ouro) => ouro.direto.find((c) => mensagemDireta(modulo, c) !== c.esperado);

async function offline() {
  const ouro = require('./apoio-gf-agenda/ouro-agenda-direto.json');
  const direto = r(`${DOMINIO}/agenda-agendamento-direto`);
  const fech = r(`${DOMINIO}/agenda-fechamento`);

  console.log('Ouro do front: agendamento direto (submitSchedule)');
  await passo('1500 casos: a primeira recusa sai IGUAL à do front (mesma frase, mesma ordem)', () => {
    const c = primeiraDivergencia(direto, ouro);
    assert.equal(c, undefined, c && `esperado "${c.esperado}", saiu "${mensagemDireta(direto, c)}"`);
  });
  await passo('o ouro cobre as recusas do front: identidade, restrição, horário, agenda fechada (4 formas), cadastro inativo, solicitação, Se der hoje, consulta em curso, próximo turno', () => {
    const msgs = new Set(ouro.direto.map((c) => c.esperado));
    for (const trecho of ['A identificação deste agendamento mudou', 'Selecione uma cliente ou um contato', 'Localize a cliente ou informe', 'Este contato mudou', 'Complete o WhatsApp do contato', 'Este contato já tem agendamento', 'Escolha um meio de consulta válido', 'Informe os minutos solicitados', 'Indisponível', 'Digite um horário válido', 'Agenda fechada neste turno', 'Agenda fechada, inclusive para encaixes', 'Agenda fechada para novos agendamentos hoje', 'O turno de retorno terminou',
      'Escolha um horário entre o retorno', 'cadastro inativo', 'Esta solicitação pertence', 'Esta solicitação já tem', 'Se der hoje pertence', 'Finalize a consulta em andamento', 'próximo turno', '']) {
      assert.ok([...msgs].some((m) => m.includes(trecho) || (trecho === '' && m === '')), `o ouro não tem: ${trecho}`);
    }
  });

  console.log('Ouro do front: turno vigente (currentClosurePeriod)');
  await passo('160 turnos: início, fim e instantes saem IGUAIS ao front (com e sem turno vigente)', () => {
    ouro.turno.forEach((c, i) => assert.ok(comparaTurno(fech.turnoVigente(c.perfil, c.excecoes, c.data, c.now), c.esperado), `caso ${i}: esperado ${JSON.stringify(c.esperado)}, saiu ${JSON.stringify(fech.turnoVigente(c.perfil, c.excecoes, c.data, c.now))}`));
    assert.ok(ouro.turno.some((c) => c.esperado) && ouro.turno.some((c) => !c.esperado));
  });

  console.log('Mutantes: o ouro tem de pegar cada troca de regra');
  const D = `${DOMINIO}/agenda-agendamento-direto.js`;
  const mutantes = [
    ['sem a checagem de identidade da edição', D, '(antes && !mesmaIdentidade(antes, identidade) ?', '(false ?'],
    ['identidade sem exigir cliente OU contato', D, 'erroDeIdentidade(identidade, entrada.contacts) ||', ''],
    ['minutos pedidos sem a checagem', D, 'if (minutos) recusar(minutos);', ''],
    ['meio de consulta sem a checagem', D, 'entrada.exigirModalidade && !MODALIDADES.includes(depois.channel)', 'false'],
    ['contato sem WhatsApp completo aceito', D, "recusar('Complete o WhatsApp do contato, com DDD e número.')", ''],
    ['contato já agendado na data aceito', D, "if (!antes && depois.leadId &&", 'if (false && depois.leadId &&'],
    ['solicitação sem conferir a identidade (só cliente)', D, '!mesmaIdentidade(identidadeDoPedido(pedido), identidade)', 'pedido.clientId !== clientId'],
    ['restrição ignorada', D, 'estaRestrita(entrada.restrictions || [], clientId, depois.tarotId)', 'false'],
    ['restrição também sem mudança de alvo', D, 'if ((!antes || antes.clientId !== clientId || antes.tarotId !== depois.tarotId || (antes.date || hoje) !== data) && estaRestrita', 'if (estaRestrita'],
    ['frase "Indisponivel" sem acento', D, "recusar('Indisponível')", "recusar('Indisponivel')"],
    ['horário marcado aceita 24h', D, '/^([01]\\d|2[0-3]):[0-5]\\d$/', '/^([01]\\d|2[0-4]):[0-5]\\d$/'],
    ['admissão ignora o "se der hoje"', D, 'depois.standbyDate || data, entrada.now)', 'data, entrada.now)'],
    ['cadastro inativo ignorado', D, 'adm.erroDeAdmissaoPorPresenca(perfil, antes, alvo)', "''"],
    ['solicitação de outro tarólogo aceita', D, '(!antes && pedido.tarotId !== depois.tarotId)', 'false'],
    ['"Se der hoje" aceita outro dia', D, 'depois.standbyDate && depois.standbyDate !== data', 'false'],
    ['consulta em curso ignorada', D, "c.status === 'Em curso'", "c.status === 'Concluída'"],
    ['próximo turno aceita data de hoje passada (<=)', D, 'data < hoje) recusar', 'data <= hoje) recusar'],
    ['próximo turno sem a checagem', D, 'if (mudaDestino && proximoTurno && data < hoje)', 'if (false)'],
    ['edição sem mudar o destino também exige', D, 'if (!antes) return;', 'if (!antes) return; if (antes) return;'],
  ];
  for (const [nome, arq, de, para] of mutantes) {
    await passo(`mutante refutado: ${nome}`, () => {
      const m = mutante(arq, de, para);
      const c = primeiraDivergencia(m, ouro);
      assert.ok(c, 'o ouro não pegou o mutante');
      console.log(`        pego: esperado "${c.esperado || '(sem recusa)'}"`);
    });
  }
  const F = `${DOMINIO}/agenda-fechamento.js`;
  for (const [nome, de, para] of [
    ['turno com início exclusivo', 'p.startsAt <= agora && p.endsAt > agora', 'p.startsAt < agora && p.endsAt > agora'],
    ['turno com fim inclusivo', 'p.startsAt <= agora && p.endsAt > agora', 'p.startsAt <= agora && p.endsAt >= agora'],
    ['sem a janela explícita da presença', 'if (explicito) {', 'if (false) {'],
    ['janela confirmada de outro dia vale', 'confirmado && confirmado.date === data ? confirmado', 'confirmado ? confirmado'],
  ]) {
    await passo(`mutante refutado: ${nome}`, () => {
      const m = mutante(F, de, para);
      const c = ouro.turno.find((x) => !comparaTurno(m.turnoVigente(x.perfil, x.excecoes, x.data, x.now), x.esperado));
      assert.ok(c, 'o ouro não pegou o mutante');
    });
  }

  console.log('Regras só do servidor (o front não as tem como bloqueio)');
  const base = ouro.direto.find((c) => c.esperado === '' && !c.antes);
  const ctx = { ...base, restricoes: [], eventos: [], pedido: null, form: { ...base.form, standbyDate: undefined, scheduledTime: '' }, perfil: { ...base.perfil, registrationActive: true } };
  await passo('tarólogo fora do cadastro: "Selecione um tarólogo ativo." (frase de validateGeneralDestination)', () => {
    assert.throws(() => direto.validarAgendamentoDireto(entradaDe(ctx), { ...pedidoDe(ctx), tarologoDesconhecido: true }), (e) => e.message === 'Selecione um tarólogo ativo.');
    assert.equal(mensagemDireta(direto, ctx), '');
  });
  await passo('cobertura: valor de dinheiro vindo do navegador é recusado; paymentPending só no agendamento novo; edição só repete o gravado', () => {
    const recusa = (antes, set) => { try { direto.conferirCobertura(antes, set); return ''; } catch (e) { return e.message; } };
    assert.equal(recusa(undefined, { paymentPending: true }), '');
    assert.equal(recusa(undefined, { paymentPending: false }), '');
    assert.equal(recusa(undefined, { paymentAmount: 10 }), 'Confira os dados informados e tente novamente.');
    assert.equal(recusa(undefined, { paymentExpectedAmount: 10 }), 'Confira os dados informados e tente novamente.');
    assert.equal(recusa(undefined, { unlinkedPaymentAmount: 10 }), 'Confira os dados informados e tente novamente.');
    assert.equal(recusa({ paymentPending: true }, { paymentPending: true }), '');
    assert.equal(recusa({ paymentPending: true }, { paymentPending: false }), 'Confira os dados informados e tente novamente.');
    assert.equal(recusa({}, { paymentAmount: 5 }), 'Confira os dados informados e tente novamente.');
    assert.equal(recusa({ paymentAmount: 5 }, { paymentAmount: 5 }), '');
    assert.equal(recusa({}, { observation: 'x' }), '');
  });
}

async function comBanco() {
  const banco = pg.nomeBanco('agd');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-agenda', 'filho-direto.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_agd_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_agd_* restante).');
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
