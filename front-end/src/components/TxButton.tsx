import { CheckCircle2, XCircle, Loader2, ExternalLink } from "lucide-react"
import { TxStatus } from "../hooks/useReceiptFlow"
import { CLUSTER } from "../config/constants"

interface Props {
  status:    TxStatus
  txSig:     string | null
  onClick:   () => void
  label:     string
  icon?:     React.ReactNode
  disabled?: boolean
  variant?:  "lime" | "amber"
}

export function TxButton({
  status, txSig, onClick, label, icon,
  disabled, variant = "lime"
}: Props) {
  const loading = status === "signing" || status === "confirming"
  const success = status === "success"
  const err     = status === "error"

  return (
    <div className="space-y-2.5">
      <button
        onClick={onClick}
        disabled={disabled || loading}
        className={`w-full inline-flex items-center justify-center gap-2
          rounded-xl py-3 px-5 font-body font-semibold text-sm
          transition-all duration-150 active:scale-[0.97]
          disabled:opacity-40 disabled:cursor-not-allowed
          ${success
            ? "bg-lime/10 text-lime border border-lime/30"
            : err
            ? "bg-red-900/30 text-red-400 border border-red-700/30"
            : variant === "amber"
            ? "bg-amber text-[#0f1f0f] hover:bg-[#e88a1a] hover:shadow-[0_0_20px_rgba(217,119,6,0.25)]"
            : "bg-lime text-[#0f1f0f] hover:bg-[#b8f040] hover:shadow-[0_0_20px_rgba(163,230,53,0.25)]"
          }`}
      >
        {loading ? (
          <>
            <Loader2 size={15} className="animate-spin-slow" />
            {status === "signing" ? "Menunggu tanda tangan…" : "Mengkonfirmasi…"}
          </>
        ) : success ? (
          <><CheckCircle2 size={15} /> Berhasil</>
        ) : err ? (
          <><XCircle size={15} /> Gagal — Coba lagi</>
        ) : (
          <>{icon}{label}</>
        )}
      </button>
      {txSig && (
        <a
          href={`https://explorer.solana.com/tx/${txSig}?cluster=${CLUSTER}`}
          target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5
                     font-mono text-xs text-sky/60 hover:text-sky transition-colors"
        >
          <ExternalLink size={11} />
          Lihat di Solana Explorer
        </a>
      )}
    </div>
  )
}