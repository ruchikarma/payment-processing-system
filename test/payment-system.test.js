const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { PaymentStore } = require('../src/store/paymentStore');
const { WebhookService } = require('../src/services/webhookService');
const { PaymentProcessor } = require('../src/services/paymentProcessor');
const { PaymentService } = require('../src/services/paymentService');
const { STATES } = require('../src/utils/stateMachine');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStatus(paymentService, paymentId, status, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const payment = paymentService.getPayment(paymentId);
    if (payment.status === status) return payment;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for payment ${paymentId} to reach ${status}`);
}

class SequencedGateway {
  constructor(sequence, options = {}) {
    this.sequence = sequence.slice();
    this.webhookSink = options.webhookSink || null;
  }

  withWebhookSink(webhookSink) {
    this.webhookSink = webhookSink;
    return this;
  }

  initiateCharge(payment) {
    const next = this.sequence.shift() || { outcome: 'success', responseDelayMs: 10 };
    const providerRef = next.providerRef || `gw_test_${payment.id}_${Date.now()}`;
    const eventId = next.eventId || `evt_test_${payment.id}_${Date.now()}`;

    if (next.webhookStatus && this.webhookSink) {
      setTimeout(() => {
        this.webhookSink({
          providerEventId: eventId,
          providerRef,
          paymentId: payment.id,
          status: next.webhookStatus,
          reason: next.reason || null,
        });
        if (next.duplicateWebhook) {
          this.webhookSink({
            providerEventId: eventId,
            providerRef,
            paymentId: payment.id,
            status: next.webhookStatus,
            reason: next.reason || null,
          });
        }
      }, next.webhookDelayMs ?? 0);
    }

    const responsePromise = new Promise((resolve, reject) => {
      setTimeout(() => {
        if (next.outcome === 'timeout') {
          const err = new Error('Gateway timeout');
          err.code = 'GATEWAY_TIMEOUT';
          err.retryable = true;
          err.providerRef = providerRef;
          return reject(err);
        }
        if (next.outcome === 'failure') {
          const err = new Error('Gateway declined');
          err.code = 'GATEWAY_DECLINED';
          err.retryable = false;
          err.providerRef = providerRef;
          return reject(err);
        }
        return resolve({ providerRef, status: STATES.SUCCESS });
      }, next.responseDelayMs ?? 10);
    });

    return { providerRef, responsePromise, meta: next };
  }
}

test('creates payment and processes success path', async () => {
  const store = new PaymentStore();
  const webhookService = new WebhookService(store);
  const gateway = new SequencedGateway([
    { outcome: 'success', responseDelayMs: 10, webhookStatus: STATES.SUCCESS, webhookDelayMs: 5 }
  ]).withWebhookSink((payload) => webhookService.handleWebhook(payload));
  const processor = new PaymentProcessor({ store, gateway, webhookService, baseDelayMs: 10 });
  const paymentService = new PaymentService({ store, processor });

  const created = await paymentService.createPayment({
    merchantId: 'm1',
    amount: 1000,
    currency: 'INR',
    idempotencyKey: 'idem-1',
  });

  assert.equal(created.payment.status, STATES.PENDING);
  const payment = await waitForStatus(paymentService, created.payment.id, STATES.SUCCESS);
  assert.equal(payment.status, STATES.SUCCESS);
  assert.ok(payment.providerRef);
});

test('idempotency returns same payment for repeated request', async () => {
  const { paymentService } = createApp({
    gateway: new SequencedGateway([{ outcome: 'success', responseDelayMs: 10 }]),
    baseDelayMs: 10,
  });

  const first = await paymentService.createPayment({
    merchantId: 'm2',
    amount: 1500,
    currency: 'INR',
    idempotencyKey: 'idem-2',
  });

  const second = await paymentService.createPayment({
    merchantId: 'm2',
    amount: 1500,
    currency: 'INR',
    idempotencyKey: 'idem-2',
  });

  assert.equal(first.payment.id, second.payment.id);
  assert.equal(second.reused, true);
});

test('idempotency rejects same key with different payload', async () => {
  const { paymentService } = createApp({
    gateway: new SequencedGateway([{ outcome: 'success', responseDelayMs: 10 }]),
    baseDelayMs: 10,
  });

  await paymentService.createPayment({
    merchantId: 'm3',
    amount: 100,
    currency: 'INR',
    idempotencyKey: 'idem-3',
  });

  await assert.rejects(
    () => paymentService.createPayment({
      merchantId: 'm3',
      amount: 200,
      currency: 'INR',
      idempotencyKey: 'idem-3',
    }),
    /different payload/
  );
});

test('retry logic retries after timeout and eventually succeeds', async () => {
  const store = new PaymentStore();
  const webhookService = new WebhookService(store);
  const gateway = new SequencedGateway([
    { outcome: 'timeout', responseDelayMs: 10 },
    { outcome: 'success', responseDelayMs: 10 }
  ]).withWebhookSink((payload) => webhookService.handleWebhook(payload));
  const processor = new PaymentProcessor({ store, gateway, webhookService, baseDelayMs: 20, maxDelayMs: 50 });
  const paymentService = new PaymentService({ store, processor });

  const created = await paymentService.createPayment({
    merchantId: 'm4',
    amount: 555,
    currency: 'INR',
    idempotencyKey: 'idem-4',
    maxAttempts: 3,
  });

  const payment = await waitForStatus(paymentService, created.payment.id, STATES.SUCCESS, 3000);
  assert.equal(payment.status, STATES.SUCCESS);
  assert.ok(payment.attemptCount >= 2);
});

test('duplicate webhook callbacks are ignored', async () => {
  const store = new PaymentStore();
  const webhookService = new WebhookService(store);
  const gateway = new SequencedGateway([
    {
      outcome: 'success',
      responseDelayMs: 20,
      webhookStatus: STATES.SUCCESS,
      webhookDelayMs: 5,
      duplicateWebhook: true,
      providerRef: 'gw_ref_1',
      eventId: 'evt_dup_1',
    },
  ]).withWebhookSink((payload) => webhookService.handleWebhook(payload));
  const processor = new PaymentProcessor({ store, gateway, webhookService, baseDelayMs: 20 });
  const paymentService = new PaymentService({ store, processor });

  const created = await paymentService.createPayment({
    merchantId: 'm5',
    amount: 999,
    currency: 'INR',
    idempotencyKey: 'idem-5',
  });

  const payment = await waitForStatus(paymentService, created.payment.id, STATES.SUCCESS);
  assert.equal(payment.status, STATES.SUCCESS);
  assert.equal(store.processedWebhookEventIds.size, 1);
});

test('conflicting webhook cannot move success payment back to failed', async () => {
  const store = new PaymentStore();
  const webhookService = new WebhookService(store);
  const payment = store.createPayment({
    merchantId: 'm6',
    amount: 777,
    currency: 'INR',
    idempotencyKey: 'idem-6',
  }).payment;
  store.attachProviderRef(payment.id, 'gw_manual');
  store.markSuccess(payment.id, 'manual');

  const result = webhookService.handleWebhook({
    providerEventId: 'evt_conflict_1',
    providerRef: 'gw_manual',
    paymentId: payment.id,
    status: STATES.FAILED,
    reason: 'late_failed_callback',
  });

  assert.equal(result.applied, false);
  assert.equal(store.getPayment(payment.id).status, STATES.SUCCESS);
});
