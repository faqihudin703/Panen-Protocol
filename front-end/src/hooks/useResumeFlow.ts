import { useCallback } from "react"
import { PublicKey }   from "@solana/web3.js"
import { useProgram }  from "../contexts/ProgramContext"
import { deriveAgreement, deriveReceipt } from "./usePdas"

export type ResumedStep = "form" | "submitted" | "advanced"

export interface ResumeResult {
  step:  ResumedStep
  nonce: bigint          // nonce receipt yang aktif (untuk di-pass ke createAdvance)
}

export function useResumeFlow() {
  const { program, idlLoaded } = useProgram()

  const resume = useCallback(async (
    millStr:     string,
    koperasiStr: string,
  ): Promise<ResumeResult> => {
    const fallback: ResumeResult = { step: "form", nonce: 0n }

    if (!idlLoaded || !program) return fallback

    let mill: PublicKey, koperasi: PublicKey
    try {
      mill     = new PublicKey(millStr)
      koperasi = new PublicKey(koperasiStr)
    } catch { return fallback }

    // ── 1. Fetch agreement ──────────────────────────────────────────────────
    const [agreementPda] = deriveAgreement(mill, koperasi)
    let agreementData: any
    try {
      agreementData = await (program.account as any).agreementAccount.fetch(agreementPda)
    } catch { return fallback }  // agreement belum ada → truly fresh

    if (!agreementData.active) return fallback  // pending_accept, belum bisa lanjut

    const receiptNonce: bigint = BigInt(agreementData.receiptNonce.toString())

    // Kalau nonce masih 0, belum ada receipt sama sekali
    if (receiptNonce === 0n) return fallback

    // Receipt terakhir ada di nonce-1 (nonce di agreement sudah di-increment setelah submit)
    const activeNonce = receiptNonce - 1n

    // ── 2. Fetch receipt ────────────────────────────────────────────────────
    const [receiptPda] = deriveReceipt(agreementPda, activeNonce)
    let receiptData: any
    try {
      receiptData = await (program.account as any).deliveryReceipt.fetch(receiptPda)
    } catch { return fallback }

    // ── 3. Map status → step ────────────────────────────────────────────────
    const status = receiptData.status  // Anchor decode sebagai object { pendingMillSign: {} } dll

    const isAdvanceActive = "advanceActive" in status
    const isSettled       = "settled"       in status
    const isCancelled     = "cancelled"     in status || "rejected" in status

    // Kalau settled/cancelled, tidak perlu resume — biarkan form fresh
    if (isSettled || isCancelled) return fallback

    if (isAdvanceActive) {
      return { step: "advanced", nonce: activeNonce }
    }

    // PendingMillSign atau ReadyToAdvance → kembalikan ke step submitted
    // supaya user bisa klik "Cairkan Dana" setelah mill cosign
    return { step: "submitted", nonce: activeNonce }

  }, [program, idlLoaded])

  return { resume }
}