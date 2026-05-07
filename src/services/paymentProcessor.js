const { STATES } = require('../utils/stateMachine');
const { computeBackoffMs } = require('../utils/backoff');
const logger = require('../utils/logger');

class PaymentProcessor {
  constructor({ store, gateway, webhookService, baseDelayMs = 200, maxDelayMs = 2000 }) {
    this.store = store;
    this.gateway = gateway;
    this.webhookService = webhookService;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.activePayments = new Set();
    this.scheduledRetries = new Map();
  }

  async process(paymentId) {
    if (this.activePayments.has(paymentId)) {
      return { skipped: true, reason: 'already_processing' };
    }

    const claim = this.store.claimForProcessing(paymentId);
    if (!claim.claimed) {
      return { skipped: true, reason: `cannot_claim:${claim.payment.status}` };
    }

    this.activePayments.add(paymentId);
    try {
      const payment = this.store.getPayment(paymentId);
      const session = this.gateway.initiateCharge(payment);
      this.store.attachProviderRef(paymentId, session.providerRef);

      logger.info('payment processing started', {
        paymentId,
        providerRef: session.providerRef,
        attemptCount: claim.payment.attemptCount,
      });

      try {
        const response = await session.responsePromise;
        const success = this.store.markSuccess(paymentId, 'gateway');
        logger.info('gateway approved payment', {
          paymentId,
          providerRef: response.providerRef,
          changed: success.changed,
        });
        return { processed: true, status: success.payment.status, meta: session.meta };
      } catch (err) {
        if (err.code === 'GATEWAY_TIMEOUT' || err.retryable) {
          const failure = this.store.markFailed(paymentId, err.message, false);
          logger.warn('payment attempt failed and will be retried if attempts remain', {
            paymentId,
            providerRef: err.providerRef,
            attemptCount: this.store.getPayment(paymentId).attemptCount,
            reason: err.code,
          });
          this.scheduleRetry(paymentId);
          return { processed: true, status: failure.payment.status, retriable: true };
        }

        const failure = this.store.markFailed(paymentId, err.message, true);
        logger.warn('payment permanently failed', {
          paymentId,
          providerRef: err.providerRef,
          reason: err.code,
        });
        return { processed: true, status: failure.payment.status, retriable: false };
      }
    } finally {
      this.activePayments.delete(paymentId);
    }
  }

  scheduleRetry(paymentId) {
    const payment = this.store.getPayment(paymentId);
    if (!payment) return;

    if (payment.status === STATES.SUCCESS) return;
    if (payment.attemptCount >= payment.maxAttempts) {
      this.store.markFailed(paymentId, 'max_attempts_exhausted', true);
      return;
    }

    if (this.scheduledRetries.has(paymentId)) return;

    const delayMs = computeBackoffMs(payment.attemptCount, this.baseDelayMs, this.maxDelayMs);
    const timer = setTimeout(async () => {
      this.scheduledRetries.delete(paymentId);
      await this.process(paymentId);
    }, delayMs);

    this.scheduledRetries.set(paymentId, timer);
    logger.info('retry scheduled', { paymentId, delayMs, attemptCount: payment.attemptCount });
  }

  cancelRetry(paymentId) {
    const timer = this.scheduledRetries.get(paymentId);
    if (timer) {
      clearTimeout(timer);
      this.scheduledRetries.delete(paymentId);
    }
  }
}

module.exports = { PaymentProcessor };
