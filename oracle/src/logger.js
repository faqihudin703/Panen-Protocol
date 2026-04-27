/**
 * logger.js — Simple structured logger
 */
const LEVEL = { debug:0, info:1, warn:2, error:3 }
const CUR   = LEVEL[process.env.LOG_LEVEL ?? "info"] ?? 1

function fmt(lvl, msg, meta) {
  const ts   = new Date().toISOString()
  const base = `${ts} ${lvl.toUpperCase().padEnd(5)} ${msg}`
  return meta ? `${base} ${JSON.stringify(meta)}` : base
}

module.exports = {
  debug: (msg, meta) => { if (CUR <= 0) console.debug(fmt("debug", msg, meta)) },
  info:  (msg, meta) => { if (CUR <= 1) console.log(fmt("info",  msg, meta)) },
  warn:  (msg, meta) => { if (CUR <= 2) console.warn(fmt("warn",  msg, meta)) },
  error: (msg, meta) => { if (CUR <= 3) console.error(fmt("error", msg, meta)) },
}
