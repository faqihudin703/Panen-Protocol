/**
 * config.ts — Shared configuration for Panen Protocol scripts
 *
 * Keypair paths dan RPC URL dibaca dari environment variables (.env).
 * Copy .env.example ke .env dan isi sesuai setup lokal.
 *
 * Usage: pastikan .env sudah diisi sebelum jalankan script apapun.
 */

import * as anchor from "@anchor-lang/core"
import { Connection, Keypair, PublicKey } from "@solana/web3.js"
import * as fs   from "fs"
import * as path from "path"
import * as dotenv from "dotenv"

// Load .env dari root program/
dotenv.config({ path: path.resolve(__dirname, "../.env") })

// ── Network ───────────────────────────────────────────────────────────────────
export const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com"
export const CLUSTER: "mainnet-beta" | "devnet" =
    RPC_URL.includes("mainnet") ? "mainnet-beta" : "devnet"

// ── Program ID ────────────────────────────────────────────────────────────────
// Update setelah `anchor deploy`
export const PROGRAM_ID = new PublicKey(
    process.env.PROGRAM_ID ?? "Co2fcVRVsGM4ZNGd5UMFVxdAvoRcpqoSpCvgdJzEUTjj"
)

// ── USDC Mint ─────────────────────────────────────────────────────────────────
// Devnet:  4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU (Circle devnet faucet)
// Mainnet: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
export const USDC_MINT = new PublicKey(
    process.env.USDC_MINT ?? (
        CLUSTER === "devnet"
            ? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
            : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    )
)

// ── Seeds — mirror dari Rust constants ───────────────────────────────────────
export const SEED_AGREEMENT   = Buffer.from("agreement")
export const SEED_RECEIPT     = Buffer.from("receipt")
export const SEED_POOL        = Buffer.from("pool")
export const SEED_VAULT       = Buffer.from("vault")
export const SEED_ADVANCE     = Buffer.from("advance")
export const SEED_RATE_ORACLE = Buffer.from("rate_oracle")

// ── Protocol constants — mirror dari Rust ────────────────────────────────────
export const ADVANCE_RATE_BPS = 8_000n  // 80% dari invoice
export const SERVICE_FEE_BPS  = 350n    // 3.5% dari advance (total)
export const PROTOCOL_FEE_BPS = 50n     // 0.5% → treasury
export const LP_YIELD_BPS     = 300n    // 3.0% → vault (LP yield)
export const USDC_DECIMALS    = 6
export const USDC_MULTIPLIER  = 1_000_000n

// ── Keypair loader ────────────────────────────────────────────────────────────
function loadKeypair(envKey: string, fallbackPath?: string): Keypair {
    const filePath = process.env[envKey] ?? fallbackPath
    if (!filePath) {
        throw new Error(
            `Keypair path not set. Add ${envKey}=/path/to/keypair.json to .env`
        )
    }
    const resolved = path.resolve(filePath)
    if (!fs.existsSync(resolved)) {
        throw new Error(
            `Keypair file not found: ${resolved}\n` +
            `Run: solana-keygen new -o ${resolved} --no-bip39-passphrase`
        )
    }
    return Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(resolved, "utf8")))
    )
}

export function getPoolAuthority():   Keypair { return loadKeypair("POOL_AUTHORITY_KEYPAIR") }
export function getOracleAuthority(): Keypair { return loadKeypair("ORACLE_AUTHORITY_KEYPAIR") }
export function getDemoMill():        Keypair { return loadKeypair("DEMO_MILL_KEYPAIR") }
export function getDemoKoperasi():    Keypair { return loadKeypair("DEMO_KOPERASI_KEYPAIR") }

// ── PDA derivations ───────────────────────────────────────────────────────────
export function deriveRateOracle(authority: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [SEED_RATE_ORACLE, authority.toBuffer()], PROGRAM_ID
    )
}
export function derivePool(authority: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [SEED_POOL, authority.toBuffer()], PROGRAM_ID
    )
}
export function deriveVault(pool: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [SEED_VAULT, pool.toBuffer()], PROGRAM_ID
    )
}
export function deriveAgreement(mill: PublicKey, koperasi: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [SEED_AGREEMENT, mill.toBuffer(), koperasi.toBuffer()], PROGRAM_ID
    )
}
export function deriveReceipt(agreement: PublicKey, nonce: bigint): [PublicKey, number] {
    const nonceBuf = Buffer.alloc(8)
    nonceBuf.writeBigUInt64LE(nonce)
    return PublicKey.findProgramAddressSync(
        [SEED_RECEIPT, agreement.toBuffer(), nonceBuf], PROGRAM_ID
    )
}
export function deriveAdvance(receipt: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [SEED_ADVANCE, receipt.toBuffer()], PROGRAM_ID
    )
}

// ── Anchor setup ──────────────────────────────────────────────────────────────
export function getConnection(): Connection {
    return new Connection(RPC_URL, "confirmed")
}

function findIdl(): string {
    // Cari IDL dari beberapa lokasi umum
    const candidates = [
        path.resolve(__dirname, "../target/idl/panen.json"),   // standard anchor output
        path.resolve(__dirname, "../../target/idl/panen.json"),
        path.resolve(__dirname, "../idl/panen.json"),           // kalau copy manual
    ]
    for (const p of candidates) {
        if (fs.existsSync(p)) return p
    }
    throw new Error(
        `IDL not found. Run 'anchor build' first.\nSearched:\n${candidates.join("\n")}`
    )
}

export function getProgram(signer: Keypair): anchor.Program {
    const connection = getConnection()
    const provider   = new anchor.AnchorProvider(
        connection,
        new anchor.Wallet(signer),
        { commitment: "confirmed", preflightCommitment: "confirmed" }
    )
    anchor.setProvider(provider)

    // Anchor 1.0: constructor(idl, provider) — no programId arg
    // Override idl.address agar selalu sync dengan PROGRAM_ID di config
    const idl = JSON.parse(fs.readFileSync(findIdl(), "utf8"))
    idl.address = PROGRAM_ID.toBase58()
    return new anchor.Program(idl, provider)
}

// ── Explorer links ────────────────────────────────────────────────────────────
const clusterParam = CLUSTER === "devnet" ? "?cluster=devnet" : ""
export const explorerUrl  = (sig: string)   =>
    `https://explorer.solana.com/tx/${sig}${clusterParam}`
export const accountUrl   = (pk: PublicKey) =>
    `https://explorer.solana.com/address/${pk.toBase58()}${clusterParam}`