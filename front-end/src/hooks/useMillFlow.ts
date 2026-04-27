import { useState, useCallback } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { PublicKey } from "@solana/web3.js"
import { useProgram } from "../contexts/ProgramContext"
import { deriveAgreement, deriveReceipt } from "./usePdas"
import { TxStatus } from "./useReceiptFlow"

export function useMillFlow() {
    const { program, idlLoaded } = useProgram()
    const { publicKey }          = useWallet()
    const [status, setStatus]    = useState<TxStatus>("idle")
    const [txSig,  setTxSig]     = useState<string | null>(null)
    const [error,  setError]     = useState<string | null>(null)

    // Mill cosign receipt → ReadyToAdvance
    const cosign = useCallback(async (
        mill:     PublicKey,
        koperasi: PublicKey,
        nonce:    bigint,
    ) => {
        if (!publicKey) { setError("Wallet belum connect"); setStatus("error"); return }
        if (!idlLoaded || !program) { setError("Program belum siap"); setStatus("error"); return }

        setStatus("signing"); setError(null)
        try {
            const [agreement] = deriveAgreement(mill, koperasi)
            const [receipt]   = deriveReceipt(agreement, nonce)

            console.log("[cosign] PDAs:", {
                agreement: agreement.toBase58(),
                receipt:   receipt.toBase58(),
                nonce:     nonce.toString(),
            })

            setStatus("confirming")
            const tx = await program.methods
                .millCosignReceipt()
                .accounts({
                    mill:      publicKey,
                    agreement,
                    receipt,
                })
                .rpc()

            console.log("[cosign] TX:", tx)
            setTxSig(tx); setStatus("success")
            return tx
        } catch (e: any) {
            const msg = e?.message ?? String(e)
            console.error("[cosign] error:", msg, e)
            setError(msg); setStatus("error")
        }
    }, [program, publicKey, idlLoaded])

    // Mill confirm cancel receipt (setelah koperasi request_cancel)
    const confirmCancel = useCallback(async (
        mill:     PublicKey,
        koperasi: PublicKey,
        nonce:    bigint,
    ) => {
        if (!publicKey) { setError("Wallet belum connect"); setStatus("error"); return }
        if (!idlLoaded || !program) { setError("Program belum siap"); setStatus("error"); return }

        setStatus("signing"); setError(null)
        try {
            const [agreement] = deriveAgreement(mill, koperasi)
            const [receipt]   = deriveReceipt(agreement, nonce)

            setStatus("confirming")
            const tx = await program.methods
                .millConfirmCancel()
                .accounts({
                    mill:           publicKey,
                    agreement,
                    receipt,
                    koperasiRefund: koperasi,
                })
                .rpc()

            console.log("[confirmCancel] TX:", tx)
            setTxSig(tx); setStatus("success")
            return tx
        } catch (e: any) {
            const msg = e?.message ?? String(e)
            console.error("[confirmCancel] error:", msg, e)
            setError(msg); setStatus("error")
        }
    }, [program, publicKey, idlLoaded])

    return { cosign, confirmCancel, status, txSig, error }
}