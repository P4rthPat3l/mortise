import type { Setup } from "@mortise/sdk"
import { Sessions } from "./contract"
import type { definition } from "./module"

/** Supplies the session service under the module's own contract. */
export const setup: Setup<typeof definition> = (ctx) => {
  ctx.provide(Sessions, ctx.requires.service)
}
