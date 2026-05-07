const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const currentLevel = process.env.LOG_LEVEL || 'info';
const threshold = levels[currentLevel] ?? levels.info;

function log(level, message, meta = {}) {
  if ((levels[level] ?? 100) < threshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  console.log(JSON.stringify(line));
}

module.exports = {
  debug: (message, meta) => log('debug', message, meta),
  info: (message, meta) => log('info', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  error: (message, meta) => log('error', message, meta),
};
