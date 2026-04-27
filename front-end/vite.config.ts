import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
 
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      // Polyfill Node.js globals (Buffer, process, dll) di level bundler
      // Harus sebelum react plugin
      nodePolyfills({
        // Hanya polyfill yang dibutuhkan Solana
        include:  ["buffer", "crypto", "stream", "util"],
        globals:  { Buffer: true, global: true, process: true },
        protocolImports: true,
      }),
      react(),
    ],
    define: {
      "process.env": {},
    },
    server: {
      host: true,
      port: 5051,
      allowedHosts: true
    },
    preview: {
      host: true,
      port: 5051,
      allowedHosts: true
    },
  };
});
