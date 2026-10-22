import { Module } from "@mortise/sdk"
import { Sessions } from "../sessions/contract"
import { Timeline, TimelineService } from "./contract"

/** The timeline module: it reads the selected session and provides the timeline read surface. */
export const definition = Module.define({
  id: "timeline",
  provides: { timeline: Timeline },
  requires: { sessions: Sessions, service: TimelineService },
})
