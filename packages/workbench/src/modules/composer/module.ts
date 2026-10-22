import { Module } from "@mortise/sdk"
import { Sessions } from "../sessions/contract"
import { ComposerService } from "./contract"

/** The composer module: it addresses the selected session and the prompt service. */
export const definition = Module.define({
  id: "composer",
  requires: { sessions: Sessions, service: ComposerService },
})
