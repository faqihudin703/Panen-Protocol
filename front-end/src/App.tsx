import { WalletMultiButton } from "@solana/wallet-adapter-react-ui"
import { useWallet }         from "@solana/wallet-adapter-react"
import { useState }          from "react"
import {
  Sprout, Handshake, Factory,
  TrendingUp, Shield, Globe, CheckCircle2
} from "lucide-react"
import { KoperasiPanel } from "./components/KoperasiPanel"
import { MillPanel }     from "./components/MillPanel"
import { FlowTimeline }  from "./components/FlowTimeline"
import { useChainStats } from "./hooks/useChainStats"
import { usePoolInfo }   from "./hooks/usePoolInfo"
import { useLang }       from "./contexts/LangContext"
import { t, tArr }       from "./i18n/strings"
import { PROGRAM_ID, CLUSTER } from "./config/constants"

type Persona = "koperasi" | "mill" | null

const PANEL_BORDER: Record<string, string> = {
  koperasi: "card-lime",
  mill:     "card-amber",
}
const EXPLORER = (addr: string) =>
    `https://explorer.solana.com/address/${addr}?cluster=${CLUSTER}`

export default function App() {
  const { connected }  = useWallet()
  const { lang, toggle: toggleLang } = useLang()
  const [persona, setPersona] = useState<Persona>(null)

  const stats = useChainStats()
  const pool  = usePoolInfo()

  const PERSONAS = [
    {
      id:     "koperasi",
      icon:   <Handshake size={22}/>,
      label:  t("koperasiLabel", lang),
      desc:   t("koperasiDesc", lang),
      active: "persona-pill-active-lime",
      idle:   "persona-pill-lime",
      badge:  "badge-lime",
    },
    {
      id:     "mill",
      icon:   <Factory size={22}/>,
      label:  t("millLabel", lang),
      desc:   t("millDesc", lang),
      active: "persona-pill-active-amber",
      idle:   "persona-pill-amber",
      badge:  "badge-amber",
    },
  ] as const

  const flowSteps = tArr("flowSteps", lang)
  const flowSubs  = tArr("flowSubs", lang)
  const STEPS = flowSteps.map((label, i) => ({
    label, sublabel: flowSubs[i] ?? ""
  }))

  const activePersona = PERSONAS.find(p => p.id === persona)
  const poolAddr   = pool.poolPubkey.toBase58()
  const oracleAddr = pool.oraclePubkey.toBase58()

  const rateDisplay = stats.oracleActive
      ? `Rp${(Number(stats.oracleRateRaw)/10_000).toLocaleString("id-ID")}/USDC · BI`
      : pool.loaded && !pool.error ? t("inactive", lang) : t("loading", lang)

  const infoRows: [string, string, string][] = [
    [t("infoProgram" as any, lang) ?? "Program",
     PROGRAM_ID.toBase58().slice(0,8)+"…"+PROGRAM_ID.toBase58().slice(-4),
     EXPLORER(PROGRAM_ID.toBase58())],
    [t("infoPool" as any, lang) ?? "Pool",
     stats.loading ? t("loading",lang) : `${stats.poolBalanceUsdc.toLocaleString("id-ID",{maximumFractionDigits:2})} USDC · devnet`,
     EXPLORER(poolAddr)],
    [t("infoOracle" as any, lang) ?? "Oracle",
     stats.loading ? t("loading",lang) : rateDisplay,
     EXPLORER(oracleAddr)],
  ]

  const STATS_ITEMS = [
    { val:"50 USDC",   lbl:t("statPool",lang),       Icon:TrendingUp, cls:"text-lime"  },
    { val:"Rp17.189",  lbl:t("statRate",lang),        Icon:TrendingUp, cls:"text-lime"  },
    { val:"3.5%",      lbl:t("statFee",lang),         Icon:Sprout,     cls:"text-amber" },
    { val:"80%",       lbl:t("statAdvance",lang),     Icon:Sprout,     cls:"text-amber" },
    { val:"Dual Sign", lbl:t("statDual",lang),        Icon:Shield,     cls:"text-sky"   },
    { val:"EUDR",      lbl:t("statCompliance",lang),  Icon:Globe,      cls:"text-sky"   },
  ]

  const FLOW_CHAIN = lang === "id"
    ? ["Petani","→","Koperasi","↔","Mill","→","USDC on-chain","→","Koperasi","→","Rupiah ke Petani"]
    : ["Farmer","→","Coop","↔","Mill","→","USDC on-chain","→","Coop","→","IDR to Farmer"]

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 border-b border-forest-600/80 bg-[#1a2e1a]/75 backdrop-blur-xl">
        <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-8 xl:px-12 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-lime/10 border border-lime/20 flex items-center justify-center shrink-0">
              <Sprout size={18} className="text-lime"/>
            </div>
            <div>
              <p className="font-display font-bold text-sm text-[#f0f2e8] leading-tight">Panen Protocol</p>
              <p className="font-mono text-[9px] text-bark uppercase tracking-[0.2em]">{t("appSubtitle",lang)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {connected && activePersona && (
              <span className={`${activePersona.badge} hidden sm:inline-flex`}>{activePersona.label}</span>
            )}
            {/* Language toggle */}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); toggleLang() }}
              className="relative z-[60] font-mono text-[10px] text-bark hover:text-lime
                         border border-forest-600/60 hover:border-lime/30
                         rounded-lg px-2.5 py-1.5 transition-colors shrink-0
                         cursor-pointer select-none">
              {t("langToggle", lang)}
            </button>
            <WalletMultiButton/>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-8 xl:px-12 py-8 lg:py-12">

        {/* ── Hero ── */}
        {!connected && (
          <div className="animate-fade-in">
            <div className="text-center mb-14 lg:mb-20">
              <div className="inline-flex items-center justify-center w-20 h-20 lg:w-24 lg:h-24 rounded-3xl bg-lime/10 border border-lime/20 mb-8 animate-glow">
                <Sprout size={44} className="text-lime"/>
              </div>
              <h1 className="font-display font-black text-4xl sm:text-5xl lg:text-6xl xl:text-7xl text-lime mb-4 leading-[1.05]">
                Panen Protocol
              </h1>
              <p className="font-body text-base sm:text-lg text-[#f0f2e8]/50 max-w-lg mx-auto leading-relaxed mb-4">
                {t("heroTagline", lang)}
              </p>
              <p className="font-mono text-xs text-bark/60 mb-10">{t("heroSubtag", lang)}</p>
              <WalletMultiButton/>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-12">
              {STATS_ITEMS.map(({ val, lbl, Icon, cls }) => (
                <div key={lbl} className="bg-[#1f351f]/80 border border-forest-600 rounded-2xl p-4 lg:p-5 text-center">
                  <Icon size={16} className={`${cls} mx-auto mb-2 opacity-60`}/>
                  <p className={`font-mono text-xl lg:text-2xl font-bold ${cls} mb-1`}>{val}</p>
                  <p className="font-body text-xs text-bark leading-tight">{lbl}</p>
                </div>
              ))}
            </div>

            <div className="card max-w-2xl mx-auto">
              <p className="font-mono text-[10px] text-bark uppercase tracking-widest mb-5 text-center">
                {t("flowTitle", lang)}
              </p>
              <FlowTimeline steps={STEPS.map(s => ({ ...s, done:false, active:false }))}/>
              <div className="mt-5 pt-4 border-t border-forest-600">
                <p className="font-mono text-[10px] text-bark/50 text-center mb-3">{t("flowNote", lang)}</p>
                <div className="flex flex-wrap items-center justify-center gap-1.5 font-mono text-xs text-bark">
                  {FLOW_CHAIN.map((s,i) => (
                    <span key={i} className={
                      s==="Koperasi"||s==="Coop" ? "text-lime font-semibold" :
                      s==="Mill"                 ? "text-amber font-semibold" :
                      s==="USDC on-chain"        ? "text-sky" :
                      s==="→"||s==="↔"          ? "text-forest-400" : ""
                    }>{s}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Dashboard ── */}
        {connected && (
          <div className="animate-fade-in space-y-8">
            <div className="overflow-x-auto pb-2">
              <div className="min-w-[400px]">
                <FlowTimeline steps={STEPS.map((s,i) => ({
                  ...s, done:false,
                  active: (i===0&&persona==="koperasi")||(i===1&&persona==="mill"),
                }))}/>
              </div>
            </div>

            <div>
              <p className="font-mono text-[11px] text-bark uppercase tracking-[0.18em] mb-4">
                {t("selectRole", lang)}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {PERSONAS.map(p => {
                  const isActive = persona === p.id
                  return (
                    <button key={p.id} onClick={() => setPersona(p.id as Persona)}
                            className={isActive ? p.active : p.idle}>
                      <span className="shrink-0">{p.icon}</span>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm leading-tight">{p.label}</p>
                        <p className="text-xs opacity-60 leading-tight mt-0.5">{p.desc}</p>
                      </div>
                      {isActive && <CheckCircle2 size={16} className="ml-auto shrink-0 opacity-80"/>}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="bg-[#1a2e1a]/50 border border-forest-600/40 rounded-2xl px-5 py-4">
              <div className="flex items-center gap-2 mb-2">
                <Sprout size={13} className="text-bark"/>
                <p className="font-mono text-[10px] text-bark uppercase tracking-widest">
                  {t("paymentNote", lang)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 font-body text-sm">
                <span className="text-lime font-medium">{t("payStep1", lang)}</span>
                <span className="text-forest-400 font-mono text-xs">→</span>
                <span className="text-[#f0f2e8]/60">{t("payStep2", lang)}</span>
                <span className="text-forest-400 font-mono text-xs">→</span>
                <span className="text-[#f0f2e8]/60">{t("payStep3", lang)}</span>
                <span className="font-mono text-[10px] text-bark">· {t("payNoCrypto", lang)}</span>
              </div>
            </div>

            {persona && (
              <div className={`${PANEL_BORDER[persona]??"card"} animate-slide-up`}>
                {persona==="koperasi" && <KoperasiPanel/>}
                {persona==="mill"     && <MillPanel/>}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {infoRows.map(([k, v, url]) => (
                <a key={k} href={url} target="_blank" rel="noopener noreferrer"
                   className="bg-[#1a2e1a]/60 border border-forest-600/50 rounded-xl px-4 py-3
                              flex items-center justify-between hover:border-forest-500 transition-all group">
                  <span className="font-mono text-[10px] text-bark uppercase tracking-wider">{k}</span>
                  <span className={`font-mono text-xs transition-colors ${
                    stats.error&&k!=="Program" ? "text-red-400/60" : "text-[#f0f2e8]/40 group-hover:text-[#f0f2e8]/60"
                  }`}>
                    {stats.error&&k!=="Program" ? t("rpcErr",lang) : v} ↗
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}