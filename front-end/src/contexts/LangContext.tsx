import { createContext, useContext, useState, useEffect, FC, ReactNode } from "react"
import { Lang } from "../i18n/strings"

interface LangCtx { lang: Lang; toggle: () => void }
const Ctx = createContext<LangCtx>({ lang: "id", toggle: () => {} })

export const LangProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [lang, setLang] = useState<Lang>("id")

  // Sync ke body class untuk CSS override wallet modal title
  useEffect(() => {
    if (lang === "en") {
      document.body.classList.add("lang-en")
    } else {
      document.body.classList.remove("lang-en")
    }
  }, [lang])

  const toggle = () => setLang(l => l === "id" ? "en" : "id")
  return <Ctx.Provider value={{ lang, toggle }}>{children}</Ctx.Provider>
}

export const useLang = () => useContext(Ctx)