const { createShortId } = require('../utils/id');
const { STATES } = require('../utils/stateMachine');

function pickRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

class GatewaySimulator {
  constructor({ webhookSink, rng = Math.random, responseMinDelayMs = 80, responseMaxDelayMs = 250 } = {}) {
    this.webhookSink = webhookSink;
    this.rng = rng;
    this.responseMinDelayMs = responseMinDelayMs;
    this.responseMaxDelayMs = responseMaxDelayMs;
  }

  withWebhookSink(webhookSink) {
    this.webhookSink = webhookSink;
    return this;
  }

  initiateCharge(payment) {
    const providerRef = `gw_${createShortId()}`;
    const responseDelayMs = this._delayBetween(this.responseMinDelayMs, this.responseMaxDelayMs);
    const callbackDelayMs = this._delayBetween(0, Math.max(20, this.responseMaxDelayMs));
    const duplicateCallback = this.rng() < 0.35;
    const duplicateDelayMs = callbackDelayMs + this._delayBetween(20, 120);

    const roll = this.rng();
    let outcome = 'success';
    if (roll < 0.2) outcome = 'failure';
    else if (roll < 0.3) outcome = 'timeout';
    else if (roll < 0.35) outcome = 'failure';

    const callbackStatus = outcome === 'success' ? STATES.SUCCESS : STATES.FAILED;
    const eventId = createShortId('evt_');

    const scheduleWebhook = (delayMs, eventSuffix = '') => {
      if (typeof this.webhookSink !== 'function') return;
      setTimeout(() => {
        this.webhookSink({
          providerEventId: `${eventId}${eventSuffix}`,
          providerRef,
          paymentId: payment.id,
          status: callbackStatus,
          reason: outcome === 'failure' ? 'gateway_declined' : null,
        });
      }, delayMs);
    };

    scheduleWebhook(callbackDelayMs, '');
    if (duplicateCallback) {
      scheduleWebhook(duplicateDelayMs, '_dup');
    }

    const responsePromise = new Promise((resolve, reject) => {
      setTimeout(() => {
        if (outcome === 'timeout') {
          const err = new Error('Gateway timeout');
          err.code = 'GATEWAY_TIMEOUT';
          err.retryable = true;
          err.providerRef = providerRef;
          return reject(err);
        }

        if (outcome === 'failure') {
          const err = new Error('Gateway declined the payment');
          err.code = 'GATEWAY_DECLINED';
          err.retryable = false;
          err.providerRef = providerRef;
          return reject(err);
        }

        return resolve({
          providerRef,
          status: STATES.SUCCESS,
          raw: { approved: true },
        });
      }, responseDelayMs);
    });

    return {
      providerRef,
      responsePromise,
      meta: {
        responseDelayMs,
        callbackDelayMs,
        duplicateCallback,
        outcome,
      },
    };
  }

  _delayBetween(min, max) {
    return Math.floor(min + (max - min) * this.rng());
  }
}

module.exports = { GatewaySimulator };
