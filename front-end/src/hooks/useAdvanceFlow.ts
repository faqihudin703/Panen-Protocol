import { useState, useCallback } from "react"
import { useWallet, useConnection } from "@solana/wallet-adapter-react"
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js"
import {
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountIdempotentInstruction,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token"
import { useProgram }  from "../contexts/ProgramContext"
import { deriveAgreement, deriveReceipt, deriveAdvance } from "./usePdas"
import { getPoolInfo, invalidatePoolCache } from "./usePoolInfo"
import { USDC_MINT } from "../config/constants"
import { TxStatus }  from "./useReceiptFlow"

export function useAdvanceFlow() {
    const { program, idlLoaded } = useProgram()
    const { publicKey }          = useWallet()
    const { connection }         = useConnection()
    const [status, setStatus]    = useState<TxStatus>("idle")
    const [txSig,  setTxSig]     = useState<string | null>(null)
    const [error,  setError]     = useState<string | null>(null)

    const createAdvance = useCallback(async (
        mill:          PublicKey,
        koperasi:      PublicKey,
        nonceSnapshot: bigint,
    ) => {
        if (!publicKey) { setError("Wallet belum connect"); setStatus("error"); return }
        if (!idlLoaded || !program) { setError("Program belum siap"); setStatus("error"); return }

        setStatus("signing"); setError(null)
        try {
            // Ambil pool info on-chain — dapat oracle + treasury yang benar
            const pool = await getPoolInfo()
            if (!pool.loaded) throw new Error("Gagal load pool info")
            if (pool.oracleAuthority.equals(PublicKey.default)) {
                throw new Error("oracle_authority belum diset di pool — jalankan set-oracle-authority.ts")
            }

            const [agreement] = deriveAgreement(mill, koperasi)
            const [receipt]   = deriveReceipt(agreement, nonceSnapshot)
            const [advance]   = deriveAdvance(receipt)

            console.log("[advance] PDAs:", {
                agreement:   agreement.toBase58(),
                receipt:     receipt.toBase58(),
                advance:     advance.toBase58(),
                rateOracle:  pool.oraclePubkey.toBase58(),
                vault:       pool.vaultPubkey.toBase58(),
            })

            // Derive ATA koperasi — sync, tidak butuh network call
            const koperasiAta = getAssociatedTokenAddressSync(
                USDC_MINT, koperasi, false,
                TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
            )

            const advanceIx = await program.methods
                .createAdvance()
                .accounts({
                    koperasi,
                    agreement,
                    receipt,
                    pool:          pool.poolPubkey,
                    vault:         pool.vaultPubkey,
                    koperasiAta,
                    advance,
                    rateOracle:    pool.oraclePubkey,   // dari on-chain
                    tokenProgram:  TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .instruction()

            // Idempotent create ATA — no-op kalau sudah ada
            const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
                publicKey, koperasiAta, koperasi, USDC_MINT,
                TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
            )

            const { blockhash, lastValidBlockHeight } =
                await connection.getLatestBlockhash("confirmed")

            const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: publicKey })
                .add(createAtaIx)
                .add(advanceIx)

            setStatus("confirming")
            const provider = program.provider as any
            const sig = await provider.sendAndConfirm(tx, [], { commitment: "confirmed" })

            console.log("[advance] TX:", sig)
            invalidatePoolCache() // pool state berubah
            setTxSig(sig); setStatus("success")
            return { tx: sig, advance }

        } catch (e: any) {
            const msg = e?.message ?? String(e)
            console.error("[advance] error:", e)
            setError(msg); setStatus("error")
        }
    }, [program, publicKey, connection, idlLoaded])

    const settleAdvance = useCallback(async (
        mill:          PublicKey,
        koperasi:      PublicKey,
        nonceSnapshot: bigint,
    ) => {
        if (!publicKey) { setError("Wallet belum connect"); setStatus("error"); return }
        if (!idlLoaded || !program) { setError("Program belum siap"); setStatus("error"); return }

        setStatus("signing"); setError(null)
        try {
            const pool = await getPoolInfo()
            if (!pool.loaded) throw new Error("Gagal load pool info")

            const [agreement] = deriveAgreement(mill, koperasi)
            const [receipt]   = deriveReceipt(agreement, nonceSnapshot)
            const [advance]   = deriveAdvance(receipt)

            const koperasiAta = getAssociatedTokenAddressSync(
                USDC_MINT, koperasi, false,
                TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
            )

            const settleIx = await program.methods
                .settleAdvance()
                .accounts({
                    koperasi,
                    advance,
                    receipt,
                    pool:          pool.poolPubkey,
                    vault:         pool.vaultPubkey,
                    treasury:      pool.treasuryPubkey,   // dari on-chain
                    koperasiAta,
                    tokenProgram:  TOKEN_PROGRAM_ID,
                })
                .instruction()

            const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
                publicKey, koperasiAta, koperasi, USDC_MINT,
                TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
            )

            const { blockhash, lastValidBlockHeight } =
                await connection.getLatestBlockhash("confirmed")

            const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: publicKey })
                .add(createAtaIx)
                .add(settleIx)

            setStatus("confirming")
            const provider = program.provider as any
            const sig = await provider.sendAndConfirm(tx, [], { commitment: "confirmed" })

            console.log("[settle] TX:", sig)
            invalidatePoolCache()
            setTxSig(sig); setStatus("success")
            return sig

        } catch (e: any) {
            const msg = e?.message ?? String(e)
            console.error("[settle] error:", e)
            setError(msg); setStatus("error")
        }
    }, [program, publicKey, connection, idlLoaded])

    return { createAdvance, settleAdvance, status, txSig, error }
}