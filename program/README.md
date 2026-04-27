# Program — Anchor Smart Contract

Solana program (Rust/Anchor 1.0) untuk Panen Protocol. Berisi semua logika on-chain: agreement lifecycle, delivery receipt, advance disbursement, dan settlement.

**Program ID:** `Co2fcVRVsGM4ZNGd5UMFVxdAvoRcpqoSpCvgdJzEUTjj` (Solana Devnet)

## Prerequisites

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Anchor 1.0
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest && avm use latest

# Node.js 18+ dan yarn
npm install -g yarn
```

## Setup & Deploy

```bash
cd program

# 1. Install script dependencies
yarn install

# 2. Build program
anchor build

# 3. Buat keypairs (jika belum ada)
mkdir -p /path/to/keypairs
solana-keygen new -o /path/to/pool-authority.json   --no-bip39-passphrase
solana-keygen new -o /path/to/oracle-authority.json --no-bip39-passphrase
solana-keygen new -o /path/to/demo-mill.json        --no-bip39-passphrase
solana-keygen new -o /path/to/demo-koperasi.json    --no-bip39-passphrase

# 4. Airdrop SOL (devnet)
solana airdrop 2 $(solana-keygen pubkey /path/to/pool-authority.json)   --url devnet
solana airdrop 1 $(solana-keygen pubkey /path/to/oracle-authority.json) --url devnet

# 5. Deploy
anchor deploy --provider.cluster devnet

# 6. Copy environment
cp .env.example .env
# Edit .env — isi path keypair

# 7. Initialize (sekali saja)
yarn tsx scripts/initialize.ts

# 8. Deposit USDC ke pool
yarn tsx scripts/deposit.ts 1000
```

## Scripts

| Script | Fungsi |
|---|---|
| `initialize.ts` | Setup lengkap: oracle + pool + set rate awal |
| `deposit.ts <amount>` | Deposit USDC ke advance pool |
| `withdraw.ts <amount>` | Tarik USDC dari pool (hanya available) |
| `update-rate.ts` | Push rate IDR/USDC terbaru dari Bank Indonesia |
| `setup-demo.ts` | Setup agreement antara demo-mill dan demo-koperasi |
| `set-oracle-authority.ts` | Update oracle authority (untuk rotasi keypair) |
| `init-oracle-only.ts` | Init oracle saja tanpa pool |

## Instruksi On-chain

| Instruksi | Caller | Fungsi |
|---|---|---|
| `initialize_rate_oracle` | Oracle authority | Deploy oracle IDR/USDC |
| `update_rate` | Oracle authority | Push rate baru |
| `initialize_pool` | Pool authority | Deploy advance pool |
| `set_oracle_authority` | Pool authority | Update oracle keypair |
| `deposit_pool` | Pool authority | Deposit USDC |
| `withdraw_pool` | Pool authority | Tarik USDC |
| `propose_agreement` | Koperasi | Ajukan kerjasama ke mill |
| `accept_agreement` | Mill | Terima agreement |
| `cancel_proposal` | Koperasi | Batalkan proposal |
| `deactivate_agreement` | Koperasi/Mill | Tutup agreement |
| `submit_delivery_receipt` | Koperasi | Submit receipt TBS + AI score |
| `mill_cosign_receipt` | Mill | Konfirmasi TBS diterima |
| `create_advance` | Koperasi | Cairkan 80% invoice dalam USDC |
| `settle_advance` | Koperasi | Lunasi advance + 3.5% fee |
| `request_cancel_receipt` | Koperasi | Minta batal receipt |
| `mill_confirm_cancel` | Mill | Konfirmasi pembatalan |
| `close_rejected_receipt` | Koperasi | Tutup receipt yang ditolak |

## Struktur

```
program/
├── programs/panen/src/
│   └── lib.rs           # Program utama (semua instruksi)
├── scripts/
│   ├── config.ts        # Shared config + PDA derivations
│   ├── initialize.ts    # One-time setup
│   ├── deposit.ts
│   ├── withdraw.ts
│   ├── update-rate.ts
│   ├── setup-demo.ts
│   ├── set-oracle-authority.ts
│   └── init-oracle-only.ts
├── target/idl/
│   └── panen.json       # Generated setelah anchor build
├── Anchor.toml
├── Cargo.toml
├── package.json
└── .env.example
```
