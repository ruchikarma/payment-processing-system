const http = require('node:http');
const { createApp } = require('./app');
const { AppError } = require('./models/errors');

const { paymentService, webhookService, store } = createApp();

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new AppError('Payload too large', 413, 'PAYLOAD_TOO_LARGE'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new AppError('Invalid JSON', 400, 'INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/payments') {
      const body = await readBody(req);
      const result = await paymentService.createPayment(body);
      return sendJson(res, result.reused ? 200 : 201, result);
    }

    if (req.method === 'GET' && url.pathname.startsWith('/payments/')) {
      const paymentId = url.pathname.split('/')[2];
      const payment = paymentService.getPayment(paymentId);
      return sendJson(res, 200, payment);
    }

    if (req.method === 'GET' && url.pathname === '/payments') {
      return sendJson(res, 200, { items: paymentService.listPayments() });
    }

    if (req.method === 'POST' && url.pathname === '/webhooks/gateway') {
      const body = await readBody(req);
      const result = webhookService.handleWebhook(body);
      return sendJson(res, 200, result);
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    const appError = error instanceof AppError ? error : new AppError(error.message || 'Internal error');
    sendJson(res, appError.statusCode || 500, {
      error: appError.code || 'INTERNAL_ERROR',
      message: appError.message,
    });
  }
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0' , () => {
  console.log(`Payment API running on http://localhost:${port}`);
});
