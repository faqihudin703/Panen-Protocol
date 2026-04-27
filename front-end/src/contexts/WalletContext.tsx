import { FC, ReactNode, useMemo } from "react"
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react"
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui"
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom"
import { RPC_URL } from "../config/constants"
import "@solana/wallet-adapter-react-ui/styles.css"

const Conn  = ConnectionProvider  as any
const Wal   = WalletProvider      as any
const Modal = WalletModalProvider as any

export const WalletContext: FC<{ children: ReactNode }> = ({ children }) => {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], [])
  return (
    <Conn endpoint={RPC_URL}>
      <Wal wallets={wallets} autoConnect>
        <Modal>{children}</Modal>
      </Wal>
    </Conn>
  )
}
