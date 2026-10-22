import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"

// T-015: the spike debug page is a second renderer entry, built only when explicitly asked for. A
// normal build keeps the product entry point list unchanged and never emits spike.html.
const spikeBuild = process.env.MORTISE_SPIKE_BUILD === "1"

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
    ...(spikeBuild
      ? {
          build: {
            rollupOptions: {
              input: {
                index: resolve(process.cwd(), "src/renderer/index.html"),
                spike: resolve(process.cwd(), "src/renderer/spike.html"),
              },
            },
          },
        }
      : {}),
  },
})
