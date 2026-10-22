import { contextBridge, ipcRenderer } from "electron"

// The gateway's MessagePort cannot travel through contextBridge. Main posts it on "mortise:channel";
// this handler forwards it to the page's main world, where the renderer accepts it only from its own
// window and only with the matching marker (src/renderer/main.tsx). Nothing else is exposed.
ipcRenderer.on("mortise:channel", (event) => {
  window.postMessage("mortise:channel", "*", event.ports)
})

// The preload exposes a minimal, typed surface. Never expose ipcRenderer, Node APIs or engine credentials.
contextBridge.exposeInMainWorld("mortise", {
  platform: "desktop" as const,
})
