/**
 * pusher.js — Push rate ke program Solana on-chain
 *
 * Instruksi: update_rate(new_rate: BN)
 * Signer:    oracle_authority keypair
 * Account:   rate_oracle PDA
 */
const {
  Connection, Keypair, PublicKey,
  sendAndConfirmTransaction, Transaction
} = require("@solana/web3.js")
const anchor = require("@anchor-lang/core")
const fs     = require("fs")
const log    = require("./logger")

require("dotenv").config()

// ── Config ────────────────────────────────────────────────────────────────────
const RPC_URL          = process.env.RPC_URL          ?? "https://api.devnet.solana.com"
const PROGRAM_ID_STR   = process.env.PROGRAM_ID       ?? "6YvSSddw36yhm7Js7xzJ84sDNvgYGqncPEY8jR7aWxX1"
const RATE_ORACLE_STR  = process.env.RATE_ORACLE_PDA  ?? "CQUmunTiLX24hq4kLfgRyeWGMzB1B95gyd2pMfWhRKZ"
const KEYPAIR_PATH     = process.env.ORACLE_KEYPAIR   ?? "/root/.config/solana/panen/oracle-authority.json"

// ── Load IDL ─────────────────────────────────────────────────────────────────
// IDL di-copy dari anchor build output
let IDL = null
try {
  IDL = require("../idl/panen.json")
} catch {
  log.warn("[pusher] IDL tidak ditemukan di ../idl/panen.json")
}

// ── Setup connection & wallet ─────────────────────────────────────────────────
const connection = new Connection(RPC_URL, "confirmed")

function loadKeypair() {
  if (!fs.existsSync(KEYPAIR_PATH)) {
    throw new Error(`Keypair tidak ditemukan: ${KEYPAIR_PATH}`)
  }
  const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8"))
  return Keypair.fromSecretKey(Uint8Array.from(raw))
}

// ── Push rate ke on-chain ─────────────────────────────────────────────────────
async function pushRate(rateRaw) {
  if (!IDL) throw new Error("IDL tidak tersedia — copy dari target/idl/panen.json")

  const authority      = loadKeypair()
  const programId      = new PublicKey(PROGRAM_ID_STR)
  const rateOraclePda  = new PublicKey(RATE_ORACLE_STR)

  // Cek balance sebelum push
  const balance = await connection.getBalance(authority.publicKey)
  const balSOL  = balance / 1e9
  log.info("[pusher] Authority balance", {
    pubkey:  authority.publicKey.toBase58().slice(0, 8) + "…",
    balance: `${balSOL.toFixed(4)} SOL`,
  })

  if (balance < 0.005 * 1e9) {
    throw new Error(`Balance terlalu rendah: ${balSOL.toFixed(4)} SOL (min 0.005 SOL)`)
  }

  // Buat Anchor provider
  const wallet   = new anchor.Wallet(authority)
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" })
  anchor.setProvider(provider)

  const program = new anchor.Program(IDL, provider)

  log.info("[pusher] Pushing rate", {
    rateRaw,
    rateIdr:    rateRaw / 10_000,
    rateOracle: RATE_ORACLE_STR.slice(0, 8) + "…",
  })

  const tx = await program.methods
    .updateRate(new anchor.BN(rateRaw))
    .accounts({
      authority:  authority.publicKey,
      rateOracle: rateOraclePda,
    })
    .signers([authority])
    .rpc()

  log.info("[pusher] TX confirmed", { sig: tx })
  return tx
}

// ── Read current on-chain rate ────────────────────────────────────────────────
async function readOnChainRate() {
  if (!IDL) return null

  try {
    const authority = loadKeypair()
    const wallet    = new anchor.Wallet(authority)
    const provider  = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" })
    anchor.setProvider(provider)

    const program      = new anchor.Program(IDL, provider)
    const rateOraclePda = new PublicKey(RATE_ORACLE_STR)

    const data = await program.account.rateOracle.fetch(rateOraclePda)
    return {
      rateRaw:     data.idrPerUsdc.toNumber(),
      rateIdr:     data.idrPerUsdc.toNumber() / 10_000,
      isActive:    data.isActive,
      lastUpdated: new Date(data.lastUpdated.toNumber() * 1000).toISOString(),
    }
  } catch (err) {
    log.warn("[pusher] Failed to read on-chain rate", { error: err.message })
    return null
  }
}

module.exports = { pushRate, readOnChainRate }
