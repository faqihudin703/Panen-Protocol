import { useState, useEffect }    from "react"
import { PublicKey }              from "@solana/web3.js"
import { useWallet }              from "@solana/wallet-adapter-react"
import {
  Factory, FileCheck, Hash, CheckCircle2, ArrowRight,
  User, Phone, Building2, MapPin, AlertCircle, ShieldCheck,
  Loader2, Link2, ExternalLink, RefreshCw, Clock
} from "lucide-react"
import { useMillFlow }            from "../hooks/useMillFlow"
import { useKyc }                 from "../hooks/useKyc"
import { useAgreementFlow }       from "../hooks/useAgreementFlow"
import { useMillResumeFlow, MillStep } from "../hooks/useMillResumeFlow"
import { useLang }                from "../contexts/LangContext"
import { t, tArr }                from "../i18n/strings"
import { TxButton }               from "./TxButton"
import { IdlStatus }              from "./IdlStatus"
import { CLUSTER }                from "../config/constants"

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

function StepBadge({ step, lang }: { step: MillStep; lang: "id"|"en" }) {
  if (step === "idle") return null
  if (step === "needs_cosign") return (
    <div className="flex items-center gap-2 bg-amber/10 border border-amber/25 rounded-xl px-3 py-2.5 animate-fade-in">
      <AlertCircle size={13} className="text-amber shrink-0"/>
      <div>
        <p className="font-mono text-xs text-amber font-semibold">{t("stepNeeds", lang)}</p>
        <p className="font-body text-xs text-bark mt-0.5">{t("stepNeedsSub", lang)}</p>
      </div>
    </div>
  )
  if (step === "cosigned") return (
    <div className="flex items-center gap-2 bg-lime/8 border border-lime/20 rounded-xl px-3 py-2.5">
      <CheckCircle2 size={13} className="text-lime shrink-0"/>
      <p className="font-mono text-xs text-lime">{t("stepSigned", lang)}</p>
    </div>
  )
  if (step === "advance_active") return (
    <div className="flex items-center gap-2 bg-sky/8 border border-sky/20 rounded-xl px-3 py-2.5">
      <Clock size={13} className="text-sky shrink-0"/>
      <p className="font-mono text-xs text-sky">{t("stepActive", lang)}</p>
    </div>
  )
  return (
    <div className="flex items-center gap-2 bg-forest-600/30 border border-forest-600/40 rounded-xl px-3 py-2.5">
      <CheckCircle2 size={13} className="text-bark shrink-0"/>
      <p className="font-mono text-xs text-bark">{t("stepDone", lang)}</p>
    </div>
  )
}

export function MillPanel() {
  const { publicKey }  = useWallet()
  const { lang }       = useLang()

  // useKyc dengan wallet pubkey — auto-check saat mount
  // API: { kycInfo, loading, regLoading, register, checkKyc, isRegistered }
  const {
    kycInfo, loading: kycLoading, regLoading,
    register, checkKyc,
  } = useKyc(publicKey?.toBase58() ?? null)

  const { cosign, status: cosignStatus, txSig: cosignTx, error: cosignError } = useMillFlow()
  const { checkAgreement, acceptAgreement, acceptStatus, acceptTx, acceptError } = useAgreementFlow()
  const { resume } = useMillResumeFlow()

  const [millName,  setMillName]  = useState("")
  const [millNPWP,  setMillNPWP]  = useState("")
  const [millAddr,  setMillAddr]  = useState("")
  const [picName,   setPicName]   = useState("")
  const [picPhone,  setPicPhone]  = useState("")
  const [koperasi,  setKoperasi]  = useState("")
  const [nonce,     setNonce]     = useState("0")
  const [errors,    setErrors]    = useState<Record<string,string>>({})
  const [touched,   setTouched]   = useState<Record<string,boolean>>({})
  // kycDone: true kalau KYC sudah ada di DB atau sudah disimpan manual
  const [kycDone,   setKycDone]   = useState(false)

  const [agState,       setAgState]       = useState<"idle"|"checking"|"pending"|"active"|"none">("idle")
  const [millStep,      setMillStep]      = useState<MillStep>("idle")
  const [resumeNonce,   setResumeNonce]   = useState<bigint>(0n)
  const [resumeLoading, setResumeLoading] = useState(false)

  // ── Auto-skip KYC kalau wallet sudah terdaftar di DB ──────────────────────
  // kycInfo.status === "registered" → set kycDone, pre-fill nama dari DB
  useEffect(() => {
    if (kycInfo?.status === "registered" && kycInfo.entity_type === "mill") {
      setKycDone(true)
      if (kycInfo.name) setMillName(kycInfo.name)
    }
  }, [kycInfo])

  // ── Auto-check agreement + resume saat koperasi pubkey diisi ─────────────
  useEffect(() => {
    if (!koperasi.trim() || koperasi.length < 32 || !publicKey) {
      setAgState("idle"); setMillStep("idle"); return
    }
    let cancelled = false
    const run = async () => {
      setAgState("checking"); setResumeLoading(true)
      try {
        const info = await checkAgreement(publicKey.toBase58(), koperasi.trim())
        if (cancelled) return
        if (info.state === "pending_accept") {
          setAgState("pending")
        } else if (info.state === "active") {
          setAgState("active")
          const r = await resume(publicKey.toBase58(), koperasi.trim())
          if (!cancelled) {
            setMillStep(r.step)
            setResumeNonce(r.nonce)
            if (r.step === "needs_cosign") setNonce(r.nonce.toString())
          }
        } else {
          setAgState("none")
        }
      } catch { if (!cancelled) setAgState("none") }
      finally  { if (!cancelled) setResumeLoading(false) }
    }
    const timer = setTimeout(run, 600)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [koperasi, publicKey, checkAgreement, resume, acceptStatus, cosignStatus])

  // ── Validation KYC ─────────────────────────────────────────────────────────
  function validateKyc(): Record<string,string> {
    const e: Record<string,string> = {}
    if (!millName.trim())  e.millName = t("errMillName", lang)
    if (!/^\d{15,16}$/.test(millNPWP.replace(/[.\-\s]/g,""))) e.millNPWP = t("errMillNPWP", lang)
    if (millAddr.length < 10) e.millAddr = t("errMillAddr", lang)
    if (!picName.trim())   e.picName   = t("errPIC", lang)
    if (!/^(\+62|0)8[0-9]{8,12}$/.test(picPhone.trim())) e.picPhone = t("errPhone", lang)
    return e
  }

  function fp(lbl: string, icon: React.ReactNode, val: string, set: (v:string)=>void, key: string,
              rest?: Partial<React.InputHTMLAttributes<HTMLInputElement>>): FieldProps {
    return {
      label: lbl, icon, value: val, error: errors[key], touched: touched[key],
      onChange: e => set(e.target.value),
      onBlur: () => {
        setTouched(p => ({ ...p, [key]: true }))
        setErrors(p => ({ ...p, [key]: validateKyc()[key] ?? "" }))
      },
      ...rest
    }
  }

  async function handleSaveKyc() {
    if (!publicKey) return
    const allKeys = ["millName","millNPWP","millAddr","picName","picPhone"]
    setTouched(Object.fromEntries(allKeys.map(k => [k, true])))
    const errs = validateKyc(); setErrors(errs)
    if (Object.keys(errs).some(k => errs[k])) return
    const ok = await register({
      entity_type: "mill", name: millName.trim(),
      reg_number:  millNPWP.replace(/[.\-\s]/g,""),
      address:     millAddr.trim(),
      pic_name:    picName.trim(),
      pic_phone:   picPhone.trim(),
      wallet_pubkey: publicKey.toBase58(),
    })
    if (ok) setKycDone(true)
  }

  async function handleAccept() { await acceptAgreement(koperasi.trim()) }

  async function handleCosign() {
    if (!publicKey || !koperasi.trim()) return
    await cosign(publicKey, new PublicKey(koperasi.trim()), BigInt(nonce))
  }

  function handleResetKyc() {
    setKycDone(false)
    // Re-check dari server setelah reset
    if (publicKey) checkKyc(publicKey.toBase58())
  }

  const demoSteps  = tArr("demoSteps", lang)
  const hl = [
    agState==="idle"||agState==="none"||agState==="pending",
    agState==="pending",
    agState==="active" && millStep==="needs_cosign",
    millStep==="cosigned",
    millStep==="advance_active",
  ]

  return (
    <div>
      <div className="flex items-center gap-4 mb-7">
        <div className="w-11 h-11 rounded-2xl bg-amber/15 border border-amber/25 flex items-center justify-center shrink-0">
          <Factory size={22} className="text-amber"/>
        </div>
        <div>
          <h2 className="font-display text-xl lg:text-2xl text-amber font-bold">{t("millTitle", lang)}</h2>
          <p className="font-mono text-xs text-bark">{t("millSub", lang)}</p>
        </div>
      </div>

      <IdlStatus/>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* ── Kiri ── */}
        <div className="space-y-5">

          {/* KYC loading */}
          {kycLoading && (
            <p className="font-mono text-xs text-bark flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin-slow"/>
              {lang==="id" ? "Memeriksa data mill…" : "Checking mill data…"}
            </p>
          )}

          {/* KYC form atau summary */}
          {!kycDone ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-amber"/>
                <p className="font-mono text-xs text-amber font-semibold uppercase tracking-wider">
                  {t("millIdentity", lang)}
                </p>
              </div>
              <Field {...fp(t("fldMillName",lang), <Building2 size={11}/>, millName, setMillName, "millName",
                           {placeholder:"PT Sari Sawit Nusantara"})}/>
              <Field {...fp(t("fldMillNPWP",lang), <Hash size={11}/>, millNPWP, setMillNPWP, "millNPWP",
                           {placeholder:"01.234.567.8-217.000"})}/>
              <Field {...fp(t("fldMillAddr",lang), <MapPin size={11}/>, millAddr, setMillAddr, "millAddr",
                           {placeholder:"Jl. Industri No.5, Kab. Pelalawan, Riau"})}/>
              <Field {...fp(t("fldPIC",lang),      <User size={11}/>, picName, setPicName, "picName",
                           {placeholder:"Hendra Wijaya"})}/>
              <Field {...fp(t("fldWA",lang),        <Phone size={11}/>, picPhone, setPicPhone, "picPhone",
                           {placeholder:"082198765432", type:"tel"})}/>
              <button onClick={handleSaveKyc} disabled={regLoading} className="btn-amber w-full">
                {regLoading
                  ? <><Loader2 size={15} className="animate-spin-slow"/> {lang==="id"?"Menyimpan…":"Saving…"}</>
                  : <><ShieldCheck size={15}/> {t("btnSaveKyc", lang)}</>}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* KYC done summary */}
              <div className="bg-amber/5 border border-amber/20 rounded-xl px-4 py-3 flex items-center gap-3">
                <CheckCircle2 size={16} className="text-amber shrink-0"/>
                <div>
                  <p className="font-mono text-xs text-amber font-semibold">
                    {t("kycSaved", lang)}
                    {kycInfo?.status === "registered" && (
                      <span className="ml-2 font-normal text-bark text-[10px]">
                        · {lang==="id" ? "dari DB" : "from DB"}
                      </span>
                    )}
                  </p>
                  <p className="font-body text-xs text-bark">{millName}</p>
                </div>
                <button onClick={handleResetKyc}
                        className="ml-auto font-mono text-[10px] text-bark hover:text-amber transition-colors">
                  {t("kycEdit", lang)}
                </button>
              </div>

              {/* Input koperasi pubkey */}
              <div>
                <label className="label">
                  <Hash size={11} className="text-[#7a9a6a]"/> {t("fldKoperasi", lang)}
                </label>
                <input value={koperasi} onChange={e=>setKoperasi(e.target.value)}
                       placeholder={t("fldKopPh", lang)} className="input-field"/>

                {(agState==="checking" || resumeLoading) ? (
                  <p className="font-mono text-[10px] text-bark mt-1.5 flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin-slow"/> {t("agChecking2", lang)}
                  </p>
                ) : agState==="pending" ? (
                  <p className="font-mono text-[10px] text-amber mt-1.5 flex items-center gap-1">
                    <Link2 size={10}/> {t("agPropPending", lang)}
                  </p>
                ) : agState==="active" ? (
                  <p className="font-mono text-[10px] text-lime mt-1.5 flex items-center gap-1">
                    <CheckCircle2 size={10}/> {t("agActiveShort", lang)}
                  </p>
                ) : agState==="none" && koperasi.length > 30 ? (
                  <p className="font-mono text-[10px] text-bark mt-1.5">{t("agNoMatch", lang)}</p>
                ) : null}
              </div>

              {/* Step badge */}
              {agState==="active" && <StepBadge step={millStep} lang={lang}/>}

              {/* Accept agreement */}
              {agState==="pending" && (
                <div className="bg-amber/8 border border-amber/25 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Link2 size={14} className="text-amber"/>
                    <p className="font-mono text-sm text-amber font-semibold">{t("acceptTitle", lang)}</p>
                  </div>
                  <p className="font-body text-xs text-bark leading-relaxed">{t("acceptDesc", lang)}</p>
                  <TxButton status={acceptStatus} txSig={acceptTx} onClick={handleAccept}
                            label={t("btnAccept", lang)} icon={<CheckCircle2 size={15}/>} variant="amber"/>
                  {acceptError && <p className="font-mono text-xs text-red-400">✗ {acceptError}</p>}
                  {acceptTx && (
                    <a href={`https://explorer.solana.com/tx/${acceptTx}?cluster=${CLUSTER}`}
                       target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-1 font-mono text-[10px] text-sky/60 hover:text-sky">
                      <ExternalLink size={10}/> {t("viewTx", lang)}
                    </a>
                  )}
                </div>
              )}

              {/* Cosign form */}
              {agState==="active" && (millStep==="needs_cosign"||millStep==="idle"||millStep==="done") && (
                <div className="space-y-4 animate-slide-up">
                  <div className="flex items-center gap-2">
                    <FileCheck size={14} className="text-amber"/>
                    <p className="font-mono text-xs text-amber font-semibold uppercase tracking-wider">
                      {t("cosignTitle", lang)}
                    </p>
                    {millStep==="needs_cosign" && (
                      <span className="ml-auto font-mono text-[9px] text-amber bg-amber/10 px-2 py-0.5 rounded-full">
                        {t("autoFillBadge", lang)}
                      </span>
                    )}
                  </div>
                  <div>
                    <label className="label">
                      <Hash size={11} className="text-[#7a9a6a]"/> {t("fldNonce", lang)}
                    </label>
                    <input type="number" value={nonce} onChange={e=>setNonce(e.target.value)}
                           className="input-field"/>
                    <p className="font-mono text-[10px] text-bark mt-1.5">
                      {millStep==="needs_cosign" ? t("nonceAuto", lang) : t("nonceManual", lang)}
                    </p>
                  </div>
                  {cosignError && (
                    <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/25 rounded-xl px-4 py-3">
                      <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0"/>
                      <p className="font-mono text-xs text-red-400">{cosignError}</p>
                    </div>
                  )}
                  <TxButton status={cosignStatus} txSig={cosignTx} onClick={handleCosign}
                            label={millStep==="needs_cosign" ? t("btnCosignAuto",lang) : t("btnCosignMan",lang)}
                            icon={<FileCheck size={15}/>} variant="amber" disabled={!koperasi.trim()}/>
                  {cosignTx && (
                    <a href={`https://explorer.solana.com/tx/${cosignTx}?cluster=${CLUSTER}`}
                       target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-1 font-mono text-[10px] text-sky/60 hover:text-sky">
                      <ExternalLink size={10}/> {t("viewTx", lang)}
                    </a>
                  )}
                </div>
              )}

              {/* Advance active info */}
              {millStep==="advance_active" && (
                <div className="bg-[#152515] border border-forest-600 rounded-xl px-4 py-4">
                  <p className="font-mono text-xs text-bark mb-2">
                    {t("advanceActive", lang)} <span className="text-amber">{resumeNonce.toString()}</span>
                  </p>
                  <p className="font-body text-xs text-[#f0f2e8]/50 leading-relaxed">
                    {t("advanceDesc", lang)}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Kanan ── */}
        <div className="space-y-4">
          <div className="bg-amber/5 border border-amber/15 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 size={14} className="text-amber"/>
              <p className="font-mono text-xs text-amber font-semibold uppercase tracking-wider">
                {t("millDuty", lang)}
              </p>
            </div>
            <p className="font-body text-sm text-[#f0f2e8]/70 leading-relaxed">{t("millDutyDesc", lang)}</p>
          </div>

          <div className="bg-[#152515] border border-forest-600/50 rounded-2xl p-5">
            <p className="font-mono text-[9px] text-bark uppercase tracking-widest mb-4">
              {t("demoFlow", lang)}
            </p>
            <div className="space-y-3">
              {demoSteps.map((txt, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <span className={`font-mono text-xs shrink-0 w-4 ${hl[i]?"text-amber font-bold":"text-bark"}`}>
                    {i+1}
                  </span>
                  <ArrowRight size={11} className={`mt-0.5 shrink-0 ${hl[i]?"text-amber":"text-forest-500"}`}/>
                  <span className={`font-body text-xs leading-relaxed ${hl[i]?"text-amber font-medium":"text-[#f0f2e8]/45"}`}>
                    {txt}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {kycDone && koperasi.trim().length > 30 && (
            <button
              onClick={() => {
                setAgState("idle"); setMillStep("idle")
                setTimeout(() => setKoperasi(k => k+" "), 10)
                setTimeout(() => setKoperasi(k => k.trim()), 50)
              }}
              className="btn-ghost w-full text-xs py-2">
              <RefreshCw size={12}/> {t("btnRefresh", lang)}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}