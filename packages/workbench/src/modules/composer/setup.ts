import type { Setup } from "@mortise/sdk"
import type { definition } from "./module"

/** Nothing to register yet: the view reads its services from the module context. */
export const setup: Setup<typeof definition> = () => {}
