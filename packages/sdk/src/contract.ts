const contractValue: unique symbol = Symbol("mortise.contract.value")

/**
 * A typed token that one module provides and others use or require. The value type is carried by a
 * phantom property, so a token is identity plus a type and nothing else.
 */
export interface Contract<T> {
  /** Stable identifier, used in diagnostics. */
  readonly id: string
  /** Phantom type parameter: the value the contract carries. */
  readonly [contractValue]?: T
}

/** The value type of a {@link Contract}. */
export type ContractValue<C> = C extends Contract<infer T> ? T : never

/** Creates contract tokens. */
export const Contract = {
  /** Creates a token for values of type `T` with a stable id. */
  define<T>(id: string): Contract<T> {
    return { id }
  },
}
