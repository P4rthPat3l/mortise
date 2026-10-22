import { mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
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
import { app, BrowserWindow, MessageChannelMain, net, protocol, shell } from "electron"
import { handleExtensionRequest } from "../spikes/extension-sandbox/main/scheme.js"
import { runExtensionSandboxSpike } from "../spikes/extension-sandbox/main/spike.js"
import { EXTENSION_SCHEME, EXTENSION_SCHEME_PRIVILEGES } from "../spikes/extension-sandbox/shared/constants.js"
import { CHANNEL_NAME, createGatewayHost } from "./gateway-host.js"

// Main hosts the app's single gateway and gives each window a private MessagePort channel. It holds
// engine credentials; renderer code never does. Domain logic stays out of main.
const logger = createLogger(consoleSink())
const engineFetch = globalThis.fetch

// T-015 evidence spike. It is unreachable in a packaged app and requires an explicit environment
// flag; the spike windows and the spike renderer entry are built only with MORTISE_SPIKE_BUILD=1.
const spikeMode = !app.isPackaged && process.env.MORTISE_SPIKE === "extension-sandbox"

if (spikeMode) {
  const userData = process.env.MORTISE_SPIKE_USER_DATA ?? join(tmpdir(), `mortise-extension-spike-${process.pid}`)
  mkdirSync(userData, { recursive: true })
  // A separate userData directory gives the spike its own single-instance lock, so it can run beside
  // a normal Mortise window without touching it.
  app.setPath("userData", userData)
  protocol.registerSchemesAsPrivileged([EXTENSION_SCHEME_PRIVILEGES])
}

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
      ...(spikeMode ? { backgroundThrottling: false } : {}),
    },
  })

  // The app never navigates away from its own renderer; external links open in the system browser.
  window.webContents.on("will-navigate", (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler((details) => {
    if (!spikeMode && details.url.startsWith("https://")) void shell.openExternal(details.url)
    return { action: "deny" }
  })

  window.once("ready-to-show", () => window.show())

  if (spikeMode) {
    loadSpikeWindow(window)
    return
  }

  // The channel is sent on every load, after the preload has registered its forwarder.
  host.attach({
    onDidFinishLoad: (listener) => window.webContents.on("did-finish-load", listener),
    onClosed: (listener) => window.on("closed", listener),
    sendChannel: (port) => window.webContents.postMessage(CHANNEL_NAME, null, [port]),
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) void window.loadURL(devServer)
  else void window.loadFile(join(import.meta.dirname, "../renderer/index.html"))
}

function loadSpikeWindow(window: BrowserWindow): void {
  const extensionRoot =
    process.env.MORTISE_SPIKE_EXTENSION_ROOT ?? join(app.getAppPath(), "src/spikes/extension-sandbox/sample-extension")
  const outputPath = process.env.MORTISE_SPIKE_OUT ?? join(tmpdir(), `mortise-extension-spike-${process.pid}.json`)
  const consoleMessages: string[] = []
  window.webContents.on("console-message", (event) => consoleMessages.push(event.message))

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) {
    const base = devServer.endsWith("/") ? devServer : `${devServer}/`
    void window.loadURL(new URL("spike.html", base).toString())
  } else {
    void window.loadFile(join(import.meta.dirname, "../renderer/spike.html"))
  }

  void runExtensionSandboxSpike({
    topExecute: (code) => window.webContents.executeJavaScript(code),
    frames: () =>
      window.webContents.mainFrame.framesInSubtree.map((frame) => ({
        url: frame.url,
        processId: frame.processId,
        osProcessId: frame.osProcessId,
        detached: frame.detached,
        executeJavaScript: (code) => frame.executeJavaScript(code),
      })),
    hostOSProcessId: () => window.webContents.mainFrame.osProcessId,
    hostChromiumProcessId: () => window.webContents.mainFrame.processId,
    topURL: () => window.webContents.getURL(),
    metrics: () =>
      app.getAppMetrics().map((metric) => ({
        pid: metric.pid,
        type: metric.type,
        workingSetKb: metric.memory.workingSetSize,
      })),
    windowCount: () => BrowserWindow.getAllWindows().length,
    fetchURL: async (url) => {
      const response = await net.fetch(url)
      return { status: response.status, text: () => response.text() }
    },
    consoleMessages: () => consoleMessages,
    extensionRoot,
    outputPath,
    exit: (code) => app.exit(code),
  })
}

if (!app.requestSingleInstanceLock()) app.quit()

app.whenReady().then(async () => {
  if (spikeMode) {
    const extensionRoot =
      process.env.MORTISE_SPIKE_EXTENSION_ROOT ??
      join(app.getAppPath(), "src/spikes/extension-sandbox/sample-extension")
    protocol.handle(EXTENSION_SCHEME, (request) => handleExtensionRequest(extensionRoot, request.url))
  } else {
    host.start()
  }
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
