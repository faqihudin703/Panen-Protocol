import { useState, useEffect }    from "react"
import { PublicKey }              from "@solana/web3.js"
import { useWallet }              from "@solana/wallet-adapter-react"
import {
  Handshake, Scale, MapPin, Calendar, Weight, Tag, Ruler,
  User, Phone, Hash, Building2, Search, Send, Coins,
  CheckCircle2, ExternalLink, Loader2, ChevronDown, ChevronUp,
  CreditCard, Landmark, AlertCircle, Link2, Clock
} from "lucide-react"
import { useVerifikasi }     from "../hooks/useVerifikasi"
import { useReceiptFlow }    from "../hooks/useReceiptFlow"
import { useAdvanceFlow }    from "../hooks/useAdvanceFlow"
import { useKyc }            from "../hooks/useKyc"
import { useAgreementFlow, AgreementState } from "../hooks/useAgreementFlow"
import { useResumeFlow }     from "../hooks/useResumeFlow"
import { useLang }           from "../contexts/LangContext"
import { t }                 from "../i18n/strings"
import { VerifikasiResult }  from "./VerifikasiResult"
import { TxButton }          from "./TxButton"
import { IdlStatus }         from "./IdlStatus"
import { formatIDR, calcAdvance } from "../utils/idr"
import { DISPLAY_RATE_RAW, CLUSTER } from "../config/constants"

const now = new Date()

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string; icon: React.ReactNode; error?: string; touched?: boolean
}
function Field({ label, icon, error, touched, ...p }: FieldProps) {
  const hasErr = touched && error
  return (
    <div>
      <label className="label"><span className="text-[#7a9a6a]">{icon}</span>{label}</label>
      <input {...p} className={hasErr ? "input-error" : "input-field"}/>
      {hasErr && <p className="field-error"><AlertCircle size={11}/> {error}</p>}
    </div>
  )
}

function Section({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 py-3 border-t border-forest-600/50 mt-2">
      <div>
        <p className="font-mono text-xs text-lime font-semibold uppercase tracking-wider">{title}</p>
        <p className="font-body text-xs text-bark mt-0.5">{subtitle}</p>
      </div>
    </div>
  )
}

function AgStatusBadge({ state, onPropose, proposing, millPubkey, lang }: {
  state: AgreementState; onPropose: () => void; proposing: boolean
  millPubkey: string; lang: "id"|"en"
}) {
  if (!millPubkey || millPubkey.length < 32) return null
  if (state === "checking") return (
    <p className="font-mono text-[10px] text-bark mt-2 flex items-center gap-1.5">
      <Loader2 size={10} className="animate-spin-slow"/> {t("agChecking", lang)}
    </p>
  )
  if (state === "invalid_pubkey") return (
    <p className="font-mono text-[10px] text-red-400 mt-2 flex items-center gap-1.5">
      <AlertCircle size={10}/> {t("agInvalidPk", lang)}
    </p>
  )
  if (state === "active") return (
    <p className="font-mono text-[10px] text-lime mt-2 flex items-center gap-1.5">
      <CheckCircle2 size={10}/> {t("agActive", lang)}
    </p>
  )
  if (state === "pending_accept") return (
    <div className="mt-2 flex items-start gap-2 bg-amber/8 border border-amber/20 rounded-xl px-3 py-2.5">
      <Clock size={13} className="text-amber mt-0.5 shrink-0"/>
      <div>
        <p className="font-mono text-xs text-amber font-semibold">{t("agPending", lang)}</p>
        <p className="font-body text-xs text-bark mt-0.5">{t("agPendingDesc", lang)}</p>
      </div>
    </div>
  )
  return (
    <div className="mt-2 space-y-2">
      <p className="font-mono text-[10px] text-bark flex items-center gap-1.5">
        <AlertCircle size={10} className="text-bark"/> {t("agNone", lang)}
      </p>
      <button onClick={onPropose} disabled={proposing} className="btn-ghost py-2 px-3 w-full text-xs">
        {proposing
          ? <><Loader2 size={12} className="animate-spin-slow"/> {t("agProposing", lang)}</>
          : <><Link2 size={12}/> {t("agPropose", lang)}</>}
      </button>
    </div>
  )
}

export function KoperasiPanel() {
  const { publicKey } = useWallet()
  const { lang }      = useLang()
  const { register, submitPetani } = useKyc(null)
  const {
    checkAgreement, proposeAgreement,
    proposeStatus, proposeTx, proposeError,
  } = useAgreementFlow()
  const { resume } = useResumeFlow()

  const [mill,           setMill]           = useState("")
  const [weightKg,       setWeightKg]       = useState("5000")
  const [pricePerKg,     setPricePerKg]     = useState("2900")
  const [farmAreaHa,     setFarmAreaHa]     = useState("2.0")
  const [gpsLat,         setGpsLat]         = useState("-0.354")
  const [gpsLon,         setGpsLon]         = useState("102.071")
  const [deliveryMonth,  setDeliveryMonth]  = useState(String(now.getMonth() + 1))
  const [deliveryYear,   setDeliveryYear]   = useState(String(now.getFullYear()))
  const [koperasiName,   setKoperasiName]   = useState("")
  const [koperasiBH,     setKoperasiBH]     = useState("")
  const [koperasiAddr,   setKoperasiAddr]   = useState("")
  const [picName,        setPicName]        = useState("")
  const [picPhone,       setPicPhone]       = useState("")
  const [petaniNama,     setPetaniNama]     = useState("")
  const [petaniNIK,      setPetaniNIK]      = useState("")
  const [petaniNPWP,     setPetaniNPWP]     = useState("")
  const [petaniRekening, setPetaniRekening] = useState("")
  const [petaniBank,     setPetaniBank]     = useState("")

  const [step,     setStep]     = useState<"form"|"submitted"|"advanced">("form")
  const [nonce,    setNonce]    = useState<bigint>(0n)
  const [errors,   setErrors]   = useState<Record<string,string>>({})
  const [touched,  setTouched]  = useState<Record<string,boolean>>({})
  const [showKyc,  setShowKyc]  = useState(true)
  const [agState,  setAgState]  = useState<AgreementState>("idle")

  const { verify, loading:vLoad, result:vResult, error:vError, reset:vReset } = useVerifikasi()
  const { submit, status:rStatus, txSig:rTxSig }        = useReceiptFlow()
  const { createAdvance, status:aStatus, txSig:aTxSig } = useAdvanceFlow()

  const invoiceIdr  = Number(weightKg) * Number(pricePerKg)
  const advanceUsdc = calcAdvance(invoiceIdr, DISPLAY_RATE_RAW) / 1_000_000

  // Auto-check agreement
  useEffect(() => {
    if (!mill.trim() || mill.length < 32) { setAgState("idle"); return }
    let cancelled = false
    const run = async () => {
      setAgState("checking")
      try { new PublicKey(mill.trim()) } catch { setAgState("invalid_pubkey"); return }
      if (!publicKey) return
      const info = await checkAgreement(mill.trim(), publicKey.toBase58())
      if (!cancelled) setAgState(info.state)
    }
    const timer = setTimeout(run, 600)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [mill, publicKey, checkAgreement, proposeStatus])

  // Resume flow
  useEffect(() => {
    if (!publicKey || !mill.trim() || mill.length < 32 || step !== "form") return
    let cancelled = false
    const run = async () => {
      const result = await resume(mill.trim(), publicKey.toBase58())
      if (cancelled) return
      if (result.step !== "form") { setNonce(result.nonce); setStep(result.step) }
    }
    run()
    return () => { cancelled = true }
  }, [publicKey, mill, resume])

  async function handlePropose() { await proposeAgreement(mill.trim()) }

  function validate(): Record<string,string> {
    const e: Record<string,string> = {}
    if (!mill.trim())          e.mill          = t("errMillPk", lang)
    if (agState !== "active")  e.mill          = t("errAgInactive", lang)
    if (!koperasiName.trim())  e.koperasiName  = t("errKopName", lang)
    if (!koperasiBH.trim())    e.koperasiBH    = t("errKopBH", lang)
    if (koperasiAddr.length < 10) e.koperasiAddr = t("errKopAddr", lang)
    if (!picName.trim())       e.picName       = t("errPIC", lang)
    if (!/^(\+62|0)8[0-9]{8,12}$/.test(picPhone.trim())) e.picPhone = t("errPhone", lang)
    if (!petaniNama.trim())    e.petaniNama    = t("errFarmerName", lang)
    if (!/^\d{16}$/.test(petaniNIK.replace(/\s/g,"")))   e.petaniNIK  = t("errNIK", lang)
    if (!/^\d{15,16}$/.test(petaniNPWP.replace(/[.\-\s]/g,""))) e.petaniNPWP = t("errNPWP", lang)
    if (!/^\d{6,20}$/.test(petaniRekening.trim())) e.petaniRekening = t("errRek", lang)
    if (!petaniBank.trim())    e.petaniBank    = t("errBank", lang)
    return e
  }

  function touch(k: string) {
    setTouched(p => ({ ...p, [k]: true }))
    setErrors(p => ({ ...p, [k]: validate()[k] ?? "" }))
  }

  function fp(lbl: string, icon: React.ReactNode, val: string, set: (v:string)=>void, key: string,
              rest?: Partial<React.InputHTMLAttributes<HTMLInputElement>>): FieldProps {
    return {
      label: lbl, icon, value: val, error: errors[key], touched: touched[key],
      onChange: e => set(e.target.value),
      onBlur:   () => touch(key), ...rest
    }
  }

  async function handleVerify() {
    vReset()
    await verify({
      weight_kg: Number(weightKg), farm_area_ha: Number(farmAreaHa),
      price_per_kg: Number(pricePerKg), invoice_value_idr: invoiceIdr,
      gps_lat: Number(gpsLat), gps_lon: Number(gpsLon),
      delivery_month: Number(deliveryMonth), delivery_year: Number(deliveryYear),
    })
  }

  async function handleSubmit() {
    if (!publicKey || vResult?.status !== "TERVERIFIKASI") return
    const allKeys = ["mill","koperasiName","koperasiBH","koperasiAddr",
                     "picName","picPhone","petaniNama","petaniNIK",
                     "petaniNPWP","petaniRekening","petaniBank"]
    setTouched(Object.fromEntries(allKeys.map(k => [k, true])))
    const errs = validate(); setErrors(errs)
    if (Object.keys(errs).some(k => errs[k])) return
    await register({
      entity_type: "koperasi", name: koperasiName.trim(),
      reg_number: koperasiBH.trim(), address: koperasiAddr.trim(),
      pic_name: picName.trim(), pic_phone: picPhone.trim(),
      wallet_pubkey: publicKey.toBase58(),
    })
    const millPk = new PublicKey(mill.trim())
    const res = await submit({
      mill: millPk, koperasi: publicKey,
      weight_kg: Number(weightKg), price_per_kg: Number(pricePerKg),
      invoice_value_idr: invoiceIdr,
      gps_lat: Number(gpsLat), gps_lon: Number(gpsLon),
      fraud_score: vResult.keaslian_score,
      delivery_month: Number(deliveryMonth), delivery_year: Number(deliveryYear),
    })
    if (res) { setNonce(res.nonce ?? 0n); setStep("submitted") }
  }

  async function handleAdvance() {
    if (!publicKey) return
    const millPk = new PublicKey(mill.trim())
    const res = await createAdvance(millPk, publicKey, nonce)
    if (res) {
      await submitPetani({
        wallet_pubkey: publicKey.toBase58(), petani_nama: petaniNama.trim(),
        petani_nik: petaniNIK.replace(/\s/g,""),
        petani_npwp: petaniNPWP.replace(/[.\-\s]/g,""),
        petani_rekening: petaniRekening.trim(), petani_bank: petaniBank.trim(),
        invoice_ref: res.tx ?? "pending",
      })
      setStep("advanced")
    }
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-7">
        <div className="w-11 h-11 rounded-2xl bg-lime/15 border border-lime/25 flex items-center justify-center shrink-0">
          <Handshake size={22} className="text-lime"/>
        </div>
        <div>
          <h2 className="font-display text-xl lg:text-2xl text-lime font-bold">{t("kopTitle", lang)}</h2>
          <p className="font-mono text-xs text-bark">{t("kopSub", lang)}</p>
        </div>
      </div>

      {step === "form" && (
        <div className="space-y-5 animate-fade-in">
          <IdlStatus/>
          <Section title={t("secInvoice", lang)} subtitle={t("secInvSub", lang)}/>
          <div className="space-y-4">
            <div>
              <label className="label"><span className="text-[#7a9a6a]"><Scale size={11}/></span>{t("fldMill", lang)}</label>
              <input value={mill} onChange={e=>setMill(e.target.value)} onBlur={()=>touch("mill")}
                     placeholder={t("fldMillPh", lang)}
                     className={touched.mill && errors.mill && agState!=="active" ? "input-error" : "input-field"}/>
              <AgStatusBadge state={agState} onPropose={handlePropose} lang={lang}
                             proposing={proposeStatus==="signing"||proposeStatus==="confirming"} millPubkey={mill}/>
              {proposeError && <p className="font-mono text-[10px] text-red-400 mt-1.5">✗ {proposeError}</p>}
              {proposeTx && (
                <a href={`https://explorer.solana.com/tx/${proposeTx}?cluster=${CLUSTER}`}
                   target="_blank" rel="noopener noreferrer"
                   className="font-mono text-[10px] text-sky/60 hover:text-sky mt-1 flex items-center gap-1">
                  <ExternalLink size={9}/> {t("viewProposalTx", lang)}
                </a>
              )}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Field {...fp(t("fldWeight",lang),<Weight size={11}/>,weightKg,setWeightKg,"weightKg",{type:"number"})}/>
              <Field {...fp(t("fldPrice",lang),<Tag size={11}/>,pricePerKg,setPricePerKg,"pricePerKg",{type:"number"})}/>
              <Field {...fp(t("fldArea",lang),<Ruler size={11}/>,farmAreaHa,setFarmAreaHa,"farmAreaHa",{type:"number"})}/>
              <div className="grid grid-cols-2 gap-2">
                <Field {...fp(t("fldMonth",lang),<Calendar size={11}/>,deliveryMonth,setDeliveryMonth,"deliveryMonth",{type:"number"})}/>
                <Field {...fp(t("fldYear",lang),<Calendar size={11}/>,deliveryYear,setDeliveryYear,"deliveryYear",{type:"number"})}/>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field {...fp(t("fldLat",lang),<MapPin size={11}/>,gpsLat,setGpsLat,"gpsLat",{type:"number",placeholder:"-0.354"})}/>
              <Field {...fp(t("fldLon",lang),<MapPin size={11}/>,gpsLon,setGpsLon,"gpsLon",{type:"number",placeholder:"102.071"})}/>
            </div>
            <div className="bg-[#152515] border border-forest-600/60 rounded-2xl p-5">
              <p className="font-mono text-[9px] text-bark uppercase tracking-widest mb-4">{t("estTitle",lang)}</p>
              <div className="grid grid-cols-2 gap-y-2.5">
                <span className="font-body text-sm text-[#f0f2e8]/60">{t("estInvoice",lang)}</span>
                <span className="font-mono font-semibold text-[#f0f2e8] text-right">{formatIDR(invoiceIdr)}</span>

                <span className="font-body text-sm text-[#f0f2e8]/60">{t("estAdvance",lang)}</span>
                <span className="font-mono font-bold text-xl text-lime text-right">≈ {advanceUsdc.toFixed(2)} USDC</span>

                {/* Fee breakdown */}
                <span className="font-body text-xs text-[#f0f2e8]/40 col-span-2 pt-2 border-t border-forest-600/60
                                 flex items-center gap-1.5">
                  <span className="text-amber/70">⚠</span>
                  {lang === "id"
                    ? `Saat settle: bayar ${advanceUsdc.toFixed(2)} + ${(advanceUsdc * 0.035).toFixed(2)} USDC (3,5% fee dari advance)`
                    : `At settlement: repay ${advanceUsdc.toFixed(2)} + ${(advanceUsdc * 0.035).toFixed(2)} USDC (3.5% fee on advance)`
                  }
                </span>
                <span className="font-body text-xs text-[#f0f2e8]/40 col-span-2">
                  {lang === "id"
                    ? `Net diterima ≈ ${(advanceUsdc * (1 - 0.035)).toFixed(2)} USDC (~${((1 - 0.035) * 0.8 * 100).toFixed(1)}% dari invoice)`
                    : `Net received ≈ ${(advanceUsdc * (1 - 0.035)).toFixed(2)} USDC (~${((1 - 0.035) * 0.8 * 100).toFixed(1)}% of invoice)`
                  }
                </span>

                <span className="font-body text-xs text-bark col-span-2 pt-2 border-t border-forest-600/40">
                  1 USDC = Rp{(DISPLAY_RATE_RAW/10_000).toLocaleString("id-ID")} · Bank Indonesia
                </span>
              </div>
            </div>
            <button onClick={handleVerify} disabled={vLoad} className="btn-ghost w-full">
              {vLoad
                ? <><Loader2 size={15} className="animate-spin-slow"/> {t("btnVerifying",lang)}</>
                : <><Search size={15}/> {t("btnVerify",lang)}</>}
            </button>
            {vResult && <VerifikasiResult result={vResult}/>}
            {vError && (
              <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/25 rounded-xl px-4 py-3">
                <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0"/>
                <p className="font-mono text-xs text-red-400">{vError}</p>
              </div>
            )}
          </div>

          <button onClick={()=>setShowKyc(p=>!p)}
                  className="flex items-center justify-between w-full py-3 border-t border-forest-600/50 mt-2 group">
            <div>
              <p className="font-mono text-xs text-lime font-semibold uppercase tracking-wider">{t("secKopKyc",lang)}</p>
              <p className="font-body text-xs text-bark mt-0.5">{t("secKopKycSub",lang)}</p>
            </div>
            {showKyc ? <ChevronUp size={16} className="text-bark"/> : <ChevronDown size={16} className="text-bark"/>}
          </button>
          {showKyc && (
            <div className="space-y-4 animate-slide-up">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Field {...fp(t("fldKopName",lang),<Building2 size={11}/>,koperasiName,setKoperasiName,"koperasiName",{placeholder:"Koperasi Sawit Maju Bersama"})}/>
                <Field {...fp(t("fldKopBH",lang),<Hash size={11}/>,koperasiBH,setKoperasiBH,"koperasiBH",{placeholder:"518/BH/KOP/IV/2019"})}/>
              </div>
              <Field {...fp(t("fldKopAddr",lang),<MapPin size={11}/>,koperasiAddr,setKoperasiAddr,"koperasiAddr",{placeholder:"Jl. Lintas Timur No.12, Kab. Pelalawan, Riau"})}/>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Field {...fp(t("fldPIC",lang),<User size={11}/>,picName,setPicName,"picName",{placeholder:"Budi Santoso"})}/>
                <Field {...fp(t("fldWA",lang),<Phone size={11}/>,picPhone,setPicPhone,"picPhone",{placeholder:"081234567890",type:"tel"})}/>
              </div>
            </div>
          )}

          <Section title={t("secFarmer",lang)} subtitle={t("secFarmerSub",lang)}/>
          <div className="space-y-4">
            <Field {...fp(t("fldFarmerName",lang),<User size={11}/>,petaniNama,setPetaniNama,"petaniNama",{placeholder:lang==="id"?"Sesuai KTP":"As per ID"})}/>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Field {...fp(t("fldNIK",lang),<Hash size={11}/>,petaniNIK,setPetaniNIK,"petaniNIK",{placeholder:"1471052209870001",maxLength:16})}/>
              <Field {...fp(t("fldNPWP",lang),<Hash size={11}/>,petaniNPWP,setPetaniNPWP,"petaniNPWP",{placeholder:"73.456.789.1-217.000"})}/>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Field {...fp(t("fldRek",lang),<CreditCard size={11}/>,petaniRekening,setPetaniRekening,"petaniRekening",{placeholder:"1234567890"})}/>
              <Field {...fp(t("fldBank",lang),<Landmark size={11}/>,petaniBank,setPetaniBank,"petaniBank",{placeholder:"BRI / BNI / Mandiri"})}/>
            </div>
            <div className="bg-lime/5 border border-lime/15 rounded-xl px-4 py-3">
              <p className="font-body text-xs text-[#f0f2e8]/60 leading-relaxed">{t("farmerNote",lang)}</p>
            </div>
          </div>

          <div className="pt-2">
            <TxButton status={rStatus} txSig={rTxSig} onClick={handleSubmit}
                      label={t("btnSubmit",lang)} icon={<Send size={15}/>}
                      disabled={vResult?.status!=="TERVERIFIKASI"||agState!=="active"}/>
            {agState==="pending_accept" && vResult?.status==="TERVERIFIKASI" && (
              <p className="font-mono text-[10px] text-amber text-center mt-2">{t("hintWaitMill",lang)}</p>
            )}
            {agState!=="active" && agState!=="pending_accept" && (
              <p className="font-mono text-[10px] text-bark text-center mt-2">
                {vResult?.status!=="TERVERIFIKASI" ? t("hintVerifyFirst",lang) : t("hintPropose",lang)}
              </p>
            )}
          </div>
        </div>
      )}

      {step === "submitted" && (
        <div className="text-center py-12 animate-fade-in">
          <div className="w-16 h-16 rounded-full bg-lime/15 border border-lime/30 flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 size={32} className="text-lime"/>
          </div>
          <h3 className="font-display text-xl text-lime font-bold mb-2">{t("successTitle",lang)}</h3>
          <p className="font-body text-sm text-bark mb-2">{t("successNonce",lang)}</p>
          <p className="font-mono text-2xl text-amber font-bold mb-5">{nonce.toString()}</p>
          {rTxSig && (
            <a href={`https://explorer.solana.com/tx/${rTxSig}?cluster=${CLUSTER}`}
               target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1.5 font-mono text-sm text-sky/70 hover:text-sky mb-6">
              <ExternalLink size={13}/> {t("viewTx",lang)}
            </a>
          )}
          <div className="max-w-sm mx-auto mt-4">
            <TxButton status={aStatus} txSig={aTxSig} onClick={handleAdvance}
                      label={t("btnDisburse",lang)} icon={<Coins size={15}/>}/>
          </div>
        </div>
      )}

      {step === "advanced" && (
        <div className="text-center py-12 animate-fade-in">
          <div className="w-16 h-16 rounded-full bg-lime/15 border border-lime/30 flex items-center justify-center mx-auto mb-5">
            <Coins size={32} className="text-lime"/>
          </div>
          <h3 className="font-display text-xl text-lime font-bold mb-2">{t("disbursedTitle",lang)}</h3>
          <p className="font-mono text-lg text-bark">≈ {advanceUsdc.toFixed(2)} USDC</p>
          <p className="font-body text-sm text-bark/60 mt-1">
            {t("disbursedDesc",lang)} {petaniNama || (lang==="id"?"petani":"farmer")}
          </p>
          {aTxSig && (
            <a href={`https://explorer.solana.com/tx/${aTxSig}?cluster=${CLUSTER}`}
               target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1.5 font-mono text-sm text-sky/70 hover:text-sky mt-4">
              <ExternalLink size={13}/> {t("viewTx",lang)}
            </a>
          )}
        </div>
      )}
    </div>
  )
}