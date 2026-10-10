import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"

// Workspace packages export TypeScript source, so they must be bundled rather than externalized.
const workspacePackages = [
  "@mortise/core",
  "@mortise/domain",
  "@mortise/engine-opencode",
  "@mortise/gateway-core",
  "@mortise/rpc-contracts",
  "@mortise/sdk",
  "@mortise/ui",
  "@mortise/workbench",
]

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: workspacePackages },
    },
  },
  preload: {
    build: {
      // A sandboxed preload cannot load modules at runtime, so bundle everything except electron itself.
      externalizeDeps: false,
      rollupOptions: {
        external: ["electron"],
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    plugins: [react()],
  },
})
