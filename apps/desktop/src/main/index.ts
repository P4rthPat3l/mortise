import { join } from "node:path"
import {
  consoleSink,
  createDiscovery,
  createGateway,
  createLogger,
  defaultFindCli,
  openCodeServiceClient,
} from "@mortise/gateway-core"
import { serverIdSchema } from "@mortise/rpc-contracts"
import { app, BrowserWindow, MessageChannelMain, shell } from "electron"
import { CHANNEL_NAME, createGatewayHost } from "./gateway-host.js"

// Main hosts the app's single gateway and gives each window a private MessagePort channel. It holds
// engine credentials; renderer code never does. Domain logic stays out of main.
const logger = createLogger(consoleSink())
const engineFetch = globalThis.fetch

const host = createGatewayHost({
  createGateway: () =>
    createGateway({
      serverId: serverIdSchema.parse("shared"),
      discovery: createDiscovery({ client: openCodeServiceClient(), findCli: defaultFindCli }),
      fetch: engineFetch,
      logger,
    }),
  createChannel: () => {
    const channel = new MessageChannelMain()
    return { main: channel.port1, windowPort: channel.port2 }
  },
  fetch: engineFetch,
  logger,
})

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

  // The channel is sent on every load, after the preload has registered its forwarder.
  host.attach({
    onDidFinishLoad: (listener) => window.webContents.on("did-finish-load", listener),
    onClosed: (listener) => window.on("closed", listener),
    sendChannel: (port) => window.webContents.postMessage(CHANNEL_NAME, null, [port]),
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
  host.start()
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quitting stops our gateway (timers, stream, listeners) and never the shared engine (ADR-0002).
app.on("before-quit", () => host.dispose())

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
