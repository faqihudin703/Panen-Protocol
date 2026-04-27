import { useState, useCallback, useEffect } from "react"
import { KYC_URL } from "../config/constants"

export type KycStatus = "unchecked" | "not_registered" | "registered"

export interface KycInfo {
  status:      KycStatus
  entity_type: string
  name:        string
}

export interface KycRegisterPayload {
  entity_type:   "koperasi" | "mill"
  name:          string
  reg_number:    string
  address:       string
  pic_name:      string
  pic_phone:     string
  wallet_pubkey: string
}

export interface PetaniPayload {
  wallet_pubkey:   string
  petani_nama:     string
  petani_nik:      string
  petani_npwp:     string
  petani_rekening: string
  petani_bank:     string
  invoice_ref:     string
}

export function useKyc(walletPubkey: string | null) {
  const [kycInfo,    setKycInfo]    = useState<KycInfo | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [regLoading, setRegLoading] = useState(false)
  const [regSuccess, setRegSuccess] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const checkKyc = useCallback(async (pubkey: string) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${KYC_URL}/kyc/status/${pubkey}`)
      if (res.status === 404) {
        setKycInfo({ status: "not_registered", entity_type: "", name: "" })
      } else if (res.ok) {
        const d = await res.json()
        setKycInfo({
          status:      "registered",
          entity_type: d.entity_type,
          name:        d.name,
        })
      }
    } catch {
      // KYC server tidak jalan — demo mode, skip KYC gate
      setKycInfo({ status: "registered", entity_type: "koperasi", name: "Demo Mode" })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (walletPubkey) checkKyc(walletPubkey)
    else { setKycInfo(null); setRegSuccess(false) }
  }, [walletPubkey, checkKyc])

  const register = useCallback(async (
    payload: KycRegisterPayload
  ): Promise<boolean> => {
    setRegLoading(true); setError(null)
    try {
      const res = await fetch(`${KYC_URL}/kyc/register`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      })
      const d = await res.json()
      if (!res.ok) {
        setError(d.error ?? d.detail ?? "Registrasi gagal")
        return false
      }
      setRegSuccess(true)
      setKycInfo({ status: "registered", entity_type: payload.entity_type, name: payload.name })
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Gagal menghubungi KYC service")
      return false
    } finally {
      setRegLoading(false)
    }
  }, [])

  const submitPetani = useCallback(async (
    payload: PetaniPayload
  ): Promise<boolean> => {
    try {
      const res = await fetch(`${KYC_URL}/kyc/petani`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      })
      const d = await res.json()
      if (!res.ok) {
        console.error("[kyc] petani submit error:", d.error ?? d.detail)
        return false
      }
      return true
    } catch (e) {
      console.error("[kyc] petani submit failed:", e)
      return false
    }
  }, [])

  return {
    kycInfo, loading, error,
    regLoading, regSuccess,
    register, submitPetani, checkKyc,
    isRegistered: kycInfo?.status === "registered",
  }
}