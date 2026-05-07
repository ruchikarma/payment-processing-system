const crypto = require('node:crypto');

function createId(prefix = '') {
  return `${prefix}${crypto.randomUUID().replace(/-/g, '')}`;
}

function createShortId(prefix = '') {
  return `${prefix}${crypto.randomBytes(8).toString('hex')}`;
}

module.exports = { createId, createShortId };
