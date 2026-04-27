import { Check } from "lucide-react"

type Step = { label: string; sublabel: string; done: boolean; active: boolean }

export function FlowTimeline({ steps }: { steps: Step[] }) {
  return (
    <div className="flex items-start">
      {steps.map((s, i) => (
        <div key={i} className="flex items-start flex-1">
          <div className="flex flex-col items-center flex-1">
            <div className={`
              w-9 h-9 lg:w-10 lg:h-10 rounded-full
              flex items-center justify-center
              font-mono text-xs font-bold
              transition-all duration-300
              ${s.done
                ? "bg-lime  text-[#0f1f0f] shadow-[0_0_16px_rgba(163,230,53,0.5)]"
                : s.active
                ? "bg-amber text-[#0f1f0f] shadow-[0_0_16px_rgba(217,119,6,0.5)]"
                : "bg-forest-700 text-bark border border-forest-500"}`}>
              {s.done ? <Check size={16} strokeWidth={2.5} /> : i + 1}
            </div>
            <p className={`mt-2 text-center font-body text-[10px] sm:text-xs font-semibold
              ${s.active ? "text-amber" : s.done ? "text-lime" : "text-[#f0f2e8]/40"}`}>
              {s.label}
            </p>
            <p className="text-center font-mono text-[9px] text-forest-400 mt-0.5">
              {s.sublabel}
            </p>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-px flex-[0.35] mt-[18px] lg:mt-5 transition-all duration-500
              ${s.done ? "bg-lime/40" : "bg-forest-600"}`} />
          )}
        </div>
      ))}
    </div>
  )
}