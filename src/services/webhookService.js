const { STATES } = require('../utils/stateMachine');
const { AppError } = require('../models/errors');
const logger = require('../utils/logger');

class WebhookService {
  constructor(store) {
    this.store = store;
  }

  handleWebhook(payload) {
    if (!payload || !payload.providerEventId || !payload.providerRef || !payload.status) {
      throw new AppError('Invalid webhook payload', 400, 'INVALID_WEBHOOK_PAYLOAD');
    }

    const fresh = this.store.recordWebhookEvent(payload.providerEventId);
    if (!fresh) {
      logger.info('duplicate webhook ignored', {
        providerEventId: payload.providerEventId,
        providerRef: payload.providerRef,
      });
      return { duplicate: true };
    }

    const payment = this.store.findByProviderRef(payload.providerRef);
    if (!payment) {
      logger.warn('webhook received for unknown provider ref', {
        providerEventId: payload.providerEventId,
        providerRef: payload.providerRef,
      });
      return { duplicate: false, applied: false, reason: 'UNKNOWN_PAYMENT' };
    }

    if (payload.status === STATES.SUCCESS) {
      const result = this.store.markSuccess(payment.id, 'webhook');
      logger.info('webhook success processed', {
        paymentId: payment.id,
        providerRef: payload.providerRef,
        providerEventId: payload.providerEventId,
        changed: result.changed,
      });
      return { duplicate: false, applied: result.changed, payment: result.payment };
    }

    const result = this.store.markFailed(payment.id, payload.reason || 'gateway_failed', false);
    logger.info('webhook failure processed', {
      paymentId: payment.id,
      providerRef: payload.providerRef,
      providerEventId: payload.providerEventId,
      changed: result.changed,
    });
    return { duplicate: false, applied: result.changed, payment: result.payment };
  }
}

module.exports = { WebhookService };
