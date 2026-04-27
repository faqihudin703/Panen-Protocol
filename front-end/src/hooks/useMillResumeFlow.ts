/**
 * useMillResumeFlow.ts — Deteksi state on-chain dari perspektif mill
 *
 * Mill tidak tahu nonce receipt — perlu scan agreement untuk cari
 * receipt yang butuh cosign atau sudah cosign.
 *
 * Logic:
 *   1. Fetch agreement → dapat receipt_nonce (jumlah receipt yang pernah dibuat)
 *   2. Scan receipt terakhir (nonce-1) → cek statusnya
 *   3. Return step + nonce untuk mill
 */
import { useCallback } from "react"
import { PublicKey }   from "@solana/web3.js"
import { useProgram }  from "../contexts/ProgramContext"
import { deriveAgreement, deriveReceipt } from "./usePdas"

export type MillStep =
    | "idle"          // belum ada agreement atau receipt
    | "needs_cosign"  // receipt ada, PendingMillSign → mill harus cosign
    | "cosigned"      // receipt ReadyToAdvance → menunggu koperasi cairkan
    | "advance_active"// advance sudah cair → menunggu settle
    | "done"          // settled/cancelled/rejected

export interface MillResumeResult {
    step:      MillStep
    nonce:     bigint    // nonce receipt yang aktif
    koperasi:  string    // pubkey koperasi dari agreement
}

export function useMillResumeFlow() {
    const { program, idlLoaded } = useProgram()

    const resume = useCallback(async (
        millStr:     string,
        koperasiStr: string,
    ): Promise<MillResumeResult> => {
        const fallback: MillResumeResult = { step: "idle", nonce: 0n, koperasi: koperasiStr }
        if (!idlLoaded || !program) return fallback

        let mill: PublicKey, koperasi: PublicKey
        try {
            mill     = new PublicKey(millStr)
            koperasi = new PublicKey(koperasiStr)
        } catch { return fallback }

        // 1. Fetch agreement
        const [agPda] = deriveAgreement(mill, koperasi)
        let agData: any
        try {
            agData = await (program.account as any).agreementAccount.fetch(agPda)
        } catch { return fallback }

        if (!agData.active) return fallback

        const receiptNonce: bigint = BigInt(agData.receiptNonce.toString())
        if (receiptNonce === 0n) return fallback

        // 2. Cek receipt terakhir
        const activeNonce = receiptNonce - 1n
        const [receiptPda] = deriveReceipt(agPda, activeNonce)
        let receiptData: any
        try {
            receiptData = await (program.account as any).deliveryReceipt.fetch(receiptPda)
        } catch { return fallback }

        // 3. Map status
        const status = receiptData.status
        if ("pendingMillSign" in status) {
            return { step: "needs_cosign",   nonce: activeNonce, koperasi: koperasiStr }
        }
        if ("readyToAdvance" in status) {
            return { step: "cosigned",        nonce: activeNonce, koperasi: koperasiStr }
        }
        if ("advanceActive" in status) {
            return { step: "advance_active",  nonce: activeNonce, koperasi: koperasiStr }
        }
        // settled / cancelled / rejected → done, mulai fresh
        return { step: "done", nonce: activeNonce, koperasi: koperasiStr }

    }, [program, idlLoaded])

    return { resume }
}