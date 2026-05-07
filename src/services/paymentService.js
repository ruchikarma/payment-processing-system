const { AppError } = require('../models/errors');
const logger = require('../utils/logger');

class PaymentService {
  constructor({ store, processor }) {
    this.store = store;
    this.processor = processor;
  }

  async createPayment(input) {
    const { merchantId, amount, currency, idempotencyKey, maxAttempts = 3 } = input || {};
    if (!merchantId || typeof merchantId !== 'string') {
      throw new AppError('merchantId is required', 400, 'INVALID_INPUT');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError('amount must be a positive number', 400, 'INVALID_INPUT');
    }
    if (!currency || typeof currency !== 'string') {
      throw new AppError('currency is required', 400, 'INVALID_INPUT');
    }
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      throw new AppError('idempotencyKey is required', 400, 'INVALID_INPUT');
    }

    const { payment, created } = this.store.createPayment({
      merchantId,
      amount,
      currency,
      idempotencyKey,
      maxAttempts,
    });

    if (!created) {
      this.store.assertPayloadForIdempotency(payment, { merchantId, amount, currency });
      logger.info('idempotent payment request reused', { paymentId: payment.id, idempotencyKey });
      return { payment, reused: true };
    }

    logger.info('payment created', { paymentId: payment.id, idempotencyKey });
    setImmediate(() => this.processor.process(payment.id));
    return { payment, reused: false };
  }

  getPayment(paymentId) {
    const payment = this.store.getPayment(paymentId);
    if (!payment) {
      throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    }
    return payment;
  }

  listPayments() {
    return this.store.allPayments();
  }
}

module.exports = { PaymentService };
