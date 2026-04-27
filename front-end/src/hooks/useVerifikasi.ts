import { useState, useCallback } from "react"
import { VERIFIKASI_URL, VERIFIKASI_THRESHOLD } from "../config/constants"

export interface VerifikasiPayload {
  weight_kg:         number
  farm_area_ha:      number
  price_per_kg:      number
  invoice_value_idr: number
  gps_lat:           number
  gps_lon:           number
  delivery_month:    number
  delivery_year:     number
}

export interface VerifikasiResult {
  request_id:         string
  keaslian_score:     number
  keaslian_prob:      number
  status:             "TERVERIFIKASI" | "PERLU_VERIFIKASI"
  catatan_verifikasi: Array<{
    field:     string
    value:     unknown
    catatan:   string
    prioritas: "tinggi" | "sedang" | "rendah"
  }>
  inference_ms: number
}

export function useVerifikasi() {
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState<VerifikasiResult | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const verify = useCallback(async (
    payload: VerifikasiPayload
  ): Promise<VerifikasiResult | null> => {
    setLoading(true); setResult(null); setError(null)
    try {
      const res = await fetch(`${VERIFIKASI_URL}/verifikasi`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as any).detail ?? (err as any).error ?? `HTTP ${res.status}`)
      }
      const data: VerifikasiResult = await res.json()
      setResult(data)
      return data
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Gagal menghubungi verifikasi API"
      setError(msg)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const reset = useCallback(() => { setResult(null); setError(null) }, [])

  return {
    verify, loading, result, error, reset,
    isVerified:  result?.status === "TERVERIFIKASI",
    needsReview: result?.status === "PERLU_VERIFIKASI",
  }
}