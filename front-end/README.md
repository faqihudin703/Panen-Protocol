# Frontend — React dApp

Interface bilingual (Indonesia/English) untuk Panen Protocol. Dibangun dengan React + Vite + TypeScript + Tailwind CSS.

## Prerequisites

- Node.js 18+
- Phantom wallet browser extension
- Program sudah di-deploy dan di-initialize

## Setup

```bash
cd frontend

# 1. Install dependencies
npm install

# 2. Copy environment
cp .env.example .env
# Edit .env — isi VITE_POOL_AUTHORITY_PUBKEY

# 3. Development server
npm run dev

# 4. Build untuk production
npm run build
```

## Environment

Hanya dua variabel yang wajib diisi manual:

| Variable | Keterangan |
|---|---|
| `VITE_PROGRAM_ID` | Dari `anchor deploy` |
| `VITE_POOL_AUTHORITY_PUBKEY` | Pubkey pool-authority keypair |

Sisanya otomatis:
- `POOL_PUBKEY`, `VAULT_PUBKEY` — di-derive dari `POOL_AUTHORITY_PUBKEY`
- `RATE_ORACLE_PUBKEY`, `TREASURY_PUBKEY` — dibaca dari pool account on-chain

## Fitur

- **Bilingual** — Indonesia (default) / English, toggle di header
- **Koperasi panel** — submit receipt, propose agreement, cairkan advance, resume state
- **Mill panel** — terima agreement, cosign receipt, auto-fill nonce dari on-chain
- **KYC auto-skip** — mill yang sudah terdaftar langsung lanjut tanpa isi form ulang
- **Pool stats** — balance vault, rate oracle, status live dari on-chain
- **Resume flow** — deteksi state on-chain otomatis saat reconnect wallet

## Struktur

```
frontend/
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   ├── components/
│   │   ├── KoperasiPanel.tsx
│   │   ├── MillPanel.tsx
│   │   ├── FlowTimeline.tsx
│   │   ├── TxButton.tsx
│   │   ├── IdlStatus.tsx
│   │   └── VerifikasiResult.tsx
│   ├── config/
│   │   └── constants.ts
│   ├── contexts/
│   │   ├── LangContext.tsx
│   │   ├── ProgramContext.tsx
│   │   └── WalletContext.tsx
│   ├── hooks/
│   │   ├── useAdvanceFlow.ts
│   │   ├── useAgreementFlow.ts
│   │   ├── useChainStats.ts
│   │   ├── useKyc.ts
│   │   ├── useMillFlow.ts
│   │   ├── useMillResumeFlow.ts
│   │   ├── usePdas.ts
│   │   ├── usePoolInfo.ts
│   │   ├── useReceiptFlow.ts
│   │   ├── useResumeFlow.ts
│   │   └── useVerifikasi.ts
│   ├── i18n/
│   │   └── strings.ts
│   ├── idl/
│   │   └── panen.json
│   └── utils/
│       ├── hash.ts
│       └── idr.ts
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── .env.example
```
