/**
 * fetcher.js — Fetch kurs USD/IDR dari Bank Indonesia
 *
 * Primary:  BI REST API (wskursbi, retry×3, range 14 hari)
 * Fallback: frankfurter.app
 * Fallback2: currency-api CDN (jsdelivr)
 *
 * Format rate_raw: rate_idr × 10_000
 * Contoh: 17,189 IDR/USDC → raw = 171_890_000
 */
const axios  = require("axios")
const xml2js = require("xml2js")
const log    = require("./logger")

const TIMEOUT = 30_000 // ms — lebih lama untuk BI yang kadang lambat

// ── Helpers ───────────────────────────────────────────────────────────────────

function toBI(d) {
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

/** Fetch XML dari BI dengan retry — ECONNRESET umum terjadi di server BI */
async function fetchBiXml(url, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try {
      const res = await axios.get(url, {
        headers: {
          "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept":          "text/xml, application/xml, */*",
          "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
          "Referer":         "https://www.bi.go.id/",
        },
        timeout:      TIMEOUT,
        responseType: "text",
      })
      return res.data
    } catch (e) {
      if (i === retries) throw e
      log.warn(`[fetcher] BI attempt ${i} failed, retry in ${i}s`, { error: e.message })
      await new Promise(r => setTimeout(r, 1_000 * i))
    }
  }
}

// ── Primary: Bank Indonesia REST ──────────────────────────────────────────────
// Pakai getSubKursLokal3 (REST GET) — lebih stabil dari SOAP endpoint
// Range 14 hari ke belakang agar tetap dapat data saat libur nasional panjang
async function fetchFromBI() {
  const endDate   = new Date()
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - 14)

  const url = `https://www.bi.go.id/biwebservice/wskursbi.asmx/getSubKursLokal3` +
              `?mts=USD&startdate=${toBI(startDate)}&enddate=${toBI(endDate)}`

  const xml  = await fetchBiXml(url)
  const root = await xml2js.parseStringPromise(xml, {
    explicitArray:     false,
    trim:              true,
    ignoreAttrs:       true,
    tagNameProcessors: [xml2js.processors.stripPrefix],
  })

  const newDs = root?.DataSet?.diffgram?.NewDataSet
  if (!newDs?.Table) throw new Error("BI: no data in range")

  // Satu baris → object, banyak baris → array
  const rows = Array.isArray(newDs.Table) ? newDs.Table : [newDs.Table]

  const parsed = rows
    .map(row => ({
      beli:    parseFloat(row.beli_subkurslokal ?? "0"),
      jual:    parseFloat(row.jual_subkurslokal ?? "0"),
      tanggal: new Date(String(row.tgl_subkurslokal ?? "")),
    }))
    .filter(r => r.beli > 0 && r.jual > 0 && !isNaN(r.tanggal.getTime()))

  if (parsed.length === 0) throw new Error("BI: all rows invalid after parse")

  // Ambil data terbaru dari range
  parsed.sort((a, b) => b.tanggal.getTime() - a.tanggal.getTime())
  const latest = parsed[0]
  const tengah = (latest.beli + latest.jual) / 2
  const biDate = toBI(latest.tanggal)

  log.info("[fetcher] BI OK", { rate: Math.round(tengah), date: biDate })
  return { rate: tengah, source: "bi_rest", biDate }
}

// ── Fallback 1: frankfurter.app ───────────────────────────────────────────────
async function fetchFromFrankfurter() {
  const res  = await axios.get(
    "https://api.frankfurter.app/latest?from=USD&to=IDR",
    { timeout: TIMEOUT }
  )
  const rate = res.data?.rates?.IDR
  if (!rate) throw new Error("Frankfurter: IDR not in response")
  const biDate = res.data?.date ?? new Date().toISOString().slice(0, 10)
  log.info("[fetcher] Frankfurter OK", { rate: Math.round(rate), date: biDate })
  return { rate, source: "frankfurter", biDate }
}

// ── Fallback 2: currency-api CDN ──────────────────────────────────────────────
async function fetchFromCurrencyAPI() {
  const res  = await axios.get(
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
    { timeout: TIMEOUT }
  )
  const rate = res.data?.usd?.idr
  if (!rate) throw new Error("currency-api: IDR not in response")
  const biDate = res.data?.date ?? new Date().toISOString().slice(0, 10)
  log.info("[fetcher] currency-api OK", { rate: Math.round(rate), date: biDate })
  return { rate, source: "currency_api", biDate }
}

// ── Main fetch dengan fallback ────────────────────────────────────────────────
async function fetchRate() {
  const sources = [
    { name: "BI REST",      fn: fetchFromBI          },
    { name: "Frankfurter",  fn: fetchFromFrankfurter },
    { name: "currency-api", fn: fetchFromCurrencyAPI },
  ]

  for (const { name, fn } of sources) {
    try {
      const result = await fn()

      // Sanity check — IDR/USD wajar 10,000–30,000
      if (result.rate < 10_000 || result.rate > 30_000) {
        log.warn(`[fetcher] Rate ${Math.round(result.rate)} di luar range wajar (10k-30k), skip`, { source: name })
        continue
      }

      const rateRaw = Math.round(result.rate * 10_000)
      return {
        rateIdr: Math.round(result.rate),
        rateRaw,
        source:  result.source,
        biDate:  result.biDate,
      }
    } catch (err) {
      log.warn(`[fetcher] ${name} failed, trying next`, { error: err.message })
    }
  }

  throw new Error("Semua sumber rate gagal diakses")
}

module.exports = { fetchRate }