import { CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react"
import { VerifikasiResult as VR } from "../hooks/useVerifikasi"

export function VerifikasiResult({ result }: { result: VR }) {
  const ok = result.status === "TERVERIFIKASI"
  return (
    <div className={`rounded-2xl border p-5 animate-slide-up
      ${ok ? "bg-lime/5 border-lime/20" : "bg-red-900/15 border-red-700/25"}`}>

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {ok
            ? <CheckCircle2  size={17} className="text-lime" />
            : <AlertTriangle size={17} className="text-red-400" />}
          <span className={`font-mono font-bold text-sm
            ${ok ? "text-lime" : "text-red-400"}`}>
            {ok ? "TERVERIFIKASI" : "PERLU VERIFIKASI MANUAL"}
          </span>
        </div>
        <span className="font-mono text-[10px] text-bark">
          {result.keaslian_score}/100 · {result.inference_ms}ms
        </span>
      </div>

      {/* Score bar */}
      <div className="h-1.5 bg-forest-700 rounded-full overflow-hidden mb-4">
        <div
          className={`h-full rounded-full transition-all duration-700
            ${result.keaslian_score < 40  ? "bg-lime"
            : result.keaslian_score < 63  ? "bg-amber"
            : "bg-red-500"}`}
          style={{ width: `${result.keaslian_score}%` }}
        />
      </div>

      {result.catatan_verifikasi.length > 0 && (
        <div className="space-y-2">
          {result.catatan_verifikasi.map((c, i) => (
            <div key={i} className="flex gap-2.5 items-start text-xs">
              <AlertCircle size={12} className={`shrink-0 mt-0.5
                ${c.prioritas === "tinggi" ? "text-red-400"
                : c.prioritas === "sedang" ? "text-amber"
                : "text-bark"}`} />
              <span className="text-[#f0f2e8]/60 leading-relaxed">{c.catatan}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}