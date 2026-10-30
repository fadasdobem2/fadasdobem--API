'use strict';

/**
 * Prova do financeiro de pagamentos (src/features/payments) contra um Postgres LOCAL DESCARTÁVEL.
 * Cria `fdb_fin_<aleatório>`, migra pelo caminho oficial (`npm run migrate`), roda os cenários com
 * concorrência real (Promise.all) e apaga o banco no fim. Nunca lê o .env nem toca em outro banco.
 *
 *   node scripts/verificar-financeiro-pagamentos.js     (ou: npm run verificar:financeiro)
 *
 * Em todo cenário confere o razão: soma de créditos - débitos de todas as contas fecha a zero e o
 * `cached_balance` de cada conta (exceto PLATFORM_SUSPENSE, ver payments.posting.js) bate com o razão.
 */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const pg = require('./apoio-esquema/pg');

const nome = pg.nomeBanco('fin');
let ok = 0;
const falhas = [];

async function teste(titulo, fn) {
  try {
    await fn();
    ok += 1;
    process.stdout.write(`  ok   ${titulo}\n`);
  } catch (e) {
    falhas.push(titulo);
    process.stdout.write(`  FALHA ${titulo}\n       ${e.stack || e}\n`);
  }
}

async function main() {
  pg.criar(nome);
  const env = { ...pg.envDoBanco(nome), REDIS_URL: '', REDIS_HOST: '' };
  const mig = spawnSync('npm', ['run', 'migrate'], { cwd: pg.RAIZ, env, encoding: 'utf8' });
  if (mig.status !== 0) throw new Error(`npm run migrate falhou:\n${mig.stdout}\n${mig.stderr}`);
  Object.assign(process.env, env);

  const { sequelize } = require('../src/config/database');
  const M = require('../src/models');
  const money = require('../src/features/payments/payments.money');
  const posting = require('../src/features/payments/payments.posting');
  const ledger = require('../src/features/payments/payments.ledger');
  const settlement = require('../src/features/payments/payments.settlement');
  const events = require('../src/features/payments/payments.settlement.events');
  const checkout = require('../src/features/payments/payments.checkout');
  const { processMercadoPagoWebhookAsync } = require('../src/features/payments/payments.webhook');
  const mpClient = require('../src/providers/mercadopago/mercadopago.client');
  const { PaymentOrder, ClientCreditLot } = M;

  const log = console.log;
  const quiet = () => {
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
  };
  const loud = () => {
    console.log = log;
  };
  const q = (sql, replacements) =>
    sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

  // ---- apoio -------------------------------------------------------------------------------------
  async function novoCliente() {
    const uid = randomUUID();
    const cid = randomUUID();
    await sequelize.query(
      `INSERT INTO users (id, email, role, created_at, updated_at) VALUES (:uid, :em, 'CLIENTE', NOW(), NOW())`,
      { replacements: { uid, em: `${uid}@t.test` } }
    );
    await sequelize.query(
      `INSERT INTO clients (id, user_id, created_at, updated_at) VALUES (:cid, :uid, NOW(), NOW())`,
      { replacements: { cid, uid } }
    );
    return { clientId: cid, userId: uid };
  }

  async function novaTarologa() {
    const uid = randomUUID();
    const sid = randomUUID();
    await sequelize.query(
      `INSERT INTO users (id, email, role, created_at, updated_at) VALUES (:uid, :em, 'TAROLOGA', NOW(), NOW())`,
      { replacements: { uid, em: `${uid}@t.test` } }
    );
    await sequelize.query(
      `INSERT INTO specialists (id, user_id, created_at, updated_at) VALUES (:sid, :uid, NOW(), NOW())`,
      { replacements: { sid, uid } }
    );
    return sid;
  }

  const novaOrdem = (clientId, amount, ctx = {}) =>
    PaymentOrder.create({
      client_id: clientId,
      external_reference: randomUUID(),
      amount,
      status: 'PENDING',
      payment_method: 'PIX',
      checkout_context: { credit_type: 'AVULSO', ...ctx },
    });

  let mpSeq = 9000000;
  const mpState = new Map();
  /** Registra o estado "atual" do pagamento no falso MP e devolve o objeto. */
  function mp(order, status, gross, net, extra = {}) {
    const id = extra.id || ++mpSeq;
    const snap = {
      id,
      status,
      status_detail: status,
      external_reference: order.external_reference,
      transaction_amount: gross,
      payment_type_id: 'bank_transfer',
      payment_method_id: 'pix',
      date_approved: new Date().toISOString(),
      live_mode: true,
      ...(net === undefined ? {} : { transaction_details: { net_received_amount: net } }),
      ...extra,
    };
    mpState.set(String(id), snap);
    return snap;
  }
  mpClient.getPaymentById = async (id) => mpState.get(String(id));

  const webhook = (snap) =>
    processMercadoPagoWebhookAsync({ body: { data: { id: String(snap.id) } }, query: {}, headers: {} });

  /** Aplica um evento direto no motor (sem HTTP), na ordem travada, como o webhook faz. */
  const aplicar = (orderId, fn) =>
    sequelize.transaction(async (t) => {
      const locked = await PaymentOrder.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
      await fn(locked, t);
    });

  async function saldo(clientId, type = 'CLIENT_WALLET') {
    const r = await q('SELECT cached_balance::text AS b FROM ledger_accounts WHERE client_id = :c AND account_type = :t', {
      c: clientId,
      t: type,
    });
    return r[0] ? r[0].b : null;
  }
  const cents = async (clientId, type) => money.toCents(await saldo(clientId, type)) ?? 0;

  async function plataforma(type) {
    const r = await q(
      `SELECT cached_balance::text AS b FROM ledger_accounts
        WHERE account_type = :t AND client_id IS NULL AND specialist_id IS NULL AND temp_client_id IS NULL`,
      { t: type }
    );
    return r[0] ? money.toCents(r[0].b) ?? 0 : 0;
  }

  async function consumir(clientId, amountStr, type = 'CLIENT_WALLET') {
    // Simula o fecho de sessão de sessions.economics: debita a conta do cliente contra o suspense.
    await sequelize.transaction(async (t) => {
      const acc =
        type === 'CLIENT_WALLET' ? await ledger.ensureClientWallet(clientId, t) : await ledger.ensureClientPacoteEscrow(clientId, t);
      const susp = await ledger.ensurePlatformSuspense(t);
      await posting.postEntry(t, {
        debitId: acc.id,
        creditId: susp.id,
        amountCents: money.toCents(amountStr),
        referenceType: 'SESSION_CONSUMPTION',
        idempotencyKey: `teste-consumo-${randomUUID()}`,
      });
    });
  }

  /** Invariantes do razão inteiro. */
  async function fechaRazao(rotulo) {
    const contas = await q(`
      SELECT a.id, a.account_type, a.cached_balance::text AS cache,
             COALESCE((SELECT SUM(amount) FROM transaction_ledger WHERE credit_account_id = a.id), 0)::text AS cr,
             COALESCE((SELECT SUM(amount) FROM transaction_ledger WHERE debit_account_id = a.id), 0)::text AS de
        FROM ledger_accounts a`);
    let soma = 0;
    for (const c of contas) {
      const liquido = money.toCents(c.cr) - money.toCents(c.de);
      soma += liquido;
      if (c.account_type === 'PLATFORM_SUSPENSE') continue;
      assert.equal(money.toCents(c.cache) ?? 0, liquido, `${rotulo}: cache da conta ${c.account_type} ${c.id} diverge do razão`);
      if (c.account_type.startsWith('CLIENT_')) assert.ok(liquido >= 0, `${rotulo}: saldo de cliente negativo`);
    }
    assert.equal(soma, 0, `${rotulo}: soma do razão não fecha a zero`);
    const dup = await q(`SELECT idempotency_key FROM transaction_ledger WHERE idempotency_key IS NOT NULL
                          GROUP BY idempotency_key HAVING count(*) > 1`);
    assert.equal(dup.length, 0, `${rotulo}: chave idempotente duplicada`);
  }

  quiet();
  try {
    // ================================================================================================
    loud();
    console.log('Centavos e arredondamento');
    quiet();
    await teste('0.10 + 0.20 vira 30 centavos e 33,33 / 3 fecha em centavos inteiros', async () => {
      assert.equal(money.toCents(0.1 + 0.2), 30);
      assert.equal(money.toCents('33.335'), 3334, 'meio para cima');
      assert.equal(money.toCents(1.005), 101);
      assert.equal(money.centsToString(5), '0.05');
      assert.equal(money.centsToString(-1234), '-12.34');
      const t = money.toCents('33.33');
      const partes = [money.mulDivRound(t, 1, 3), money.mulDivRound(t, 1, 3), t - 2 * money.mulDivRound(t, 1, 3)];
      assert.deepEqual(partes, [1111, 1111, 1111]);
      assert.equal(money.mulDivRound(10000, 1, 3), 3333);
      assert.equal(money.roundMoney(0), null);
      assert.equal(money.roundMoney('abc'), null);
    });

    await teste('crédito de 0.10 e 0.20 em duas ordens soma exatamente 0.30 na carteira', async () => {
      const { clientId } = await novoCliente();
      for (const v of ['0.10', '0.20']) {
        const o = await novaOrdem(clientId, v);
        await webhook(mp(o, 'approved', Number(v), Number(v)));
      }
      assert.equal(await saldo(clientId), '0.3000');
      await fechaRazao('centavos');
    });

    // ================================================================================================
    loud();
    console.log('Webhook duplicado, simultâneo e PAID duas vezes (F-05)');
    quiet();
    await teste('8 webhooks approved simultâneos: 1 lançamento, 1 lote, 1 incremento', async () => {
      const { clientId } = await novoCliente();
      const o = await novaOrdem(clientId, '50.00', { credit_type: 'PACOTE_SESSAO_UNICA', package_id: 'pacote_50' });
      const snap = mp(o, 'approved', 50, 49.5);
      await Promise.all(Array.from({ length: 8 }, () => webhook(snap)));
      await webhook(snap);
      assert.equal(await saldo(clientId, 'CLIENT_PACOTE_ESCROW'), '49.5000');
      assert.equal(await saldo(clientId, 'CLIENT_WALLET'), null);
      const lots = await ClientCreditLot.findAll({ where: { payment_order_id: o.id } });
      assert.equal(lots.length, 1);
      const [{ n }] = await q('SELECT count(*)::int AS n FROM transaction_ledger WHERE reference_id = :o', { o: o.id });
      assert.equal(n, 1);
      assert.equal((await PaymentOrder.findByPk(o.id)).status, 'PAID');
      await fechaRazao('webhook simultâneo');
    });

    await teste('captura síncrona e webhook ao mesmo tempo creditam uma vez só', async () => {
      const { clientId } = await novoCliente();
      const o = await novaOrdem(clientId, '25.00');
      const snap = mp(o, 'approved', 25, 25);
      await Promise.all([
        settlement.finalizeApprovedMercadoSynchronously(o, snap),
        webhook(snap),
        settlement.finalizeApprovedMercadoSynchronously(o, snap),
      ]);
      assert.equal(await saldo(clientId), '25.0000');
      await fechaRazao('sync + webhook');
    });

    await teste('contas do razão: 10 criações simultâneas da mesma carteira resultam em 1 conta', async () => {
      const { clientId } = await novoCliente();
      await Promise.all(
        Array.from({ length: 10 }, () => sequelize.transaction((t) => ledger.ensureClientWallet(clientId, t)))
      );
      const [{ n }] = await q('SELECT count(*)::int AS n FROM ledger_accounts WHERE client_id = :c', { c: clientId });
      assert.equal(n, 1);
      await Promise.all(Array.from({ length: 6 }, () => sequelize.transaction((t) => ledger.ensurePlatformRevenue(t))));
      const [{ m }] = await q(`SELECT count(*)::int AS m FROM ledger_accounts WHERE account_type = 'PLATFORM_REVENUE'`);
      assert.equal(m, 1);
    });

    await teste('matriz: PAID não é rebaixado por in_process/in_mediation/rejected; REFUNDED não volta a PAID', async () => {
      const { clientId } = await novoCliente();
      const o = await novaOrdem(clientId, '30.00');
      await webhook(mp(o, 'approved', 30, 30, { id: 111001 }));
      await webhook(mp(o, 'in_process', 30, 30, { id: 111001 }));
      assert.equal((await PaymentOrder.findByPk(o.id)).status, 'PAID');
      await webhook(mp(o, 'in_mediation', 30, 30, { id: 111001 }));
      assert.equal((await PaymentOrder.findByPk(o.id)).status, 'PAID');
      await webhook(mp(o, 'rejected', 30, 30, { id: 111001 }));
      assert.equal((await PaymentOrder.findByPk(o.id)).status, 'PAID');
      await webhook(mp(o, 'refunded', 30, 30, { id: 111001, transaction_amount_refunded: 30 }));
      assert.equal((await PaymentOrder.findByPk(o.id)).status, 'REFUNDED');
      // approved atrasado (corrida entre dois webhooks): nada muda
      await webhook(mp(o, 'approved', 30, 30, { id: 111001 }));
      await webhook(mp(o, 'in_process', 30, 30, { id: 111001 }));
      const after = await PaymentOrder.findByPk(o.id);
      assert.equal(after.status, 'REFUNDED');
      assert.equal(await saldo(clientId), '0.0000');
      const lots = await ClientCreditLot.findAll({ where: { payment_order_id: o.id } });
      assert.equal(lots.length, 1);
      assert.equal(lots[0].is_locked, true);
      await fechaRazao('matriz');
    });

    await teste('três webhooks refunded simultâneos estornam uma vez só', async () => {
      const { clientId } = await novoCliente();
      const o = await novaOrdem(clientId, '70.00');
      await webhook(mp(o, 'approved', 70, 70, { id: 111002 }));
      const refunded = mp(o, 'refunded', 70, 70, { id: 111002, transaction_amount_refunded: 70 });
      await Promise.all([webhook(refunded), webhook(refunded), webhook(refunded)]);
      assert.equal((await PaymentOrder.findByPk(o.id)).status, 'REFUNDED');
      assert.equal(await saldo(clientId), '0.0000');
      const [{ n }] = await q(`SELECT count(*)::int AS n FROM transaction_ledger WHERE reference_id = :o AND reference_type = 'REFUND'`, { o: o.id });
      assert.equal(n, 1);
      await fechaRazao('corrida');
    });

    // ================================================================================================
    loud();
    console.log('Valor creditado x líquido do MP (F-06)');
    quiet();
    await teste('net 0, ausente e menor que o bruto: sem erro, crédito definido e documentado', async () => {
      const { clientId } = await novoCliente();
      const o0 = await novaOrdem(clientId, '20.00');
      await webhook(mp(o0, 'approved', 20, 0)); // net 0 cai para o bruto, nunca 500 em loop
      assert.equal((await PaymentOrder.findByPk(o0.id)).status, 'PAID');
      const o1 = await novaOrdem(clientId, '10.00');
      await webhook(mp(o1, 'approved', 10, undefined)); // sem net: bruto
      const o2 = await novaOrdem(clientId, '50.00');
      await webhook(mp(o2, 'approved', 50, 47.51)); // regra mantida: líquido do MP
      assert.equal(await saldo(clientId), '77.5100');
      const lo2 = await ClientCreditLot.findOne({ where: { payment_order_id: o2.id } });
      assert.equal(lo2.initial_amount, '47.5100');
      const od = await PaymentOrder.findByPk(o2.id);
      assert.equal(od.mp_fee_amount, '2.4900');
      await fechaRazao('net');
    });

    // ================================================================================================
    loud();
    console.log('Taróloga reservada (F-07)');
    quiet();
    await teste('taróloga reservada por outra cliente: o dinheiro entrou, credita; só a reserva é pulada', async () => {
      const outra = await novoCliente();
      const { clientId } = await novoCliente();
      const sid = await novaTarologa();
      await sequelize.query(
        `UPDATE specialists SET reserved_by_client_id = :o, reserved_until = NOW() + interval '4 minutes' WHERE id = :s`,
        { replacements: { o: outra.clientId, s: sid } }
      );
      const o = await novaOrdem(clientId, '40.00', { specialist_id: sid });
      await webhook(mp(o, 'approved', 40, 40));
      const row = await PaymentOrder.findByPk(o.id);
      assert.equal(row.status, 'PAID');
      assert.equal(row.checkout_context.reservation_skipped, 'SPECIALIST_RESERVED_BY_OTHER');
      assert.equal(await saldo(clientId), '40.0000');
      const [sp] = await q('SELECT reserved_by_client_id AS r FROM specialists WHERE id = :s', { s: sid });
      assert.equal(sp.r, outra.clientId, 'reserva da outra cliente preservada');
      await fechaRazao('reservada');
    });

    await teste('specialist_id inexistente também credita; taróloga livre é reservada', async () => {
      const { clientId } = await novoCliente();
      const o1 = await novaOrdem(clientId, '15.00', { specialist_id: randomUUID() });
      await webhook(mp(o1, 'approved', 15, 15));
      assert.equal((await PaymentOrder.findByPk(o1.id)).status, 'PAID');
      assert.equal(await saldo(clientId), '15.0000');

      const sid = await novaTarologa();
      const o2 = await novaOrdem(clientId, '5.00', { specialist_id: sid });
      await aplicar(o2.id, (locked, t) => settlement.handleApproved(locked, mp(o2, 'approved', 5, 5), t, [], { skipReservation: false }));
      const [sp] = await q('SELECT reserved_by_client_id AS r FROM specialists WHERE id = :s', { s: sid });
      assert.equal(sp.r, clientId);
      assert.equal(await saldo(clientId), '20.0000');
      await fechaRazao('reserva livre');
    });

    // ================================================================================================
    loud();
    console.log('Estorno e chargeback (F-04)');
    quiet();
    await teste('estorno total de pacote parcialmente consumido: reverte só o remanescente e registra a perda', async () => {
      const { clientId } = await novoCliente();
      const o = await novaOrdem(clientId, '50.00', { credit_type: 'PACOTE_SESSAO_UNICA' });
      await webhook(mp(o, 'approved', 50, 50, { id: 112001 }));
      // consumo de 30 pelo fecho da sessão: debita o escrow e deixa 20 no lote
      await consumir(clientId, '30.00', 'CLIENT_PACOTE_ESCROW');
      await ClientCreditLot.update({ remaining_amount: '20.00' }, { where: { payment_order_id: o.id } });
      const revAntes = await plataforma('PLATFORM_REVENUE');
      await webhook(mp(o, 'refunded', 50, 50, { id: 112001, transaction_amount_refunded: 50 }));
      assert.equal(await saldo(clientId, 'CLIENT_PACOTE_ESCROW'), '0.0000');
      assert.equal((await plataforma('PLATFORM_REVENUE')) - revAntes, -3000, 'perda de 30,00 registrada');
      const lot = await ClientCreditLot.findOne({ where: { payment_order_id: o.id } });
      assert.equal(money.toCents(lot.remaining_amount), 0);
      assert.equal(lot.is_locked, true);
      assert.equal((await PaymentOrder.findByPk(o.id)).status, 'REFUNDED');
      await webhook(mp(o, 'refunded', 50, 50, { id: 112001, transaction_amount_refunded: 50 })); // repetido
      assert.equal((await plataforma('PLATFORM_REVENUE')) - revAntes, -3000);
      await fechaRazao('estorno pacote');
    });

    await teste('estorno do lote avulso antigo não consome o crédito de outra compra (consumo FIFO)', async () => {
      const { clientId } = await novoCliente();
      const a = await novaOrdem(clientId, '50.00');
      await webhook(mp(a, 'approved', 50, 50, { id: 112002 }));
      const b = await novaOrdem(clientId, '60.00');
      await webhook(mp(b, 'approved', 60, 60, { id: 112003 }));
      await consumir(clientId, '30.00'); // carteira 80
      await webhook(mp(a, 'refunded', 50, 50, { id: 112002, transaction_amount_refunded: 50 }));
      assert.equal(await saldo(clientId), '60.0000', 'a compra B segue intacta');
      const lb = await ClientCreditLot.findOne({ where: { payment_order_id: b.id } });
      assert.equal(money.toCents(lb.remaining_amount), 6000);
      assert.equal(lb.is_locked, false);
      await fechaRazao('estorno avulso');
    });

    await teste('estornos parciais sucessivos lançam só a diferença; repetição do antigo não faz nada', async () => {
      const { clientId } = await novoCliente();
      const o = await novaOrdem(clientId, '100.00');
      await webhook(mp(o, 'approved', 100, 100, { id: 112004 }));
      await webhook(mp(o, 'partially_refunded', 100, 100, { id: 112004, transaction_amount_refunded: 30 }));
      assert.equal(await saldo(clientId), '70.0000');
      assert.equal((await PaymentOrder.findByPk(o.id)).status, 'PARTIALLY_REFUNDED');
      await webhook(mp(o, 'partially_refunded', 100, 100, { id: 112004, transaction_amount_refunded: 50 }));
      assert.equal(await saldo(clientId), '50.0000');
      const velho = mp(o, 'partially_refunded', 100, 100, { id: 112004, transaction_amount_refunded: 30 });
      await aplicar(o.id, (locked, t) => events.handleRefund(locked, velho, t));
      assert.equal(await saldo(clientId), '50.0000');
      await webhook(mp(o, 'refunded', 100, 100, { id: 112004, transaction_amount_refunded: 100 }));
      assert.equal(await saldo(clientId), '0.0000');
      const [{ s }] = await q(
        `SELECT SUM(amount)::text AS s FROM transaction_ledger WHERE reference_id = :o AND reference_type = 'REFUND'`,
        { o: o.id }
      );
      assert.equal(s, '100.0000');
      await fechaRazao('parciais');
    });

    await teste('estorno parcial de 33,33 em terços fecha em centavos exatos', async () => {
      const { clientId } = await novoCliente();
      const o = await novaOrdem(clientId, '33.33');
      await webhook(mp(o, 'approved', 33.33, 33.33, { id: 112005 }));
      await webhook(mp(o, 'partially_refunded', 33.33, 33.33, { id: 112005, transaction_amount_refunded: 11.11 }));
      assert.equal(await saldo(clientId), '22.2200');
      await webhook(mp(o, 'partially_refunded', 33.33, 33.33, { id: 112005, transaction_amount_refunded: 22.22 }));
      assert.equal(await saldo(clientId), '11.1100');
      await webhook(mp(o, 'refunded', 33.33, 33.33, { id: 112005, transaction_amount_refunded: 33.33 }));
      assert.equal(await saldo(clientId), '0.0000');
      await fechaRazao('terços');
    });

    await teste('chargeback com consumo: reverte o saldo, registra a perda e não volta a PAID', async () => {
      const { clientId } = await novoCliente();
      const o = await novaOrdem(clientId, '40.00');
      await webhook(mp(o, 'approved', 40, 40, { id: 112006 }));
      await consumir(clientId, '15.00');
      const revAntes = await plataforma('PLATFORM_REVENUE');
      const resAntes = await plataforma('CHARGEBACK_RESERVE');
      await webhook(mp(o, 'charged_back', 40, 40, { id: 112006 }));
      assert.equal(await saldo(clientId), '0.0000');
      assert.equal((await plataforma('PLATFORM_REVENUE')) - revAntes, -1500);
      assert.equal((await plataforma('CHARGEBACK_RESERVE')) - resAntes, 4000);
      const row = await PaymentOrder.findByPk(o.id);
      assert.equal(row.status, 'CHARGEBACK');
      await webhook(mp(o, 'approved', 40, 40, { id: 112006 }));
      await webhook(mp(o, 'refunded', 40, 40, { id: 112006, transaction_amount_refunded: 40 }));
      await webhook(mp(o, 'in_process', 40, 40, { id: 112006 }));
      assert.equal((await PaymentOrder.findByPk(o.id)).status, 'CHARGEBACK');
      assert.equal((await plataforma('CHARGEBACK_RESERVE')) - resAntes, 4000, 'estorno depois do chargeback não duplica');
      await fechaRazao('chargeback');
    });

    await teste('chargeback com carteira zerada: tudo vira perda registrada, sem dívida escondida', async () => {
      const { clientId } = await novoCliente();
      const o = await novaOrdem(clientId, '25.00');
      await webhook(mp(o, 'approved', 25, 25, { id: 112007 }));
      await consumir(clientId, '25.00');
      const revAntes = await plataforma('PLATFORM_REVENUE');
      await webhook(mp(o, 'charged_back', 25, 25, { id: 112007 }));
      assert.equal(await saldo(clientId), '0.0000');
      assert.equal((await plataforma('PLATFORM_REVENUE')) - revAntes, -2500);
      await fechaRazao('chargeback zerado');
    });

    // ================================================================================================
    loud();
    console.log('Concorrência de saldo (F-13)');
    quiet();
    await teste('dois consumos simultâneos do mesmo saldo: só um passa, o outro recebe saldo insuficiente', async () => {
      const { clientId } = await novoCliente();
      const o = await novaOrdem(clientId, '50.00');
      await webhook(mp(o, 'approved', 50, 50));
      const r = await Promise.allSettled([consumir(clientId, '40.00'), consumir(clientId, '40.00')]);
      assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
      assert.equal(r.filter((x) => x.status === 'rejected').length, 1);
      assert.equal(await saldo(clientId), '10.0000');
      const r2 = await Promise.allSettled(Array.from({ length: 5 }, () => consumir(clientId, '3.33')));
      assert.equal(r2.filter((x) => x.status === 'fulfilled').length, 3);
      assert.equal(await saldo(clientId), '0.0100');
      await fechaRazao('consumos');
    });

    // ================================================================================================
    loud();
    console.log('Idempotência da criação de ordem (F-16)');
    quiet();
    await teste('duplo clique com a mesma Idempotency-Key: 1 ordem e 1 pagamento no MP', async () => {
      const { clientId, userId } = await novoCliente();
      const user = { id: userId, email: 'x@t.test', client_profile: { id: clientId, nome: 'T' } };
      let chamadas = 0;
      mpClient.createPixPayment = async (p) => {
        chamadas += 1;
        await new Promise((r) => setTimeout(r, 50));
        return { id: ++mpSeq, status: 'pending', external_reference: p.external_reference, point_of_interaction: { transaction_data: { qr_code: 'qr' } } };
      };
      const key = 'chave-teste-0001';
      const res = await Promise.allSettled(Array.from({ length: 5 }, () => checkout.createPixCheckout(user, { amount: 12.34, idempotency_key: key })));
      const [{ n }] = await q('SELECT count(*)::int AS n FROM payment_orders WHERE client_id = :c', { c: clientId });
      assert.equal(n, 1);
      assert.equal(chamadas, 1);
      const certos = res.filter((x) => x.status === 'fulfilled');
      assert.ok(certos.length >= 1);
      for (const r of res.filter((x) => x.status === 'rejected')) {
        assert.equal(r.reason.details?.code ?? r.reason.data?.code ?? 'IDEMPOTENT_IN_PROGRESS', 'IDEMPOTENT_IN_PROGRESS');
      }
      const depois = await checkout.createPixCheckout(user, { amount: 12.34, idempotency_key: key });
      assert.equal(depois.payment_order_id, certos[0].value.payment_order_id);
      assert.equal(chamadas, 1);
      await assert.rejects(checkout.createPixCheckout(user, { amount: 99, idempotency_key: key }), /outra compra/);
    });

    await teste('MP falha antes de criar o pagamento: ordem FAILED, chave liberada, retry cria nova', async () => {
      const { clientId, userId } = await novoCliente();
      const user = { id: userId, email: 'x@t.test', client_profile: { id: clientId, nome: 'T' } };
      mpClient.createPixPayment = async () => {
        throw new Error('timeout MP');
      };
      await assert.rejects(checkout.createPixCheckout(user, { amount: 10, idempotency_key: 'chave-falha-01' }), /timeout/);
      const o = await PaymentOrder.findOne({ where: { client_id: clientId } });
      assert.equal(o.status, 'FAILED');
      assert.equal(o.idempotency_key_internal, null);
      mpClient.createPixPayment = async (p) => ({ id: ++mpSeq, status: 'pending', external_reference: p.external_reference });
      const ok2 = await checkout.createPixCheckout(user, { amount: 10, idempotency_key: 'chave-falha-01' });
      assert.ok(ok2.payment_order_id);
    });

    await teste('falha depois do MP criar o pagamento não marca FAILED: fica PROCESSING e o webhook credita', async () => {
      const { clientId } = await novoCliente();
      const o = await novaOrdem(clientId, '18.00');
      await o.update({ mp_payment_id: '555001' });
      await require('../src/features/payments/payments.idempotency').markOrderAfterCheckoutError(o, new Error('falha local pós-aprovação'));
      assert.equal((await PaymentOrder.findByPk(o.id)).status, 'PROCESSING');
      await webhook(mp(o, 'approved', 18, 18, { id: 555001 }));
      assert.equal((await PaymentOrder.findByPk(o.id)).status, 'PAID');
      assert.equal(await saldo(clientId), '18.0000');
      // e uma falha tardia não rebaixa a ordem já PAID
      await require('../src/features/payments/payments.idempotency').markOrderAfterCheckoutError(o, new Error('tardia'));
      assert.equal((await PaymentOrder.findByPk(o.id)).status, 'PAID');
      await fechaRazao('processing->paid');
    });

    await teste('aprovação manual repetida com a mesma chave credita uma vez', async () => {
      const { clientId, userId } = await novoCliente();
      const user = { id: userId, client_profile: { id: clientId } };
      const body = { amount: 22.5, idempotency_key: 'manual-chave-001' };
      await Promise.allSettled([checkout.approveManualAttendancePayment(user, body), checkout.approveManualAttendancePayment(user, body), checkout.approveManualAttendancePayment(user, body)]);
      await checkout.approveManualAttendancePayment(user, body);
      assert.equal(await saldo(clientId), '22.5000');
      await fechaRazao('manual');
    });

    // ================================================================================================
    loud();
    console.log('Migração: consolidação de contas duplicadas');
    quiet();
    await teste('duplicados existentes são consolidados movendo lançamentos e somando saldo, depois o índice único existe', async () => {
      const { clientId } = await novoCliente();
      await sequelize.query('DROP INDEX IF EXISTS ledger_accounts_client_type_uidx');
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      for (const [i, id] of ids.entries()) {
        await sequelize.query(
          `INSERT INTO ledger_accounts (id, account_type, client_id, currency, cached_balance, created_at, updated_at)
           VALUES (:id, 'CLIENT_WALLET', :c, 'BRL', :b, NOW() + (:i || ' seconds')::interval, NOW())`,
          { replacements: { id, c: clientId, b: ['10.00', '5.50', '0.25'][i], i: String(i) } }
        );
      }
      const susp = await sequelize.transaction((t) => ledger.ensurePlatformSuspense(t));
      for (const [i, id] of ids.entries()) {
        await sequelize.query(
          `INSERT INTO transaction_ledger (id, debit_account_id, credit_account_id, amount, reference_type, created_at, occurred_at)
           VALUES (:id, :d, :c, :a, 'PAYMENT_ACCREDITED', NOW(), NOW())`,
          { replacements: { id: randomUUID(), d: susp.id, c: id, a: ['10.00', '5.50', '0.25'][i] } }
        );
      }
      await require('../migrations/20261029130000-financeiro-indices-unicos-e-limpeza-contas').up({ sequelize });
      const contas = await q('SELECT id, cached_balance::text AS b FROM ledger_accounts WHERE client_id = :c', { c: clientId });
      assert.equal(contas.length, 1);
      assert.equal(contas[0].id, ids[0]);
      assert.equal(contas[0].b, '15.7500');
      const [{ n }] = await q('SELECT count(*)::int AS n FROM transaction_ledger WHERE credit_account_id = :k', { k: ids[0] });
      assert.equal(n, 3);
      const [{ i }] = await q(`SELECT count(*)::int AS i FROM pg_indexes WHERE indexname = 'ledger_accounts_client_type_uidx'`);
      assert.equal(i, 1);
      await require('../migrations/20261029130000-financeiro-indices-unicos-e-limpeza-contas').up({ sequelize }); // idempotente
      await fechaRazao('migração');
    });

    await teste('razão final: soma a zero e sem chave duplicada no banco inteiro', async () => {
      await fechaRazao('final');
    });
  } finally {
    loud();
    try {
      await sequelize.close();
    } catch {
      // ignora
    }
  }
}

main()
  .catch((e) => {
    process.stdout.write(`ERRO: ${e.stack || e}\n`);
    falhas.push('execução');
  })
  .finally(() => {
    pg.apagar(nome);
    console.log(`\n${ok} testes ok, ${falhas.length} falha(s). Banco ${nome} apagado.`);
    process.exit(falhas.length ? 1 : 0);
  });
