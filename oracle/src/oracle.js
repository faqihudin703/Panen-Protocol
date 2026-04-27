/**
 * oracle.js — Core oracle logic
 *
 * Fetch rate → validasi → bandingkan dengan on-chain → push kalau perlu
 * Dipanggil oleh scheduler (cron) atau sekali manual
 */
const { fetchRate }       = require("./fetcher")
const { pushRate, readOnChainRate } = require("./pusher")
const db                  = require("./db")
const log                 = require("./logger")

const MIN_DIFF_IDR    = parseFloat(process.env.MIN_DIFF_IDR    ?? "10")
const HEARTBEAT_HOURS = parseFloat(process.env.HEARTBEAT_HOURS ?? "24")

// ── Cek apakah hari kerja Indonesia (Senin-Jumat) ─────────────────────────────
// BI hanya update kurs hari kerja
function isWorkday() {
  const day = new Date().getDay() // 0=Sun, 6=Sat
  return day >= 1 && day <= 5
}

// ── Jam sejak last push ───────────────────────────────────────────────────────
function hoursSinceLastPush() {
  const last = db.getLastPushed()
  if (!last?.pushed_at) return Infinity
  const diff = Date.now() - new Date(last.pushed_at).getTime()
  return diff / (1000 * 60 * 60)
}

// ── Main oracle run ───────────────────────────────────────────────────────────
async function runOracle({ force = false } = {}) {
  log.info("[oracle] ── Run started ──", { force, time: new Date().toISOString() })

  const skip = !isWorkday()
  if (skip && !force) {
    log.info("[oracle] Bukan hari kerja — skip (gunakan force=true untuk override)")
    return { skipped: true, reason: "non_workday" }
  }

  // 1. Fetch rate dari sumber eksternal
  let rateData
  try {
    rateData = await fetchRate()
    log.info("[oracle] Rate fetched", {
      rateIdr:  rateData.rateIdr,
      source:   rateData.source,
      biDate:   rateData.biDate,
    })
  } catch (err) {
    log.error("[oracle] Fetch rate failed", { error: err.message })
    return { success: false, error: err.message }
  }

  // 2. Simpan ke history DB
  const historyId = db.insertRate({
    rate_raw: rateData.rateRaw,
    rate_idr: rateData.rateIdr,
    source:   rateData.source,
    bi_date:  rateData.biDate,
  })

  // 3. Baca rate on-chain saat ini
  const onChain = await readOnChainRate()
  log.info("[oracle] On-chain rate", onChain ?? { status: "unavailable" })

  // 4. Putuskan apakah perlu push
  let shouldPush = force

  if (!shouldPush) {
    // Push kalau belum pernah push sama sekali
    if (!onChain) {
      shouldPush = true
      log.info("[oracle] Push: rate belum ada on-chain")
    }
    // Push kalau selisih cukup besar
    else if (Math.abs(rateData.rateIdr - onChain.rateIdr) >= MIN_DIFF_IDR) {
      shouldPush = true
      log.info("[oracle] Push: selisih rate cukup besar", {
        prev: onChain.rateIdr,
        new:  rateData.rateIdr,
        diff: Math.abs(rateData.rateIdr - onChain.rateIdr).toFixed(2),
      })
    }
    // Push heartbeat kalau sudah lama tidak update
    else if (hoursSinceLastPush() >= HEARTBEAT_HOURS) {
      shouldPush = true
      log.info("[oracle] Push: heartbeat", { hours: hoursSinceLastPush().toFixed(1) })
    }
    else {
      log.info("[oracle] Skip push: rate tidak berubah signifikan", {
        prev:    onChain?.rateIdr,
        new:     rateData.rateIdr,
        minDiff: MIN_DIFF_IDR,
      })
    }
  }

  // 5. Push ke on-chain
  if (shouldPush) {
    try {
      const txSig = await pushRate(rateData.rateRaw)
      db.markPushed(historyId, txSig)
      db.setState("last_rate_raw", rateData.rateRaw)
      db.setState("last_rate_idr", rateData.rateIdr)
      db.setState("last_push_at",  new Date().toISOString())

      log.info("[oracle] ✅ Rate pushed", {
        rateIdr: rateData.rateIdr,
        rateRaw: rateData.rateRaw,
        tx:      txSig,
      })

      return {
        success:  true,
        pushed:   true,
        rateIdr:  rateData.rateIdr,
        rateRaw:  rateData.rateRaw,
        source:   rateData.source,
        tx:       txSig,
      }
    } catch (err) {
      log.error("[oracle] Push failed", { error: err.message })
      return { success: false, pushed: false, error: err.message }
    }
  }

  return {
    success:  true,
    pushed:   false,
    rateIdr:  rateData.rateIdr,
    rateRaw:  rateData.rateRaw,
    source:   rateData.source,
    onChain:  onChain?.rateIdr,
  }
}

module.exports = { runOracle }
