/**
 * initialize.ts — One-time setup Panen Protocol
 *
 * Step 0: Verifikasi program deployed
 * Step 1: initialize_rate_oracle (oracle authority)
 * Step 2: initialize_pool (pool authority + oracle authority)
 * Step 3: update_rate (set rate awal dari BI)
 *
 * Usage: yarn tsx scripts/initialize.ts
 *
 * Prerequisites:
 *   1. anchor build && anchor deploy
 *   2. Copy .env.example → .env dan isi semua values
 *   3. Pastikan pool-authority dan oracle-authority punya SOL
 *      solana airdrop 2 <pubkey> --url devnet
 */

import {
    getPoolAuthority, getOracleAuthority,
    getProgram, getConnection,
    deriveRateOracle, derivePool, deriveVault,
    explorerUrl, accountUrl,
    PROGRAM_ID, USDC_MINT, CLUSTER,
} from "./config"

import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js"
import { getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token"
import * as anchor from "@anchor-lang/core"

// Rate awal — IDR/USDC × 10_000
// Contoh: 17,189 IDR/USDC → 171_890_000
// Update sesuai kurs BI saat initialize
const INITIAL_RATE_RAW = 171_890_000n

async function main() {
    console.log("🌾 Panen Protocol — Initialize")
    console.log(`   Cluster: ${CLUSTER}`)
    console.log(`   Program: ${PROGRAM_ID.toBase58()}`)
    console.log("─".repeat(50))

    const connection = getConnection()
    const poolAuth   = getPoolAuthority()
    const oracleAuth = getOracleAuthority()

    console.log(`\n📋 Keypairs:`)
    console.log(`   Pool Authority:   ${poolAuth.publicKey.toBase58()}`)
    console.log(`   Oracle Authority: ${oracleAuth.publicKey.toBase58()}`)
    console.log(`   USDC Mint:        ${USDC_MINT.toBase58()}`)

    // Cek balance
    const [poolBal, oracleBal] = await Promise.all([
        connection.getBalance(poolAuth.publicKey),
        connection.getBalance(oracleAuth.publicKey),
    ])
    console.log(`\n💰 Balances:`)
    console.log(`   Pool Authority:   ${(poolBal   / 1e9).toFixed(4)} SOL`)
    console.log(`   Oracle Authority: ${(oracleBal / 1e9).toFixed(4)} SOL`)

    if (poolBal < 0.05 * 1e9) throw new Error(
        `Pool authority SOL tidak cukup: ${(poolBal/1e9).toFixed(4)} SOL\n` +
        `   → solana airdrop 2 ${poolAuth.publicKey.toBase58()} --url devnet`
    )
    if (oracleBal < 0.01 * 1e9) throw new Error(
        `Oracle authority SOL tidak cukup: ${(oracleBal/1e9).toFixed(4)} SOL\n` +
        `   → solana airdrop 1 ${oracleAuth.publicKey.toBase58()} --url devnet`
    )

    // ── Step 0: Verifikasi program ─────────────────────────────────────────
    console.log(`\n[0/3] Verifying program...`)
    const progInfo = await connection.getAccountInfo(PROGRAM_ID)
    if (!progInfo)            throw new Error(`Program tidak ditemukan: ${PROGRAM_ID.toBase58()}\n   → anchor build && anchor deploy`)
    if (!progInfo.executable) throw new Error(`Bukan executable program`)
    console.log(`   ✅ Program active — ${(progInfo.data.length / 1024).toFixed(1)} KB`)
    console.log(`   ${accountUrl(PROGRAM_ID)}`)

    // Derive PDAs
    const [rateOraclePda] = deriveRateOracle(oracleAuth.publicKey)
    const [poolPda]       = derivePool(poolAuth.publicKey)
    const [vaultPda]      = deriveVault(poolPda)

    console.log(`\n🔑 PDAs:`)
    console.log(`   RateOracle: ${rateOraclePda.toBase58()}`)
    console.log(`   Pool:       ${poolPda.toBase58()}`)
    console.log(`   Vault:      ${vaultPda.toBase58()}`)

    const oracleProg = getProgram(oracleAuth)
    const poolProg   = getProgram(poolAuth)

    // ── Step 1: Rate Oracle ────────────────────────────────────────────────
    console.log(`\n[1/3] Initializing Rate Oracle...`)
    try {
        const existing = await oracleProg.account.rateOracle.fetch(rateOraclePda)
        console.log(`   ✅ Already exists`)
        console.log(`      authority  = ${(existing.authority as PublicKey).toBase58()}`)
        console.log(`      is_active  = ${existing.isActive}`)
        if (existing.isActive) {
            console.log(`      rate       = ${Number(existing.idrPerUsdc) / 10_000} IDR/USDC`)
        }
    } catch {
        const tx = await oracleProg.methods
            .initializeRateOracle()
            .accounts({
                authority:     oracleAuth.publicKey,
                rateOracle:    rateOraclePda,
                systemProgram: SystemProgram.programId,
            })
            .signers([oracleAuth])
            .rpc()
        console.log(`   ✅ Created`)
        console.log(`   ${explorerUrl(tx)}`)
    }

    // ── Step 2: Pool (dengan oracle_authority langsung) ────────────────────
    console.log(`\n[2/3] Initializing Pool...`)

    // Treasury = pool authority ATA
    // Protocol fee (0.5%) akan masuk ke sini
    const treasuryAta = await getOrCreateAssociatedTokenAccount(
        connection, poolAuth, USDC_MINT, poolAuth.publicKey
    )
    console.log(`   Treasury ATA: ${treasuryAta.address.toBase58()}`)

    try {
        const existing = await poolProg.account.advancePool.fetch(poolPda)
        console.log(`   ✅ Already exists`)
        console.log(`      oracle_authority = ${(existing.oracleAuthority as PublicKey).toBase58()}`)
        console.log(`      total_deposited  = ${Number(existing.totalDeposited) / 1e6} USDC`)
        console.log(`      total_advanced   = ${Number(existing.totalAdvanced)  / 1e6} USDC`)
        console.log(`      lp_yield_bps     = ${existing.lpYieldBps} (${existing.lpYieldBps / 100}%)`)
        console.log(`      protocol_fee_bps = ${existing.protocolFeeBps} (${existing.protocolFeeBps / 100}%)`)
    } catch {
        // oracle_authority dipass langsung sebagai parameter
        // tidak perlu set_oracle_authority terpisah
        const tx = await poolProg.methods
            .initializePool(oracleAuth.publicKey)
            .accounts({
                authority:     poolAuth.publicKey,
                mint:          USDC_MINT,
                pool:          poolPda,
                vault:         vaultPda,
                treasury:      treasuryAta.address,
                tokenProgram:  TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent:          SYSVAR_RENT_PUBKEY,
            })
            .signers([poolAuth])
            .rpc()
        console.log(`   ✅ Created`)
        console.log(`      oracle_authority = ${oracleAuth.publicKey.toBase58()}`)
        console.log(`      lp_yield = 3.0% | protocol_fee = 0.5%`)
        console.log(`   ${explorerUrl(tx)}`)
    }

    // ── Step 3: Rate awal ──────────────────────────────────────────────────
    console.log(`\n[3/3] Setting initial rate...`)
    const oracle = await oracleProg.account.rateOracle.fetch(rateOraclePda)
    if (oracle.isActive) {
        console.log(`   ✅ Already active`)
        console.log(`      rate         = ${Number(oracle.idrPerUsdc) / 10_000} IDR/USDC`)
        console.log(`      last_updated = ${new Date(Number(oracle.lastUpdated) * 1000).toISOString()}`)
    } else {
        const tx = await oracleProg.methods
            .updateRate(new anchor.BN(INITIAL_RATE_RAW.toString()))
            .accounts({
                authority:  oracleAuth.publicKey,
                rateOracle: rateOraclePda,
            })
            .signers([oracleAuth])
            .rpc()
        console.log(`   ✅ Rate set: ${Number(INITIAL_RATE_RAW) / 10_000} IDR/USDC`)
        console.log(`   ${explorerUrl(tx)}`)
    }

    // ── Summary ────────────────────────────────────────────────────────────
    console.log("\n" + "─".repeat(50))
    console.log("✅ Initialize complete!\n")
    console.log("📝 Update .env (scripts):")
    console.log(`   PROGRAM_ID=${PROGRAM_ID.toBase58()}`)
    console.log()
    console.log("📝 Update .env (frontend):")
    console.log(`   VITE_PROGRAM_ID=${PROGRAM_ID.toBase58()}`)
    console.log(`   VITE_POOL_AUTHORITY_PUBKEY=${poolAuth.publicKey.toBase58()}`)
    console.log(`   (POOL + VAULT di-derive otomatis dari POOL_AUTHORITY_PUBKEY)`)
    console.log(`   (ORACLE + TREASURY diambil dari pool.oracle_authority on-chain)`)
    console.log()
    console.log("📝 Update .env (oracle push):")
    console.log(`   RATE_ORACLE_PDA=${rateOraclePda.toBase58()}`)
    console.log()
    console.log("📋 Next steps:")
    console.log("   yarn tsx scripts/deposit.ts 1000     # deposit 1000 USDC ke pool")
    console.log("   yarn tsx scripts/setup-demo.ts       # setup demo agreement (opsional)")
    console.log("   pm2 restart panen-push               # aktifkan oracle push")
    console.log("   cd ../frontend && npm run build      # build frontend")
}

main().catch(err => {
    console.error("\n❌ Error:", err.message ?? err)
    process.exit(1)
})