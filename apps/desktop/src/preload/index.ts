import { contextBridge } from "electron"

// The preload exposes a minimal, typed surface. T-008 adds the gateway Channel (MessagePort) here.
// Never expose ipcRenderer, Node APIs or engine credentials to the renderer.
contextBridge.exposeInMainWorld("mortise", {
  platform: "desktop" as const,
})
