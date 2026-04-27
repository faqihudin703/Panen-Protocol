import { PublicKey } from "@solana/web3.js"

// ── Cluster & RPC ─────────────────────────────────────────────────────────────
export const CLUSTER  = (import.meta.env.VITE_CLUSTER ?? "devnet") as "devnet" | "mainnet-beta"
export const RPC_URL  =  import.meta.env.VITE_RPC_URL ?? "https://api.devnet.solana.com"

// ── Backend URLs ──────────────────────────────────────────────────────────────
export const VERIFIKASI_URL = import.meta.env.VITE_VERIFIKASI_URL ?? "http://localhost:5050"
export const KYC_URL        = import.meta.env.VITE_KYC_URL        ?? "http://localhost:5052"

// ── Program ID — tidak berubah setelah deploy ─────────────────────────────────
export const PROGRAM_ID = new PublicKey(
    import.meta.env.VITE_PROGRAM_ID ?? "Co2fcVRVsGM4ZNGd5UMFVxdAvoRcpqoSpCvgdJzEUTjj"
)

// ── Pool Authority — pubkey dari pool-authority.json ──────────────────────────
// Dipakai untuk derive POOL_PUBKEY dan VAULT_PUBKEY secara deterministik
// Tidak perlu .env — derive dari POOL_AUTHORITY_PUBKEY
export const POOL_AUTHORITY_PUBKEY = new PublicKey(
    import.meta.env.VITE_POOL_AUTHORITY_PUBKEY ?? "11111111111111111111111111111111"
)

// ── USDC Mint ─────────────────────────────────────────────────────────────────
export const USDC_MINT = new PublicKey(
    CLUSTER === "devnet"
        ? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
)

// ── PDA seeds ─────────────────────────────────────────────────────────────────
const enc = new TextEncoder()
export const SEED_AGREEMENT   = enc.encode("agreement")
export const SEED_RECEIPT     = enc.encode("receipt")
export const SEED_POOL        = enc.encode("pool")
export const SEED_VAULT       = enc.encode("vault")
export const SEED_ADVANCE     = enc.encode("advance")
export const SEED_RATE_ORACLE = enc.encode("rate_oracle")

// ── Pool PDA — derive deterministik dari pool authority ───────────────────────
// Tidak perlu hardcode — selalu konsisten selama POOL_AUTHORITY_PUBKEY benar
export const [POOL_PUBKEY] = PublicKey.findProgramAddressSync(
    [SEED_POOL, POOL_AUTHORITY_PUBKEY.toBytes()],
    PROGRAM_ID
)

// ── Vault PDA — derive dari pool ─────────────────────────────────────────────
export const [VAULT_PUBKEY] = PublicKey.findProgramAddressSync(
    [SEED_VAULT, POOL_PUBKEY.toBytes()],
    PROGRAM_ID
)

// ── RATE_ORACLE_PUBKEY & TREASURY_PUBKEY — TIDAK hardcode ─────────────────────
// Keduanya diambil dari pool account on-chain:
//   oracle_authority = pool._reserved[0..32]  → derive oracle PDA
//   treasury         = pool.treasury field
// Lihat: hooks/usePoolInfo.ts → usePoolInfo()
// Lihat: hooks/useAdvanceFlow.ts → fetch pool sebelum createAdvance

// ── Protocol constants — mirror dari Rust ─────────────────────────────────────
export const ADVANCE_RATE_BPS       = 8_000   // 80%
export const SERVICE_FEE_BPS        = 350     // 3.5% total
export const PROTOCOL_FEE_BPS       = 50      // 0.5% treasury
export const LP_YIELD_BPS           = 300     // 3.0% vault
export const FRAUD_REJECT_THRESHOLD  = 62.8    // 0.628 × 100 (AI threshold)
export const VERIFIKASI_THRESHOLD    = 62.8    // alias untuk useVerifikasi
export const USDC_DECIMALS          = 6
export const USDC_MULTIPLIER        = 1_000_000

// ── Display rate — fallback sebelum oracle dibaca ─────────────────────────────
export const DISPLAY_RATE_RAW = 171_890_000 // 17,189 IDR/USDC × 10_000