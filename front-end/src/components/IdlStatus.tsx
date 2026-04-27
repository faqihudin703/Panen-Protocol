import { AlertTriangle } from "lucide-react"
import { useProgram } from "../contexts/ProgramContext"

/**
 * Banner kecil — muncul kalau IDL belum dimuat
 * Taruh di atas KoperasiPanel dan MillPanel
 */
export function IdlStatus() {
  const { idlLoaded, program } = useProgram()

  if (idlLoaded && program) return null

  return (
    <div className="flex items-start gap-3 mb-5
                    bg-amber/10 border border-amber/30
                    rounded-xl px-4 py-3">
      <AlertTriangle size={16} className="text-amber shrink-0 mt-0.5" />
      <div>
        <p className="font-mono text-sm text-amber font-semibold">
          IDL belum dimuat — on-chain transaction tidak akan jalan
        </p>
        <p className="font-body text-xs text-bark mt-1">
          Copy <code className="bg-forest-800 px-1 rounded">target/idl/panen.json</code>{" "}
          ke <code className="bg-forest-800 px-1 rounded">src/idl/panen.json</code>{" "}
          lalu <code className="bg-forest-800 px-1 rounded">npm run build</code>
        </p>
      </div>
    </div>
  )
}