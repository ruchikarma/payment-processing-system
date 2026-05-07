const { STATES, canTransition } = require('../utils/stateMachine');
const { createId } = require('../utils/id');
const { AppError } = require('../models/errors');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class PaymentStore {
  constructor() {
    this.paymentsById = new Map();
    this.paymentIdByIdempotency = new Map();
    this.paymentIdByProviderRef = new Map();
    this.processedWebhookEventIds = new Set();
  }

  createPayment({ merchantId, amount, currency, idempotencyKey, maxAttempts = 3 }) {
    const dedupeKey = `${merchantId}:${idempotencyKey}`;
    const existingPaymentId = this.paymentIdByIdempotency.get(dedupeKey);

    if (existingPaymentId) {
      const existing = this.paymentsById.get(existingPaymentId);
      return { payment: clone(existing), created: false };
    }

    const now = new Date().toISOString();
    const payment = {
      id: createId('pay_'),
      merchantId,
      amount,
      currency,
      status: STATES.PENDING,
      attemptCount: 0,
      maxAttempts,
      idempotencyKey,
      providerRef: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    this.paymentsById.set(payment.id, payment);
    this.paymentIdByIdempotency.set(dedupeKey, payment.id);
    return { payment: clone(payment), created: true };
  }

  assertPayloadForIdempotency(payment, payload) {
    const same =
      payment.merchantId === payload.merchantId &&
      payment.amount === payload.amount &&
      payment.currency === payload.currency;

    if (!same) {
      throw new AppError('Idempotency key already used with a different payload', 409, 'IDEMPOTENCY_CONFLICT');
    }
  }

  getPayment(paymentId) {
    const payment = this.paymentsById.get(paymentId);
    return payment ? clone(payment) : null;
  }

  findByProviderRef(providerRef) {
    const paymentId = this.paymentIdByProviderRef.get(providerRef);
    if (!paymentId) return null;
    return this.getPayment(paymentId);
  }

  claimForProcessing(paymentId) {
    const payment = this.paymentsById.get(paymentId);
    if (!payment) {
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    }

    const allowedToClaim = payment.status === STATES.PENDING || payment.status === STATES.FAILED;
    if (!allowedToClaim) {
      return { claimed: false, payment: clone(payment) };
    }

    if (payment.attemptCount >= payment.maxAttempts) {
      return { claimed: false, payment: clone(payment) };
    }

    payment.status = STATES.PROCESSING;
    payment.attemptCount += 1;
    payment.version += 1;
    payment.updatedAt = new Date().toISOString();
    return { claimed: true, payment: clone(payment) };
  }

  attachProviderRef(paymentId, providerRef) {
    const payment = this.paymentsById.get(paymentId);
    if (!payment) {
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    }

    payment.providerRef = providerRef;
    payment.updatedAt = new Date().toISOString();
    payment.version += 1;
    this.paymentIdByProviderRef.set(providerRef, paymentId);
    return clone(payment);
  }

  markSuccess(paymentId, source = 'gateway') {
    const payment = this.paymentsById.get(paymentId);
    if (!payment) {
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    }

    if (payment.status === STATES.SUCCESS) {
      return { changed: false, payment: clone(payment) };
    }

    if (payment.status === STATES.FAILED && payment.failureReason === 'final') {
      return { changed: false, payment: clone(payment) };
    }

    if (![STATES.PROCESSING, STATES.PENDING, STATES.FAILED].includes(payment.status)) {
      return { changed: false, payment: clone(payment) };
    }

    payment.status = STATES.SUCCESS;
    payment.failureReason = null;
    payment.updatedAt = new Date().toISOString();
    payment.version += 1;
    return { changed: true, payment: clone(payment), source };
  }

  markFailed(paymentId, reason, isFinal = false) {
    const payment = this.paymentsById.get(paymentId);
    if (!payment) {
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    }

    if (payment.status === STATES.SUCCESS) {
      return { changed: false, payment: clone(payment) };
    }

    if (payment.status === STATES.FAILED && payment.failureReason === 'final') {
      return { changed: false, payment: clone(payment) };
    }

    payment.status = STATES.FAILED;
    payment.failureReason = isFinal ? 'final' : reason;
    payment.updatedAt = new Date().toISOString();
    payment.version += 1;
    return { changed: true, payment: clone(payment) };
  }

  recordWebhookEvent(providerEventId) {
    if (this.processedWebhookEventIds.has(providerEventId)) {
      return false;
    }
    this.processedWebhookEventIds.add(providerEventId);
    return true;
  }

  allPayments() {
    return [...this.paymentsById.values()].map(clone);
  }
}

module.exports = { PaymentStore };
