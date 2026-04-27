/**
 * deposit.ts — Deposit USDC ke advance pool
 *
 * Jalankan setelah initialize.ts berhasil.
 *
 * Usage:
 *   ts-node scripts/deposit.ts [amount_usdc]
 *   ts-node scripts/deposit.ts 50        ← deposit 50 USDC
 *   ts-node scripts/deposit.ts           ← default 50 USDC
 *
 * Environment variables:

 */

import {
    getPoolAuthority,
    getProgram,
    getConnection,
    derivePool,
    deriveVault,
    explorerUrl,
    USDC_MINT,
    CLUSTER,
} from "./config";

import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import * as anchor from "@anchor-lang/core";

const USDC_DECIMALS = 6;

async function main() {
    const amountUsdc = parseFloat(process.argv[2] ?? "50");
    if (isNaN(amountUsdc) || amountUsdc <= 0) {
        throw new Error("Invalid amount. Usage: ts-node scripts/deposit.ts [amount_usdc]");
    }

    const amountLamports = BigInt(Math.round(amountUsdc * 10 ** USDC_DECIMALS));

    console.log("💰 Panen Protocol — Deposit Pool");
    console.log(`   Cluster:  ${CLUSTER}`);
    console.log(`   Amount:   ${amountUsdc} USDC (${amountLamports} lamports)`);
    console.log("─".repeat(50));

    const connection  = getConnection();
    const poolAuth    = getPoolAuthority();
    const usdcMint    = USDC_MINT;
    const program     = getProgram(poolAuth);

    const [poolPda]  = derivePool(poolAuth.publicKey);
    const [vaultPda] = deriveVault(poolPda);

    // Get atau create authority ATA
    console.log("\n📋 Checking authority USDC balance...");
    const authorityAta = await getOrCreateAssociatedTokenAccount(
        connection,
        poolAuth,
        usdcMint,
        poolAuth.publicKey
    );

    const balance = BigInt(authorityAta.amount.toString());
    const balanceUsdc = Number(balance) / 10 ** USDC_DECIMALS;
    console.log(`   Authority ATA: ${authorityAta.address.toBase58()}`);
    console.log(`   Balance: ${balanceUsdc.toFixed(6)} USDC`);

    if (balance < amountLamports) {
        throw new Error(
            `Insufficient USDC balance.\n` +
            `  Available: ${balanceUsdc.toFixed(6)} USDC\n` +
            `  Required:  ${amountUsdc} USDC`
        );
    }

    // Cek pool state sebelum deposit
    console.log("\n📊 Pool state before deposit...");
    try {
        const pool = await program.account.advancePool.fetch(poolPda);
        const deposited = Number(pool.totalDeposited.toString()) / 10 ** USDC_DECIMALS;
        const advanced  = Number(pool.totalAdvanced.toString())  / 10 ** USDC_DECIMALS;
        console.log(`   Total deposited: ${deposited.toFixed(6)} USDC`);
        console.log(`   Total advanced:  ${advanced.toFixed(6)} USDC`);
        console.log(`   Available:       ${(deposited - advanced).toFixed(6)} USDC`);
    } catch {
        throw new Error("Pool not initialized. Run initialize.ts first.");
    }

    // Deposit
    console.log(`\n📤 Depositing ${amountUsdc} USDC...`);
    const tx = await program.methods
        .depositPool(new anchor.BN(amountLamports.toString()))
        .accounts({
            authority:    poolAuth.publicKey,
            pool:         poolPda,
            vault:        vaultPda,
            authorityAta: authorityAta.address,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([poolAuth])
        .rpc();

    console.log(`   ✅ TX: ${explorerUrl(tx)}`);

    // Verify
    const poolAfter   = await program.account.advancePool.fetch(poolPda);
    const depositedAfter = Number(poolAfter.totalDeposited.toString()) / 10 ** USDC_DECIMALS;
    const advancedAfter  = Number(poolAfter.totalAdvanced.toString())  / 10 ** USDC_DECIMALS;

    console.log(`\n✅ Pool state after deposit:`);
    console.log(`   Total deposited: ${depositedAfter.toFixed(6)} USDC`);
    console.log(`   Total advanced:  ${advancedAfter.toFixed(6)} USDC`);
    console.log(`   Available:       ${(depositedAfter - advancedAfter).toFixed(6)} USDC`);
}

main().catch((err) => {
    console.error("\n❌ Deposit failed:", err.message ?? err);
    process.exit(1);
});