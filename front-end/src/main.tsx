import React from "react"
import ReactDOM from "react-dom/client"
import "./index.css"
import App from "./App"
import { WalletContext }  from "./contexts/WalletContext"
import { ProgramProvider } from "./contexts/ProgramContext"
import { LangProvider }   from "./contexts/LangContext"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LangProvider>
      <WalletContext>
        <ProgramProvider>
          <App/>
        </ProgramProvider>
      </WalletContext>
    </LangProvider>
  </React.StrictMode>
)