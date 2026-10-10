import { join } from "node:path"
import { app, BrowserWindow, shell } from "electron"

// The gateway host (T-008) will start @mortise/gateway-core here and hand each window a MessagePort channel.
// Main never contains domain logic; it hosts the gateway and the platform services.

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  window.once("ready-to-show", () => window.show())

  // The app never navigates away from its own renderer; external links open in the system browser.
  window.webContents.on("will-navigate", (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith("https://")) void shell.openExternal(details.url)
    return { action: "deny" }
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) void window.loadURL(devServer)
  else void window.loadFile(join(import.meta.dirname, "../renderer/index.html"))
}

if (!app.requestSingleInstanceLock()) app.quit()

app.whenReady().then(() => {
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
