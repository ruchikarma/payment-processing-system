const { PaymentStore } = require('./store/paymentStore');
const { GatewaySimulator } = require('./services/gatewaySimulator');
const { WebhookService } = require('./services/webhookService');
const { PaymentProcessor } = require('./services/paymentProcessor');
const { PaymentService } = require('./services/paymentService');

function createApp(options = {}) {
  const store = options.store || new PaymentStore();
  const webhookService = new WebhookService(store);
  const gateway = options.gateway || new GatewaySimulator({ webhookSink: (payload) => webhookService.handleWebhook(payload) });
  gateway.withWebhookSink((payload) => webhookService.handleWebhook(payload));
  const processor = new PaymentProcessor({
    store,
    gateway,
    webhookService,
    baseDelayMs: options.baseDelayMs || 150,
    maxDelayMs: options.maxDelayMs || 1200,
  });
  const paymentService = new PaymentService({ store, processor });

  return { store, gateway, webhookService, processor, paymentService };
}

module.exports = { createApp };
