# First-party feature modules

Each feature lives in its own folder: `src/modules/<module-id>/`.

```text
src/modules/review/
├── index.ts      Module.define(...) manifest: id, provides, uses, requires, stores
├── contract.ts   The only file other modules may import: contract tokens and their types
├── setup.tsx     Registers contributions through ctx.add(...)
└── *.tsx / *.ts  Private implementation
```

Rules (enforced by `.dependency-cruiser.cjs`):

- A module imports `@mortise/sdk`, `@mortise/ui`, `@mortise/domain`, its own files, and other modules' `contract.ts` only.
- A module never imports `@mortise/engine-opencode`, `@opencode/*`, `@mortise/core` internals or Electron. Engine access goes through contracts and the store that the composition root provides.
- The shell never names a module. Modules contribute through registries.
