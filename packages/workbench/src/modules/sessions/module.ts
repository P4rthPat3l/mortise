import { Module } from "@mortise/sdk"
import { Sessions, SessionsService } from "./contract"

/** The sessions module: it provides the session list service the composition root built. */
export const definition = Module.define({
  id: "sessions",
  provides: { sessions: Sessions },
  requires: { service: SessionsService },
})
