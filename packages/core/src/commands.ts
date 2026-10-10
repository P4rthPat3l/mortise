import { createDisposable, type Disposable } from "./disposable.js"

/**
 * A command a module contributes. `execute` forwards its positional arguments to `run` and
 * converts a synchronous throw into a rejected promise.
 */
export interface Command<Args extends readonly unknown[] = readonly unknown[]> {
  /** Globally unique id, for example `"settings.open"`. */
  readonly id: string
  /** Human-readable title for menus and the command palette. */
  readonly title: string
  /** When this returns false, `execute` rejects with a `"disabled"` {@link CommandError}. */
  readonly enabled?: () => boolean
  run(...args: Args): unknown | Promise<unknown>
}

/** The reason a {@link CommandService} call failed. */
export type CommandErrorCode = "not-found" | "disabled" | "duplicate"

/** Typed failure of the command service. */
export class CommandError extends Error {
  readonly code: CommandErrorCode
  readonly commandId: string

  constructor(code: CommandErrorCode, commandId: string) {
    super(messageFor(code, commandId))
    this.name = "CommandError"
    this.code = code
    this.commandId = commandId
  }
}

/** One entry of {@link CommandService.list}. */
export interface CommandInfo {
  readonly id: string
  readonly title: string
  readonly enabled: boolean
}

interface StoredCommand {
  readonly id: string
  readonly title: string
  readonly enabled?: () => boolean
  readonly run: (...args: unknown[]) => unknown
}

/** The command registry: one handler per id, no duplicates, typed failures. */
export class CommandService {
  private readonly commands = new Map<string, StoredCommand>()

  /** Registers a command. Throws a `"duplicate"` {@link CommandError} if the id is taken. */
  register<Args extends readonly unknown[]>(command: Command<Args>): Disposable {
    if (this.commands.has(command.id)) throw new CommandError("duplicate", command.id)
    const stored: StoredCommand = {
      id: command.id,
      title: command.title,
      enabled: command.enabled,
      run: (...args: unknown[]) => command.run(...(args as unknown as Args)),
    }
    this.commands.set(command.id, stored)
    return createDisposable(() => {
      if (this.commands.get(command.id) === stored) this.commands.delete(command.id)
    })
  }

  /** Runs a command. Rejects with a `"not-found"` or `"disabled"` {@link CommandError}. */
  async execute(id: string, ...args: readonly unknown[]): Promise<unknown> {
    const command = this.commands.get(id)
    if (!command) throw new CommandError("not-found", id)
    if (command.enabled && !command.enabled()) throw new CommandError("disabled", id)
    return command.run(...args)
  }

  /** Snapshot of the registered commands in registration order. */
  list(): readonly CommandInfo[] {
    return [...this.commands.values()].map((command) => ({
      id: command.id,
      title: command.title,
      enabled: command.enabled ? command.enabled() : true,
    }))
  }
}

function messageFor(code: CommandErrorCode, id: string): string {
  switch (code) {
    case "not-found":
      return `Unknown command "${id}"`
    case "disabled":
      return `Command "${id}" is disabled`
    case "duplicate":
      return `Command "${id}" is already registered`
  }
}
