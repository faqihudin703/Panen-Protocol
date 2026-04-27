/**
 * fetcher.js — Fetch kurs USD/IDR dari Bank Indonesia
 *
 * Primary:  BI SOAP API (resmi, akurat, update hari kerja)
 * Fallback: frankfurter.app (open source, berbasis ECB data)
 * Fallback2: currency-api CDN (static JSON)
 *
 * Format rate_raw: rate_idr × 10_000
 * Contoh: 17,142 IDR/USDC → raw = 171_420_000
 */
const axios  = require("axios")
const xml2js = require("xml2js")
const log    = require("./logger")

const TIMEOUT = 30_000 // ms

// ── Helpers ───────────────────────────────────────────────────────────────────

function toBI(d) {
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

function lastWorkday(from = new Date()) {
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1)
  }
  return d
}

// ── Primary: Bank Indonesia SOAP ─────────────────────────────────────────────

const BI_BASE    = "https://www.bi.go.id/biwebservice/wskursbi.asmx/getSubKursLokal3"
const BI_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept":          "text/xml, application/xml, */*",
  "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
  "Referer":         "https://www.bi.go.id/",
}

async function fetchFromBI() {
  const asOf      = lastWorkday()
  const startDate = new Date(asOf)
  startDate.setDate(startDate.getDate() - 14)

  const url = `${BI_BASE}?mts=USD&startdate=${toBI(startDate)}&enddate=${toBI(asOf)}`

  let xml
  for (let i = 1; i <= 3; i++) {
    try {
      const resp = await axios.get(url, {
        headers:      BI_HEADERS,
        timeout:      TIMEOUT,
        responseType: "text",
      })
      xml = resp.data
      break
    } catch (e) {
      if (i === 3) throw new Error(`BI request failed after 3 retries: ${e.message}`)
      await new Promise(r => setTimeout(r, 1_000 * i))
    }
  }

  const root = await xml2js.parseStringPromise(xml, {
    explicitArray:     false,
    trim:              true,
    ignoreAttrs:       true,
    tagNameProcessors: [xml2js.processors.stripPrefix],
  })

  const newDs = root?.DataSet?.diffgram?.NewDataSet
  if (!newDs?.Table) throw new Error("BI: tidak ada data USD (libur nasional atau API kosong)")

  const rows = Array.isArray(newDs.Table) ? newDs.Table : [newDs.Table]

  const parsed = rows
    .map(row => ({
      beli:    parseFloat(row.beli_subkurslokal ?? "0"),
      jual:    parseFloat(row.jual_subkurslokal ?? "0"),
      nominal: parseFloat(row.nil_subkurslokal  ?? "1"),
      tanggal: new Date(String(row.tgl_subkurslokal ?? "")),
    }))
    .filter(r => r.beli > 0 && r.jual > 0 && !isNaN(r.tanggal.getTime()))

  if (parsed.length === 0) throw new Error("BI: semua baris tidak valid")

  parsed.sort((a, b) => b.tanggal.getTime() - a.tanggal.getTime())
  const latest = parsed[0]

  const tengah  = (latest.beli + latest.jual) / 2 / latest.nominal
  const biDate  = latest.tanggal.toISOString().slice(0, 10)

  log.info("[fetcher] BI OK", { rate: tengah, date: biDate })
  return { rate: tengah, source: "bi_soap", biDate }
}

// ── Fallback 1: frankfurter.app ───────────────────────────────────────────────
async function fetchFromFrankfurter() {
  const res = await axios.get(
    "https://api.frankfurter.app/latest?from=USD&to=IDR",
    { timeout: TIMEOUT }
  )
  const rate = res.data?.rates?.IDR
  if (!rate) throw new Error("Frankfurter: IDR not in response")
  const biDate = res.data?.date ?? new Date().toISOString().slice(0, 10)
  log.info("[fetcher] Frankfurter OK", { rate, date: biDate })
  return { rate, source: "frankfurter", biDate }
}

// ── Fallback 2: currency-api CDN ──────────────────────────────────────────────
async function fetchFromCurrencyAPI() {
  const res = await axios.get(
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
    { timeout: TIMEOUT }
  )
  const rate = res.data?.usd?.idr
  if (!rate) throw new Error("currency-api: IDR not in response")
  const biDate = res.data?.date ?? new Date().toISOString().slice(0, 10)
  log.info("[fetcher] currency-api OK", { rate, date: biDate })
  return { rate, source: "currency_api", biDate }
}

// ── Main fetch dengan fallback ────────────────────────────────────────────────
async function fetchRate() {
  const sources = [
    { name: "BI SOAP",      fn: fetchFromBI          },
    { name: "Frankfurter",  fn: fetchFromFrankfurter },
    { name: "currency-api", fn: fetchFromCurrencyAPI },
  ]

  for (const { name, fn } of sources) {
    try {
      const result = await fn()

      if (result.rate < 10_000 || result.rate > 30_000) {
        log.warn(`[fetcher] Rate ${result.rate} di luar range wajar (10k-30k), skip`, { source: name })
        continue
      }

      const rateRaw = Math.round(result.rate * 10_000)
      return {
        rateIdr: result.rate,
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