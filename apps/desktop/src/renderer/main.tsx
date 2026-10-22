import { createClient } from "@mortise/rpc-contracts"
import { App } from "@mortise/workbench"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { rendererTransport } from "./transport"

const root = document.getElementById("root")
if (!root) throw new Error("Missing #root element")

const container = createRoot(root)

// The preload forwards the gateway's private MessagePort after the window loads. Accept it only
// from this window's own message and only when the payload is the agreed marker.
window.addEventListener("message", (event) => {
  if (event.source !== window || event.data !== "mortise:channel") return
  const port = event.ports[0]
  if (port === undefined) return
  const channel = createClient(rendererTransport(port))
  container.render(
    <StrictMode>
      <App channel={channel} />
    </StrictMode>,
  )
})
