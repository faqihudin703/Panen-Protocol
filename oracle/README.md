# Oracle — Rate Oracle Push Service

Service Node.js yang push kurs IDR/USDC terbaru dari Bank Indonesia ke RateOracle on-chain. Berjalan sebagai daemon via PM2 dengan schedule cron harian.

## Prerequisites

- Node.js 18+
- Oracle keypair sudah terdaftar di pool (via `initialize_pool`)
- SOL di oracle-authority wallet untuk transaction fee

## Setup

```bash
cd oracle

# 1. Install dependencies
npm install

# 2. Copy environment
cp .env.example .env
# Edit .env — isi RATE_ORACLE_PDA dan ORACLE_KEYPAIR path

# 3. Test push manual
node src/index.js

# 4. Jalankan daemon via PM2
pm2 start src/index.js
pm2 save
pm2 startup   # auto-start setelah reboot
```

## Cara Kerja

1. Fetch rate IDR/USDC dari **Bank Indonesia SOAP API** (sumber utama)
2. Fallback ke **Frankfurter API** jika BI tidak tersedia
3. Bandingkan dengan rate on-chain — push hanya jika selisih ≥ `MIN_DIFF_IDR`
4. Heartbeat setiap 24 jam meski rate tidak berubah (agar oracle tetap aktif)
5. Staleness protection: kalau oracle tidak diupdate > 48 jam, program otomatis pakai `FALLBACK_IDR_PER_USDC_RAW`

## Format Rate

Rate disimpan on-chain sebagai `idr_per_usdc × 10_000`:

```
17,189 IDR/USDC → 171_890_000 (raw)
```

Rentang valid: 10,000–100,000 IDR/USDC (dikonfigurasi di `lib.rs`)

## Struktur

```
oracle/
├── src/
│   ├── index.js          # Main daemon + cron scheduler
│   ├── pusher.js         # On-chain push logic
│   ├── fetcher.js        # Fetch rate dari BI / Frankfurter
│   ├── oracle.js         # Orchestrator
│   ├── logger.js         # Logging
│   └── db.js             # SQlite db untuk history
├── idl/
│   └── panen.json
├── package.json
├── push.json
└── .env.example
```
