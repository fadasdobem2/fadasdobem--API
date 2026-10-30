'use strict';

/**
 * Verificação do financeiro de SAQUES e SESSÕES (F-02, F-08, F-09, F-10, F-14) contra um Postgres LOCAL DESCARTÁVEL.
 * Cria o banco `fdb_fin2_<aleatório>` em localhost, migra pelo caminho oficial (`npm run migrate`),
 * roda os cenários e APAGA o banco no fim. Nunca lê .env nem toca outro banco (DATABASE_URL é zerada no
 * ambiente do processo e o nome do banco é conferido antes de qualquer escrita).
 *
 *   node scripts/verificar-financeiro-saques-sessoes.js
 *
 * Variáveis opcionais: PG_BIN (default /opt/homebrew/bin), PG_HOST (localhost), PG_PORT (5432), PG_USER (usuário do SO).
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const PG_BIN = process.env.PG_BIN || '/opt/homebrew/bin';
const PG_HOST = process.env.PG_HOST || 'localhost';
const PG_PORT = process.env.PG_PORT || '5432';
const PG_USER = process.env.PG_USER || os.userInfo().username;
const DB_NAME = `fdb_fin2_${crypto.randomBytes(4).toString('hex')}`;

const pgArgs = ['-h', PG_HOST, '-p', PG_PORT, '-U', PG_USER];

let ok = 0;
const falhas = [];
async function teste(nome, fn) {
  try {
    await fn();
    ok += 1;
    console.log(`  ok  ${nome}`);
  } catch (e) {
    falhas.push(nome);
    console.log(`  FALHA  ${nome}\n        ${e && e.message ? e.message : e}`);
  }
}

async function rejeita(promise, status, trecho) {
  try {
    await promise;
  } catch (e) {
    if (status) assert.equal(e.statusCode, status, `status esperado ${status}, veio ${e.statusCode}: ${e.message}`);
    if (trecho) assert.ok(`${e.message}`.includes(trecho), `mensagem esperada com "${trecho}": ${e.message}`);
    return e;
  }
  assert.fail('deveria ter sido recusado');
}

function envDoBanco() {
  return {
    ...process.env,
    DATABASE_URL: '',
    DB_HOST: PG_HOST,
    DB_PORT: PG_PORT,
    DB_NAME,
    DB_USER: PG_USER,
    DB_PASSWORD: '',
    DB_SSL: 'false',
    NODE_ENV: 'test',
    SESSION_REQUIRE_MIN_BALANCE: 'true',
  };
}

async function main() {
  execFileSync(path.join(PG_BIN, 'createdb'), [...pgArgs, DB_NAME], { stdio: 'inherit' });
  Object.assign(process.env, envDoBanco());
  let sequelize;
  try {
    const mig = spawnSync('npm', ['run', 'migrate', '--silent'], { cwd: RAIZ, env: envDoBanco(), encoding: 'utf8' });
    assert.equal(mig.status, 0, `npm run migrate falhou: ${mig.stdout}\n${mig.stderr}`);

    ({ sequelize } = require('../src/config/database'));
    const db = require('../src/models');
    const [[cur]] = await sequelize.query('SELECT current_database() AS d');
    assert.equal(cur.d, DB_NAME, 'banco em uso não é o descartável; abortando');

    const { User, Client, Specialist, PricingLevel, LedgerAccount, TransactionLedger, PayoutRequest, Session } = db;
    const payouts = require('../src/features/payouts/payouts.service');
    const adminFin = require('../src/features/admin/services/admin.finance.service');
    const { validatePixKey } = require('../src/features/payouts/payouts.pix');
    const { createSession } = require('../src/features/sessions/sessions.lifecycle');
    const { processOneBillingSession } = require('../src/features/sessions/sessions.billing');
    const { finalizeSessionEconomicsAfterTelecomCompletion } = require('../src/features/sessions/sessions.economics');
    const { reconcileUnsettledCompletedSessions } = require('../src/features/sessions/sessions.reconcile');
    const { refreshBillableMinutesAtClose } = require('../src/features/sessions/sessions.lifecycle');
    const { computeBillableMinutes } = require('../src/features/sessions/sessions.minutes');

    const CPF = '529.982.247-25';
    const rnd = () => crypto.randomUUID().slice(0, 8);

    const pl = await PricingLevel.create({ name: 'Nivel fin2', code: `FIN2-${rnd()}`, price_text_voice: '1.0000', price_video: '1.0000' });

    async function novoUsuario(role) {
      return User.create({
        email: `fin2+${rnd()}@teste.local`,
        password_hash: 'x',
        role,
        is_active: true,
        email_verified_at: new Date(),
        accepted_terms_version: 't',
        accepted_terms_at: new Date(),
      });
    }
    async function novaTarologa(extra = {}) {
      const user = await novoUsuario('TAROLOGA');
      const sp = await Specialist.create({ user_id: user.id, display_name: 'Tarologa Fin2', status: 'ONLINE', is_blocked: false, ...extra });
      return { user, sp };
    }
    async function novoCliente(saldo) {
      const user = await novoUsuario('CLIENTE');
      const client = await Client.create({ user_id: user.id, nome: 'Cliente Fin2', nickname: 'F', pricing_level_id: pl.id });
      const wallet = await LedgerAccount.create({ client_id: client.id, account_type: 'CLIENT_WALLET', currency: 'BRL', cached_balance: saldo });
      return { user, client, wallet };
    }
    const suspenseP = () =>
      LedgerAccount.findOrCreate({
        where: { account_type: 'PLATFORM_SUSPENSE', client_id: null, specialist_id: null },
        defaults: { account_type: 'PLATFORM_SUSPENSE', currency: 'BRL', cached_balance: 0 },
      }).then(([a]) => a);
    /** Ganho de tarólogo com lançamento real (suspense -> earnings), como o fecho de sessão faz. */
    async function darGanho(specialistId, valor) {
      const susp = await suspenseP();
      let acc = await LedgerAccount.findOne({ where: { specialist_id: specialistId, account_type: 'SPECIALIST_EARNINGS' } });
      if (!acc) acc = await LedgerAccount.create({ specialist_id: specialistId, account_type: 'SPECIALIST_EARNINGS', currency: 'BRL', cached_balance: 0 });
      await TransactionLedger.create({
        debit_account_id: susp.id,
        credit_account_id: acc.id,
        amount: valor,
        reference_type: 'COMMISSION_SPLIT',
        idempotency_key: `fin2-ganho-${rnd()}`,
        occurred_at: new Date(),
      });
      await acc.update({ cached_balance: Number(acc.cached_balance) + valor });
      return acc;
    }
    async function liquidoLedger(accId) {
      const [[r]] = await sequelize.query(
        `SELECT COALESCE((SELECT SUM(amount) FROM transaction_ledger WHERE credit_account_id = :a),0)
              - COALESCE((SELECT SUM(amount) FROM transaction_ledger WHERE debit_account_id = :a),0) AS net`,
        { replacements: { a: accId } }
      );
      return Number(r.net);
    }
    const saldo = async (accId) => Number((await LedgerAccount.findByPk(accId)).cached_balance);
    const adminId = (await novoUsuario('GESTORA')).id;
    const ciclo = async (id, ...acoes) => {
      let r;
      for (const st of acoes) r = await adminFin.transitionPayout(adminId, id, st, { external_transfer_id: 'ext-1' });
      return r;
    };

    console.log('Saques (F-02, F-14)');

    await teste('PIX: valida CPF, CNPJ, e-mail, telefone, EVP e recusa inválidos', async () => {
      assert.equal(validatePixKey('cpf', CPF).key, '52998224725');
      assert.equal(validatePixKey(undefined, 'Ana@Ex.com').type, 'EMAIL');
      assert.equal(validatePixKey('PHONE', '(11) 98888-7777').key, '+5511988887777');
      assert.equal(validatePixKey(undefined, crypto.randomUUID()).type, 'EVP');
      assert.equal(validatePixKey('CNPJ', '11.222.333/0001-81').key, '11222333000181');
      for (const [t, k] of [['CPF', '111.111.111-11'], ['CPF', '52998224726'], ['EMAIL', 'sem-arroba'], ['PHONE', '123'], ['EVP', 'abc'], ['PIX', CPF], [undefined, 'lixo!!'], ['CNPJ', '11222333000182']]) {
        assert.throws(() => validatePixKey(t, k), /inv|Informe|reconhecida/i, `${t} ${k}`);
      }
    });

    await teste('saque recusa PIX inválido, valor com 3 casas, zero, negativo e tarólogo bloqueada/não aprovada', async () => {
      const { user, sp } = await novaTarologa();
      await darGanho(sp.id, 100);
      await rejeita(payouts.requestPayout(user.id, { amount: 10, pix_key: '111.111.111-11', pix_type: 'CPF' }), 400);
      await rejeita(payouts.requestPayout(user.id, { amount: 10.001, pix_key: CPF, pix_type: 'CPF' }), 400);
      await rejeita(payouts.requestPayout(user.id, { amount: 0, pix_key: CPF, pix_type: 'CPF' }), 400);
      await rejeita(payouts.requestPayout(user.id, { amount: -5, pix_key: CPF, pix_type: 'CPF' }), 400);
      await rejeita(payouts.requestPayout(user.id, { amount: 'abc', pix_key: CPF, pix_type: 'CPF' }), 400);
      await sp.update({ is_blocked: true });
      await rejeita(payouts.requestPayout(user.id, { amount: 10, pix_key: CPF, pix_type: 'CPF' }), 403);
      await sp.update({ is_blocked: false, registration_approval_status: 'PENDING' });
      await rejeita(payouts.requestPayout(user.id, { amount: 10, pix_key: CPF, pix_type: 'CPF' }), 403);
      assert.equal(await PayoutRequest.count({ where: { specialist_id: sp.id } }), 0);
    });

    await teste('saque acima do disponível é recusado; reserva abate o disponível', async () => {
      const { user, sp } = await novaTarologa();
      await darGanho(sp.id, 100);
      await rejeita(payouts.requestPayout(user.id, { amount: 100.01, pix_key: CPF, pix_type: 'CPF' }), 400, 'insuficiente');
      const a = await payouts.requestPayout(user.id, { amount: 60, pix_key: CPF, pix_type: 'CPF' });
      assert.equal(a.status, 'PENDING');
      assert.equal(a.pix_key, '52998224725');
      await rejeita(payouts.requestPayout(user.id, { amount: 40.01, pix_key: CPF, pix_type: 'CPF' }), 400, 'insuficiente');
      await payouts.requestPayout(user.id, { amount: 40, pix_key: CPF, pix_type: 'CPF' });
    });

    await teste('saque concorrente do mesmo saldo (Promise.all): só um passa', async () => {
      const { user, sp } = await novaTarologa();
      await darGanho(sp.id, 100);
      const rs = await Promise.allSettled(
        Array.from({ length: 6 }, () => payouts.requestPayout(user.id, { amount: 60, pix_key: CPF, pix_type: 'CPF' }))
      );
      assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(await PayoutRequest.count({ where: { specialist_id: sp.id } }), 1);
    });

    await teste('saque concorrente sem conta de ganhos prévia: todos recusados e no máximo uma conta criada', async () => {
      const { user, sp } = await novaTarologa();
      const rs = await Promise.allSettled(
        Array.from({ length: 4 }, () => payouts.requestPayout(user.id, { amount: 1, pix_key: CPF, pix_type: 'CPF' }))
      );
      assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 0);
      assert.ok((await LedgerAccount.count({ where: { specialist_id: sp.id, account_type: 'SPECIALIST_EARNINGS' } })) <= 1);
    });

    await teste('saque pago debita o ganho, cria PAYOUT e o razão fecha; novo saque do mesmo ganho é recusado', async () => {
      const { user, sp } = await novaTarologa();
      const acc = await darGanho(sp.id, 100);
      const p = await payouts.requestPayout(user.id, { amount: 100, pix_key: CPF, pix_type: 'CPF' });
      await rejeita(adminFin.transitionPayout(adminId, p.id, 'PAID', {}), 409, 'Transição inválida');
      assert.equal(await saldo(acc.id), 100, 'PENDING->PAID recusado não pode mexer no saldo');
      const r = await ciclo(p.id, 'APPROVED', 'PROCESSING', 'PAID');
      assert.equal(r.status, 'PAID');
      assert.ok(r.ledger_id);
      assert.equal(await saldo(acc.id), 0);
      assert.equal(await liquidoLedger(acc.id), 0, 'razão da conta de ganhos fecha em 0');
      const led = await TransactionLedger.findAll({ where: { reference_type: 'PAYOUT', reference_id: p.id } });
      assert.equal(led.length, 1);
      assert.equal(Number(led[0].amount), 100);
      assert.equal(led[0].debit_account_id, acc.id);
      const clr = await LedgerAccount.findByPk(led[0].credit_account_id);
      assert.equal(clr.account_type, 'PLATFORM_PAYOUT_CLEARING');
      await rejeita(adminFin.markPayoutAsPaid(adminId, p.id, {}), 409);
      assert.equal(await TransactionLedger.count({ where: { reference_type: 'PAYOUT', reference_id: p.id } }), 1);
      await rejeita(payouts.requestPayout(user.id, { amount: 100, pix_key: CPF, pix_type: 'CPF' }), 400, 'insuficiente');
      await rejeita(payouts.requestPayout(user.id, { amount: 0.01, pix_key: CPF, pix_type: 'CPF' }), 400, 'insuficiente');
    });

    await teste('marcar PAGO duas vezes em paralelo: um passa, o outro 409, um só lançamento', async () => {
      const { user, sp } = await novaTarologa();
      const acc = await darGanho(sp.id, 50);
      const p = await payouts.requestPayout(user.id, { amount: 50, pix_key: CPF, pix_type: 'CPF' });
      await ciclo(p.id, 'APPROVED');
      const rs = await Promise.allSettled([1, 2, 3].map(() => adminFin.markPayoutAsPaid(adminId, p.id, {})));
      assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(await TransactionLedger.count({ where: { reference_type: 'PAYOUT', reference_id: p.id } }), 1);
      assert.equal(await saldo(acc.id), 0);
    });

    await teste('transições inválidas; rejeição exige motivo e libera a reserva; terminais não regridem', async () => {
      const { user, sp } = await novaTarologa();
      const acc = await darGanho(sp.id, 80);
      const p = await payouts.requestPayout(user.id, { amount: 80, pix_key: CPF, pix_type: 'CPF' });
      await rejeita(adminFin.transitionPayout(adminId, p.id, 'PROCESSING', {}), 409);
      await rejeita(adminFin.transitionPayout(adminId, p.id, 'FAILED', { reason: 'x' }), 409);
      await rejeita(adminFin.transitionPayout(adminId, p.id, 'REJECTED', {}), 400, 'motivo');
      await rejeita(payouts.requestPayout(user.id, { amount: 1, pix_key: CPF, pix_type: 'CPF' }), 400);
      const rj = await adminFin.transitionPayout(adminId, p.id, 'REJECTED', { reason: 'chave de terceiro' });
      assert.equal(rj.rejection_reason, 'chave de terceiro');
      assert.equal(await saldo(acc.id), 80, 'rejeição não mexe no saldo');
      for (const st of ['APPROVED', 'PAID', 'PROCESSING', 'FAILED']) {
        await rejeita(adminFin.transitionPayout(adminId, p.id, st, { reason: 'x' }), 409);
      }
      const novo = await payouts.requestPayout(user.id, { amount: 80, pix_key: CPF, pix_type: 'CPF' });
      assert.equal(novo.status, 'PENDING', 'reserva liberada após rejeição');
      await ciclo(novo.id, 'APPROVED', 'PROCESSING');
      await adminFin.transitionPayout(adminId, novo.id, 'FAILED', { reason: 'PSP recusou' });
      assert.equal(await saldo(acc.id), 80, 'falha de transferência não debita');
      assert.equal(await TransactionLedger.count({ where: { reference_type: 'PAYOUT', reference_id: novo.id } }), 0);
    });

    await teste('PAGO com saldo de ganhos menor que o saque: 409 e nada muda (rollback)', async () => {
      const { user, sp } = await novaTarologa();
      const acc = await darGanho(sp.id, 30);
      const p = await payouts.requestPayout(user.id, { amount: 30, pix_key: CPF, pix_type: 'CPF' });
      await ciclo(p.id, 'APPROVED');
      await acc.update({ cached_balance: 10 });
      await rejeita(adminFin.markPayoutAsPaid(adminId, p.id, {}), 409, 'menor');
      assert.equal((await PayoutRequest.findByPk(p.id)).status, 'APPROVED');
      assert.equal(await saldo(acc.id), 10);
    });

    await teste('listagem admin de saques com filtro de status', async () => {
      const l = await adminFin.listPayoutRequests({ status: 'PAID' });
      assert.ok(l.items.length >= 2 && l.items.every((i) => i.status === 'PAID'));
    });

    console.log('Sessões (F-08, F-09, F-10)');

    await teste('computeBillableMinutes: piso por minuto cheio, 2 min de cortesia', async () => {
      const t0 = Date.UTC(2026, 0, 1);
      const f = (s) => computeBillableMinutes(t0, t0 + s * 1000, 2);
      assert.deepEqual(f(0), { elapsedMinutes: 0, freeUsed: 0, paidUsed: 0 });
      assert.deepEqual(f(119), { elapsedMinutes: 1, freeUsed: 1, paidUsed: 0 });
      assert.deepEqual(f(120), { elapsedMinutes: 2, freeUsed: 2, paidUsed: 0 });
      assert.deepEqual(f(359), { elapsedMinutes: 5, freeUsed: 2, paidUsed: 3 });
      assert.deepEqual(computeBillableMinutes(null, t0, 2), { elapsedMinutes: 0, freeUsed: 0, paidUsed: 0 });
    });

    await teste('sessão com saldo zero/negativo é recusada na criação (402) e nada é criado', async () => {
      const { sp } = await novaTarologa();
      const z = await novoCliente(0);
      await rejeita(createSession(z.user, { specialist_id: sp.id, modality: 'TEXTO' }), 402, 'Saldo insuficiente');
      await z.wallet.update({ cached_balance: -3 });
      await rejeita(createSession(z.user, { specialist_id: sp.id, modality: 'TEXTO' }), 402);
      await z.wallet.update({ cached_balance: 0.5 });
      await rejeita(createSession(z.user, { specialist_id: sp.id, modality: 'TEXTO' }), 402);
      assert.equal(await Session.count({ where: { client_id: z.client.id } }), 0);
      await z.wallet.update({ cached_balance: 5 });
      const s = await createSession(z.user, { specialist_id: sp.id, modality: 'TEXTO' });
      assert.equal(s.billing_track, 'CLIENT_WALLET');
    });

    await teste('duas sessões simultâneas do mesmo cliente (Promise.all): só uma cabe no saldo', async () => {
      const { sp } = await novaTarologa();
      const c = await novoCliente(1.5);
      const rs = await Promise.allSettled([
        createSession(c.user, { specialist_id: sp.id, modality: 'TEXTO' }),
        createSession(c.user, { specialist_id: sp.id, modality: 'TEXTO' }),
        createSession(c.user, { specialist_id: sp.id, modality: 'TEXTO' }),
      ]);
      assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 1);
      assert.ok(rs.filter((r) => r.status === 'rejected').every((r) => r.reason.statusCode === 402));
      assert.equal(await Session.count({ where: { client_id: c.client.id } }), 1);
    });

    await teste('cronômetro: o saldo não é contado em dobro por duas sessões abertas do mesmo cliente', async () => {
      const { sp } = await novaTarologa();
      const c = await novoCliente(8);
      const inicio = new Date(Date.now() - 7 * 60000 - 5000);
      const mk = () =>
        Session.create({
          client_id: c.client.id,
          specialist_id: sp.id,
          modality: 'TEXTO',
          status: 'READY',
          telecom_status: 'ACTIVE',
          telecom_provider: 'WHATSAPP',
          started_at: inicio,
          billing_track: 'CLIENT_WALLET',
          minute_price_applied_snapshot: '1.0000',
          specialist_commission_pct_snapshot: '70.0000',
        });
      const a = await mk();
      const b = await mk();
      await processOneBillingSession(a); // 5 min pagos de 8: cabe
      assert.equal((await Session.findByPk(a.id)).telecom_status, 'ACTIVE');
      await processOneBillingSession(b); // sobram 3 min, a outra já gastou 5: corta
      const bb = await Session.findByPk(b.id);
      assert.equal(bb.telecom_status, 'COMPLETED');
      assert.equal(bb.ended_reason_code, 'NO_BALANCE_HARD_CUT');
      await new Promise((r) => setTimeout(r, 1500)); // deixa o fecho em segundo plano terminar
    });

    await teste('F-10: fecho recalcula os minutos pelo ended_at (tick atrasado não subcobra)', async () => {
      const { sp } = await novaTarologa();
      const c = await novoCliente(50);
      const s = await Session.create({
        client_id: c.client.id,
        specialist_id: sp.id,
        modality: 'TEXTO',
        status: 'ENDED',
        telecom_status: 'COMPLETED',
        started_at: new Date(Date.now() - 600000),
        ended_at: new Date(),
        paid_minutes_used: 5,
        free_minutes_used: 2,
        billing_track: 'CLIENT_WALLET',
        minute_price_applied_snapshot: '1.0000',
        specialist_commission_pct_snapshot: '70.0000',
      });
      await refreshBillableMinutesAtClose(s.id);
      const r = await Session.findByPk(s.id);
      assert.equal(r.paid_minutes_used, 8);
      assert.equal(r.free_minutes_used, 2);
    });

    async function sessaoCompleta(c, sp, { paid, minutosAtras = 10, pct = '70.0000' } = {}) {
      return Session.create({
        client_id: c.client.id,
        specialist_id: sp.id,
        modality: 'TEXTO',
        status: 'ENDED',
        telecom_status: 'COMPLETED',
        started_at: new Date(Date.now() - (minutosAtras + 5) * 60000),
        ended_at: new Date(Date.now() - minutosAtras * 60000),
        paid_minutes_used: paid,
        free_minutes_used: 2,
        billing_track: 'CLIENT_WALLET',
        minute_price_applied_snapshot: '1.0000',
        specialist_commission_pct_snapshot: pct,
      });
    }

    await teste('fecho: consumo e comissão 70/30 corretos e idempotentes (rodar duas vezes não duplica)', async () => {
      const { sp } = await novaTarologa();
      const c = await novoCliente(10);
      const s = await sessaoCompleta(c, sp, { paid: 5 });
      await finalizeSessionEconomicsAfterTelecomCompletion(s.id);
      await finalizeSessionEconomicsAfterTelecomCompletion(s.id);
      const r = await Session.findByPk(s.id);
      assert.ok(r.economics_settled_at);
      assert.equal(Number(r.total_cost), 5);
      assert.equal(Number(r.specialist_commission_amount_snapshot), 3.5);
      assert.equal(Number(r.platform_fee_amount_snapshot), 1.5);
      assert.equal(Number(r.economics_uncollected_amount), 0);
      assert.equal(await saldo(c.wallet.id), 5);
      assert.equal(await TransactionLedger.count({ where: { reference_id: s.id } }), 3);
    });

    await teste('fecho com saldo zero/parcial: não some, registra a diferença não cobrada', async () => {
      const { sp } = await novaTarologa();
      const c0 = await novoCliente(0);
      const s0 = await sessaoCompleta(c0, sp, { paid: 4 });
      await finalizeSessionEconomicsAfterTelecomCompletion(s0.id);
      const r0 = await Session.findByPk(s0.id);
      assert.ok(r0.economics_settled_at);
      assert.equal(Number(r0.economics_uncollected_amount), 4);
      assert.equal(await TransactionLedger.count({ where: { reference_id: s0.id } }), 0);
      const c2 = await novoCliente(2);
      const s2 = await sessaoCompleta(c2, sp, { paid: 5 });
      await finalizeSessionEconomicsAfterTelecomCompletion(s2.id);
      const r2 = await Session.findByPk(s2.id);
      assert.equal(Number(r2.total_cost), 2);
      assert.equal(Number(r2.economics_uncollected_amount), 3);
      assert.equal(await saldo(c2.wallet.id), 0);
    });

    await teste('reconciliação: COMPLETED sem fecho é fechada; duas rodadas (e em paralelo) não duplicam', async () => {
      const { sp } = await novaTarologa();
      const cs = [await novoCliente(20), await novoCliente(20), await novoCliente(20)];
      const ss = [];
      for (const c of cs) ss.push(await sessaoCompleta(c, sp, { paid: 6 }));
      const recente = await sessaoCompleta(cs[0], sp, { paid: 1, minutosAtras: 0 });
      const [r1, r2] = await Promise.all([reconcileUnsettledCompletedSessions(), reconcileUnsettledCompletedSessions()]);
      assert.equal(r1.failed + r2.failed, 0);
      const r3 = await reconcileUnsettledCompletedSessions();
      assert.equal(r3.found, 0, 'terceira rodada não encontra nada pendente (a recente espera a idade mínima)');
      for (const s of ss) {
        const r = await Session.findByPk(s.id);
        assert.ok(r.economics_settled_at);
        assert.equal(await TransactionLedger.count({ where: { reference_id: s.id, reference_type: 'SESSION_CONSUMPTION' } }), 1);
        assert.equal(await TransactionLedger.count({ where: { reference_id: s.id, reference_type: 'COMMISSION_SPLIT' } }), 2);
      }
      assert.equal((await Session.findByPk(recente.id)).economics_settled_at, null);
      for (const c of cs.slice(1)) assert.equal(await saldo(c.wallet.id), 14);
      const rr = await reconcileUnsettledCompletedSessions({ minAgeMs: 0 });
      assert.equal(rr.failed, 0);
      assert.equal(await TransactionLedger.count({ where: { reference_id: recente.id, reference_type: 'SESSION_CONSUMPTION' } }), 1);
    });

    await teste('razão: ganho da tarólogo bate com a soma das comissões e saque pago sobre ele fecha', async () => {
      const { user, sp } = await novaTarologa();
      const c = await novoCliente(100);
      const s1 = await sessaoCompleta(c, sp, { paid: 10 });
      const s2 = await sessaoCompleta(c, sp, { paid: 3 });
      await finalizeSessionEconomicsAfterTelecomCompletion(s1.id);
      await finalizeSessionEconomicsAfterTelecomCompletion(s2.id);
      const acc = await LedgerAccount.findOne({ where: { specialist_id: sp.id, account_type: 'SPECIALIST_EARNINGS' } });
      assert.equal(await saldo(acc.id), 9.1);
      assert.equal(await liquidoLedger(acc.id), 9.1);
      const p = await payouts.requestPayout(user.id, { amount: 9.1, pix_key: CPF, pix_type: 'CPF' });
      await ciclo(p.id, 'APPROVED', 'PAID');
      assert.equal(await saldo(acc.id), 0);
      assert.equal(await liquidoLedger(acc.id), 0);
    });
  } finally {
    if (sequelize) await sequelize.close().catch(() => {});
    try {
      execFileSync(path.join(PG_BIN, 'dropdb'), [...pgArgs, '--if-exists', DB_NAME], { stdio: 'inherit' });
    } catch (e) {
      console.error('Falha ao apagar o banco descartável', DB_NAME, e.message);
      falhas.push('dropdb');
    }
  }

  console.log(`\n${ok} cenários ok, ${falhas.length} falha(s)`);
  if (falhas.length) {
    console.log(falhas.map((f) => ` - ${f}`).join('\n'));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  try {
    execFileSync(path.join(PG_BIN, 'dropdb'), [...pgArgs, '--if-exists', DB_NAME], { stdio: 'inherit' });
  } catch {
    /* ignora */
  }
  process.exit(1);
});
