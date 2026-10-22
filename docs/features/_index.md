# Feature Documentation Index

This directory contains one canonical document per Mortise feature, written with the `feature-documentation` skill (`.agents/skills/feature-documentation/SKILL.md`).

Use this index to find the one feature document relevant to a task. Do not load every feature document into agent context.

| Feature | Document | Search terms | Primary entry point |
| ------- | -------- | ------------ | ------------------- |
| Engine gateway | [FEAT-001-engine-gateway.md](./FEAT-001-engine-gateway.md) | engine gateway, discovery, connection state machine, event stream, resync, request forwarding, engine.fetch, desktop host, MessagePort channel | `packages/gateway-core/src/index.ts` |
| Module system | [FEAT-002-module-system.md](./FEAT-002-module-system.md) | module system, module SDK, Module.define, contracts, provides, uses, requires, liveness, Live, blocked, disabled, useModule, module host | `packages/sdk/src/index.ts` |
| Engine adapter | [FEAT-003-engine-adapter.md](./FEAT-003-engine-adapter.md) | engine adapter, wire formats, event translation, timeline mapping, message ids, permissions, forms | `packages/engine-opencode/src/index.ts` |

## Index maintenance

- Add a row when creating or verifying a canonical feature document.
- Keep search terms aligned with both product language and code terminology.
- Keep primary entry points concise: one route, component, service, or command that starts the feature flow.
- Do not list planning notes, research notes, or unverified feature folders here until they have been checked against source code.
- Take the next unused ID: `ls docs/features/ | grep -oE 'FEAT-[0-9]+' | sort -u | tail -1`. Never reuse or renumber an ID.
