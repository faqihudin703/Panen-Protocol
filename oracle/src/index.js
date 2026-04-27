/**
 * index.js — Panen Protocol Rate Oracle Service
 *
 * Mode:
 *   node src/index.js          → daemon mode (cron scheduler)
 *   node src/index.js --once   → jalankan sekali lalu exit
 *   node src/index.js --force  → force push walau rate tidak berubah
 *   node src/index.js --status → tampilkan status saat ini
 *
 * Schedule default: setiap hari jam 08.00 WIB (cron: 0 1 * * *)
 */
require("dotenv").config()

const cron       = require("node-cron")
const { runOracle } = require("./oracle")
const { readOnChainRate } = require("./pusher")
const db         = require("./db")
const log        = require("./logger")

const CRON_SCHEDULE = process.env.CRON_SCHEDULE ?? "0 1 * * *"

// ── Parse args ────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2)
const once   = args.includes("--once")
const force  = args.includes("--force")
const status = args.includes("--status")

// ── Status command ────────────────────────────────────────────────────────────
async function showStatus() {
  log.info("[status] Panen Oracle Status")

  // On-chain
  const onChain = await readOnChainRate()
  if (onChain) {
    log.info("[status] On-chain rate", {
      rateIdr:     onChain.rateIdr,
      rateRaw:     onChain.rateRaw,
      isActive:    onChain.isActive,
      lastUpdated: onChain.lastUpdated,
    })
  } else {
    log.warn("[status] On-chain rate: tidak dapat dibaca")
  }

  // Last push
  const lastPush = db.getLastPushed()
  if (lastPush) {
    log.info("[status] Last push", {
      rateIdr:   lastPush.rate_idr,
      source:    lastPush.source,
      biDate:    lastPush.bi_date,
      pushedAt:  lastPush.pushed_at,
      tx:        lastPush.tx_sig,
    })
  }

  // History 5 terakhir
  const history = db.getHistory(5)
  log.info("[status] Rate history (5 terbaru):")
  history.forEach(h => {
    const pushed = h.pushed ? `✅ ${h.pushed_at}` : "⬜ not pushed"
    log.info(`  ${h.created_at} | Rp${h.rate_idr.toLocaleString("id-ID")}/USDC | ${h.source} | ${pushed}`)
  })

  // Config
  log.info("[status] Config", {
    cluster:      process.env.CLUSTER ?? "devnet",
    programId:    process.env.PROGRAM_ID,
    rateOraclePda: process.env.RATE_ORACLE_PDA,
    cronSchedule: CRON_SCHEDULE,
    minDiff:      process.env.MIN_DIFF_IDR ?? "10",
    heartbeat:    `${process.env.HEARTBEAT_HOURS ?? "24"}h`,
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  log.info("  Panen Protocol — Rate Oracle Service")
  log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  log.info("[main] Cluster:  " + (process.env.CLUSTER ?? "devnet"))
  log.info("[main] Schedule: " + CRON_SCHEDULE)

  if (status) {
    await showStatus()
    process.exit(0)
  }

  if (once || force) {
    log.info(`[main] Mode: ${force ? "force-push" : "one-shot"}`)
    const result = await runOracle({ force })
    log.info("[main] Result", result)
    process.exit(result.success || result.skipped ? 0 : 1)
  }

  // Daemon mode — cron scheduler
  log.info(`[main] Daemon mode — cron: ${CRON_SCHEDULE}`)

  if (!cron.validate(CRON_SCHEDULE)) {
    log.error("[main] CRON_SCHEDULE tidak valid:", CRON_SCHEDULE)
    process.exit(1)
  }

  // Jalankan sekali saat startup
  log.info("[main] Running initial check on startup…")
  try {
    const result = await runOracle({ force: false })
    log.info("[main] Startup run result", result)
  } catch (err) {
    log.error("[main] Startup run error", { error: err.message })
  }

  // Schedule
  cron.schedule(CRON_SCHEDULE, async () => {
    log.info("[cron] Triggered")
    try {
      const result = await runOracle({ force: false })
      log.info("[cron] Result", result)
    } catch (err) {
      log.error("[cron] Error", { error: err.message })
    }
  }, {
    timezone: "Asia/Jakarta",
  })

  log.info("[main] Oracle running — waiting for schedule")

  // Graceful shutdown
  process.on("SIGTERM", () => {
    log.info("[main] SIGTERM received — shutting down")
    process.exit(0)
  })
  process.on("SIGINT", () => {
    log.info("[main] SIGINT received — shutting down")
    process.exit(0)
  })
}

main().catch(err => {
  log.error("[main] Fatal error", { error: err.message, stack: err.stack })
  process.exit(1)
})
