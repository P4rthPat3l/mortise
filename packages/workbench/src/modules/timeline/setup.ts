import type { Setup } from "@mortise/sdk"
import { Timeline } from "./contract"
import type { definition } from "./module"

/** Supplies the timeline service under the module's own contract. */
export const setup: Setup<typeof definition> = (ctx) => {
  ctx.provide(Timeline, ctx.requires.service)
}
