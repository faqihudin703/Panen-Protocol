import { useState, useCallback } from "react"
import { PublicKey, SystemProgram } from "@solana/web3.js"
import { useWallet } from "@solana/wallet-adapter-react"
import { useProgram } from "../contexts/ProgramContext"
import { deriveAgreement } from "./usePdas"
import { TxStatus } from "./useReceiptFlow"

export type AgreementState =
    | "idle"
    | "checking"
    | "not_found"
    | "pending_accept"   // propose sudah ada, menunggu mill
    | "active"
    | "invalid_pubkey"

export interface AgreementInfo {
    state:        AgreementState
    mill:         string
    koperasi:     string
    receiptNonce: bigint
    pda:          string
}

export function useAgreementFlow() {
    const { program }   = useProgram()
    const { publicKey } = useWallet()

    const [proposeStatus, setProposeStatus] = useState<TxStatus>("idle")
    const [acceptStatus,  setAcceptStatus]  = useState<TxStatus>("idle")
    const [cancelStatus,  setCancelStatus]  = useState<TxStatus>("idle")
    const [proposeTx,     setProposeTx]     = useState<string | null>(null)
    const [acceptTx,      setAcceptTx]      = useState<string | null>(null)
    const [cancelTx,      setCancelTx]      = useState<string | null>(null)
    const [proposeError,  setProposeError]  = useState<string | null>(null)
    const [acceptError,   setAcceptError]   = useState<string | null>(null)
    const [cancelError,   setCancelError]   = useState<string | null>(null)

    // ── Cek status agreement on-chain ─────────────────────────────────────────
    const checkAgreement = useCallback(async (
        millPubkey:     string,
        koperasiPubkey: string,
    ): Promise<AgreementInfo> => {
        const blank: AgreementInfo = {
            state: "not_found", mill: millPubkey,
            koperasi: koperasiPubkey, receiptNonce: 0n, pda: "",
        }
        if (!program) return blank
        try {
            const mill     = new PublicKey(millPubkey)
            const koperasi = new PublicKey(koperasiPubkey)
            const [pda]    = deriveAgreement(mill, koperasi)
            const data     = await (program.account as any).agreementAccount.fetch(pda)
            return {
                state:        data.active ? "active" : "pending_accept",
                mill:         data.mill.toBase58(),
                koperasi:     data.koperasi.toBase58(),
                receiptNonce: BigInt(data.receiptNonce.toString()),
                pda:          pda.toBase58(),
            }
        } catch { return blank }
    }, [program])

    // ── Koperasi: propose agreement ───────────────────────────────────────────
    const proposeAgreement = useCallback(async (millPubkey: string) => {
        if (!publicKey || !program) return
        setProposeStatus("signing"); setProposeError(null)
        try {
            const millPk  = new PublicKey(millPubkey)
            const [agPDA] = deriveAgreement(millPk, publicKey)

            const tx = await program.methods
                .proposeAgreement(millPk)
                .accounts({
                    koperasi:      publicKey,
                    agreement:     agPDA,
                    systemProgram: SystemProgram.programId,
                })
                .rpc()

            console.log("[propose] TX:", tx)
            setProposeTx(tx); setProposeStatus("success")
            return tx
        } catch (e: any) {
            const msg = e?.message ?? String(e)
            setProposeError(msg); setProposeStatus("error")
        }
    }, [program, publicKey])

    // ── Koperasi: cancel proposal (hanya sebelum mill accept) ────────────────
    const cancelProposal = useCallback(async (millPubkey: string) => {
        if (!publicKey || !program) return
        setCancelStatus("signing"); setCancelError(null)
        try {
            const millPk  = new PublicKey(millPubkey)
            const [agPDA] = deriveAgreement(millPk, publicKey)

            const tx = await program.methods
                .cancelProposal()
                .accounts({
                    koperasi:  publicKey,
                    agreement: agPDA,
                })
                .rpc()

            console.log("[cancelProposal] TX:", tx)
            setCancelTx(tx); setCancelStatus("success")
            return tx
        } catch (e: any) {
            const msg = e?.message ?? String(e)
            setCancelError(msg); setCancelStatus("error")
        }
    }, [program, publicKey])

    // ── Mill: accept agreement ────────────────────────────────────────────────
    const acceptAgreement = useCallback(async (koperasiPubkey: string) => {
        if (!publicKey || !program) return
        setAcceptStatus("signing"); setAcceptError(null)
        try {
            const koperasiPk = new PublicKey(koperasiPubkey)
            const [agPDA]    = deriveAgreement(publicKey, koperasiPk)

            const tx = await program.methods
                .acceptAgreement()
                .accounts({
                    mill:      publicKey,
                    agreement: agPDA,
                })
                .rpc()

            console.log("[accept] TX:", tx)
            setAcceptTx(tx); setAcceptStatus("success")
            return tx
        } catch (e: any) {
            const msg = e?.message ?? String(e)
            setAcceptError(msg); setAcceptStatus("error")
        }
    }, [program, publicKey])

    return {
        checkAgreement,
        proposeAgreement, proposeStatus, proposeTx, proposeError,
        cancelProposal,   cancelStatus,  cancelTx,  cancelError,
        acceptAgreement,  acceptStatus,  acceptTx,  acceptError,
    }
}