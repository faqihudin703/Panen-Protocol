import { useState, useCallback } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { PublicKey, SystemProgram } from "@solana/web3.js"
import * as anchor from "@anchor-lang/core"
import { useProgram } from "../contexts/ProgramContext"
import { deriveAgreement, deriveReceipt } from "./usePdas"
import { hashInvoice } from "../utils/hash"

export type TxStatus = "idle"|"verifying"|"signing"|"confirming"|"success"|"error"

export interface ReceiptParams {
    mill:              PublicKey
    koperasi:          PublicKey
    weight_kg:         number
    price_per_kg:      number
    invoice_value_idr: number
    gps_lat:           number
    gps_lon:           number
    fraud_score:       number
    delivery_month:    number
    delivery_year:     number
}

export function useReceiptFlow() {
    const { program, idlLoaded } = useProgram()
    const { publicKey }          = useWallet()
    const [status, setStatus]    = useState<TxStatus>("idle")
    const [txSig,  setTxSig]     = useState<string | null>(null)
    const [error,  setError]     = useState<string | null>(null)

    const submit = useCallback(async (p: ReceiptParams) => {
        if (!publicKey) { setError("Wallet belum connect"); setStatus("error"); return }
        if (!idlLoaded || !program) { setError("Program belum siap"); setStatus("error"); return }

        setStatus("signing"); setError(null)
        try {
            // Hash invoice — tanpa farmer karena petani didata off-chain
            const invoiceHash = await hashInvoice({
                koperasi:          p.koperasi.toBase58(),
                weight_kg:         p.weight_kg,
                price_per_kg:      p.price_per_kg,
                invoice_value_idr: p.invoice_value_idr,
                gps_lat:           p.gps_lat,
                gps_lon:           p.gps_lon,
                delivery_month:    p.delivery_month,
                delivery_year:     p.delivery_year,
            })

            const [agreement] = deriveAgreement(p.mill, p.koperasi)
            console.log("[receipt] agreement PDA:", agreement.toBase58())

            // Baca nonce dari agreement
            const agData = await (program.account as any).agreementAccount.fetch(agreement)
            const nonce  = BigInt(agData.receiptNonce.toString())
            console.log("[receipt] nonce:", nonce.toString(), "active:", agData.active)

            if (!agData.active) {
                setError("Agreement belum aktif — mill harus accept dulu")
                setStatus("error"); return
            }

            const [receipt] = deriveReceipt(agreement, nonce)
            console.log("[receipt] receipt PDA:", receipt.toBase58())

            setStatus("confirming")
            const tx = await program.methods
                .submitDeliveryReceipt({
                    weightKg:         new anchor.BN(p.weight_kg),
                    pricePerKg:       new anchor.BN(p.price_per_kg),
                    invoiceValueIdr:  new anchor.BN(p.invoice_value_idr),
                    invoiceHash:      Array.from(invoiceHash),
                    gpsLat:           new anchor.BN(Math.round(p.gps_lat * 1_000_000)),
                    gpsLon:           new anchor.BN(Math.round(p.gps_lon * 1_000_000)),
                    fraudScore:       p.fraud_score,
                })
                .accounts({
                    koperasi:      publicKey,
                    agreement,
                    receipt,
                    systemProgram: SystemProgram.programId,
                })
                .rpc()

            console.log("[receipt] TX:", tx)
            setTxSig(tx); setStatus("success")
            return { tx, receipt, nonce }
        } catch (e: any) {
            const msg = e?.message ?? String(e)
            console.error("[receipt] error:", msg, e)
            // Parse Anchor error codes
            const m = msg.match(/custom program error: 0x(\w+)/)
            if (m) {
                const code = parseInt(m[1], 16)
                const map: Record<number,string> = {
                    6003: "Invoice value tidak cocok (weight × price)",
                    6004: "GPS di luar wilayah Indonesia",
                    6009: "Receipt ini sudah ditolak AI classifier",
                }
                setError(map[code] ?? `Program error 0x${m[1]}`)
            } else {
                setError(msg)
            }
            setStatus("error")
        }
    }, [program, publicKey, idlLoaded])

    return { submit, status, txSig, error }
}