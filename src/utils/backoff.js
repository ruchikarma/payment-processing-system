function computeBackoffMs(attempt, baseDelayMs = 200, maxDelayMs = 3000) {
  const delay = baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(delay, maxDelayMs);
}

module.exports = { computeBackoffMs };
