const STATES = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
});

function isTerminal(status) {
  return status === STATES.SUCCESS || status === STATES.FAILED;
}

function canTransition(from, to) {
  if (from === to) return true;

  const allowed = new Set([
    `${STATES.PENDING}->${STATES.PROCESSING}`,
    `${STATES.PROCESSING}->${STATES.SUCCESS}`,
    `${STATES.PROCESSING}->${STATES.FAILED}`,
    `${STATES.PENDING}->${STATES.SUCCESS}`,
    `${STATES.PENDING}->${STATES.FAILED}`,
    `${STATES.FAILED}->${STATES.PROCESSING}`,
  ]);

  return allowed.has(`${from}->${to}`);
}

module.exports = { STATES, isTerminal, canTransition };
