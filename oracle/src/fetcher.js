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
const axios = require("axios")
const xml2js = require("xml2js")
const log   = require("./logger")

const TIMEOUT = 12_000 // ms

// ── Primary: Bank Indonesia SOAP ─────────────────────────────────────────────
async function fetchFromBI() {
  const today = new Date().toISOString().slice(0, 10)

  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getKursThariIni xmlns="http://www.bi.go.id/WebService/KursBI">
      <tglKurs>${today}</tglKurs>
    </getKursThariIni>
  </soap:Body>
</soap:Envelope>`

  const res = await axios.post(
    "https://www.bi.go.id/WebService/KursBI.asmx",
    soapBody,
    {
      timeout: TIMEOUT,
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction":   "http://www.bi.go.id/WebService/KursBI/getKursThariIni",
      },
    }
  )

  const parsed  = await xml2js.parseStringPromise(res.data, { explicitArray: false })
  const envelope = parsed["soap:Envelope"]["soap:Body"]
  const result   = envelope["getKursThariIniResponse"]["getKursThariIniResult"]

  // Parse XML di dalam SOAP response
  const inner = await xml2js.parseStringPromise(result, { explicitArray: false })
  const data  = inner?.Kurs?.data

  if (!data) throw new Error("BI: no data in response")

  // Cari baris USD
  const rows = Array.isArray(data.baris) ? data.baris : [data.baris]
  const usd  = rows.find(r => r.mata_uang === "USD")

  if (!usd) throw new Error("BI: USD not found in response")

  // Gunakan kurs tengah
  const tengah = parseFloat(String(usd.kurs_tengah).replace(/\./g, "").replace(",", "."))
  if (!tengah || isNaN(tengah)) throw new Error(`BI: invalid kurs_tengah: ${usd.kurs_tengah}`)

  const biDate = usd.tgl_subkurslokal ?? today

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
    { name: "BI SOAP",       fn: fetchFromBI          },
    { name: "Frankfurter",   fn: fetchFromFrankfurter },
    { name: "currency-api",  fn: fetchFromCurrencyAPI },
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
