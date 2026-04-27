import { createContext, FC, ReactNode, useContext, useMemo } from "react"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import * as anchor from "@anchor-lang/core"
import IDL from "../panen.json"

interface ProgramCtx {
  program:   anchor.Program | null
  provider:  anchor.AnchorProvider | null
  idlLoaded: boolean
}

const Ctx = createContext<ProgramCtx>({ program: null, provider: null, idlLoaded: false })

export const ProgramProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { connection } = useConnection()
  const wallet         = useWallet()

  const { program, provider } = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction)
      return { program: null, provider: null }

    const w = {
      publicKey:           wallet.publicKey,
      signTransaction:     wallet.signTransaction.bind(wallet)      as any,
      signAllTransactions: wallet.signAllTransactions?.bind(wallet)  as any,
    }

    const provider = new anchor.AnchorProvider(
      connection, w as any, { commitment: "confirmed" }
    )
    anchor.setProvider(provider)

    const program = new anchor.Program(IDL as anchor.Idl, provider)
    return { provider, program }
  }, [wallet.publicKey, wallet.signTransaction, connection])

  return (
    <Ctx.Provider value={{ program, provider, idlLoaded: !!program }}>
      {children}
    </Ctx.Provider>
  )
}

export const useProgram = () => useContext(Ctx)