/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLUSTER:       string
  readonly VITE_RPC_URL:       string
  readonly VITE_FLASK_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}