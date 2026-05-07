# Payment Processing System

A backend assignment project that simulates a real-world payment flow with:

- payment creation
- payment states
- retry logic with exponential backoff
- idempotency protection
- webhook handling
- duplicate callback handling

## Tech Stack

- Node.js
- HTTP built-in module
- In-memory persistence for quick evaluation
- Node test runner for automated tests

## Why this design

This project models the payment lifecycle as a state machine:

`PENDING -> PROCESSING -> SUCCESS / FAILED`

The system keeps payment state in a central store, uses idempotency keys to avoid duplicate payment creation, and deduplicates webhooks using provider event IDs.

## Project Structure

```text
src/
  app.js
  server.js
  store/paymentStore.js
  services/
    paymentService.js
    paymentProcessor.js
    webhookService.js
    gatewaySimulator.js
  utils/
    backoff.js
    logger.js
    stateMachine.js
    id.js
  models/errors.js

test/
  payment-system.test.js
```

## Run Locally

```bash
npm install
npm start
```

Server starts on `http://localhost:3000`.

## Run Tests

```bash
npm test
```

## API Endpoints

### `POST /payments`
Create a payment.

Example:

```bash
curl -X POST http://localhost:3000/payments \
  -H 'content-type: application/json' \
  -d '{
    "merchantId":"m1",
    "amount":1000,
    "currency":"INR",
    "idempotencyKey":"abc123"
  }'
```

### `GET /payments/:id`
Fetch payment status.

### `GET /payments`
List all payments.

### `POST /webhooks/gateway`
Simulate a gateway callback.

## Core Behavior

### Idempotency
The store keeps a unique merchant + idempotency key mapping. A repeated request with the same payload returns the same payment. If the same key is reused with different data, the API returns a conflict.

### Retry Logic
Transient failures such as timeouts are retried with exponential backoff. Retries stop after `maxAttempts`.

### Webhook Handling
Webhook events are deduplicated using `providerEventId`. Duplicate callbacks are ignored. Conflicting terminal updates are rejected by the state machine rules.

### Concurrency Control
A payment can be actively processed by only one in-memory worker at a time. The payment claim step prevents parallel processing in this implementation.

## Assumptions

- The project uses an in-memory store so it can run quickly without external services.
- The gateway simulator triggers both direct responses and webhook callbacks to exercise real-world edge cases.
- The code is intentionally small and readable for submission speed.

## Notes for Submission

This project is ready to be pushed to GitHub or zipped and attached to an email.
