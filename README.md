# Panen Protocol

> On-chain receivables financing for Indonesian palm oil smallholder farmers.

**Cooperatives receive 80% of invoice value upfront in USDC — farmers receive IDR the same day. No crypto wallet needed for farmers.**

[![Solana](https://img.shields.io/badge/Solana-Devnet-9945FF?logo=solana)](https://explorer.solana.com/address/Co2fcVRVsGM4ZNGd5UMFVxdAvoRcpqoSpCvgdJzEUTjj?cluster=devnet)
[![Anchor](https://img.shields.io/badge/Anchor-1.0-blue)](https://www.anchor-lang.com/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

Built for **Colosseum Frontier 2026** · Santara Labs

---

## Problem

2.87 million palm oil smallholder farmers in Indonesia deliver fresh fruit bunches (TBS) to mills and wait **14–30 days** to get paid. Cooperatives lack the working capital to bridge this gap. Banks require physical collateral most smallholders don't have.

The receivable is real. The mill will pay. The gap is pure liquidity.

## Solution

Panen Protocol is a DeFi protocol that verifies delivery receipts on-chain and disburses **80% of the invoice value immediately** — before the mill pays.

### Flow

```
Farmer → delivers TBS → Mill
                          ↓ co-signs receipt on-chain
Cooperative submits receipt + AI fraud score
                          ↓ (if score < 70)
Pool disburses 80% USDC → Cooperative → IDR to Farmer (same day)
                          ↓ within 75 days
Mill pays invoice → Cooperative repays 80% + 3.5% fee → Pool
```

### Key Properties

| Property | Detail |
|---|---|
| **Dual-signature** | Both cooperative and mill must sign each receipt |
| **AI verification** | XGBoost classifier (F1=0.9815) checks invoice authenticity |
| **Murabaha compliant** | 3.5% fee structured as Islamic finance margin |
| **EUDR compliant** | GPS coordinates stored on-chain for supply chain traceability |
| **No farmer wallet** | Cooperative acts as on-chain representative |
| **Separated authority** | Pool authority and oracle authority can be different keypairs |

---

## Repository Structure

```
panen-protocol/
├── program/     # Anchor/Rust smart contract + TypeScript scripts
├── frontend/    # React + Vite + TypeScript dApp (bilingual ID/EN)
├── backend/     # KYC service (Node.js + Express + MySQL)
├── ai/          # Invoice classifier (FastAPI + XGBoost)
├── oracle/      # IDR/USDC rate oracle push service (Node.js)
└── README.md
```

---

## Quick Start

### 1. Program

```bash
cd program
yarn install && anchor build
cp .env.example .env   # isi keypair paths
yarn tsx scripts/initialize.ts
yarn tsx scripts/deposit.ts 1000
```

→ Lihat [program/README.md](program/README.md) untuk detail

### 2. AI Classifier

```bash
cd ai
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python train.py   # generate model/classifier.pkl
cp .env.example .env
pm2 start ecosystem.config.json
```

→ Lihat [ai/README.md](ai/README.md) untuk detail

### 3. Backend KYC

```bash
cd backend
npm install
cp .env.example .env   # isi DB credentials
npm run migrate
pm2 start ecosystem.config.json
```

→ Lihat [backend/README.md](backend/README.md) untuk detail

### 4. Oracle Push

```bash
cd oracle
npm install
cp .env.example .env   # isi RATE_ORACLE_PDA dan ORACLE_KEYPAIR
pm2 start ecosystem.config.json
```

→ Lihat [oracle/README.md](oracle/README.md) untuk detail

### 5. Frontend

```bash
cd frontend
npm install
cp .env.example .env   # isi VITE_POOL_AUTHORITY_PUBKEY
npm run build
```

→ Lihat [frontend/README.md](frontend/README.md) untuk detail

---

## Protocol Economics

| | |
|---|---|
| **Advance rate** | 80% dari nilai invoice |
| **Protocol fee** | 3.5% dari advance amount |
| → LP yield | 3.0% → kembali ke vault (LP return) |
| → Protocol treasury | 0.5% → treasury wallet |
| **Settlement window** | 75 hari |
| **Fee efektif** | 2.8% dari nilai invoice total |

### Unit Economics

| Scale | Koperasi | Receipt/bulan | Revenue |
|---|---|---|---|
| Pilot | 10 | 500 | ~$11,800/mo |
| Growth | 50 | 2,500 | ~$59,000/mo |
| Scale | 100 | 5,000 | ~$118,000/mo |

---

## Tech Stack

| Layer | Stack |
|---|---|
| Smart contract | Rust, Anchor 1.0, Solana |
| Token | SPL Token (USDC) |
| AI | XGBoost, scikit-learn, FastAPI, uvicorn |
| Oracle | Node.js, Bank Indonesia SOAP API |
| Frontend | React, Vite 5, TypeScript, Tailwind CSS |
| Backend | Node.js, Express, MySQL |
| Infrastructure | PM2, Cloudflare Tunnel, Tailscale, AWS EC2 |

---

## On-chain Addresses (Devnet)

| Account | Address |
|---|---|
| Program | `Co2fcVRVsGM4ZNGd5UMFVxdAvoRcpqoSpCvgdJzEUTjj` |

---

## Built By

**Harits Faqihuddin (Frozky)** · [Santara Labs](https://santaralabs.xyz) · Cirebon, Indonesia

Superteam Indonesia · Semester 6 Informatics, UIN Siber Syekh Nurjati Cirebon

---

## License

MIT — lihat [LICENSE](LICENSE)
