# Feature Documentation Index

This directory contains one canonical document per Mortise feature, written with the `feature-documentation` skill (`.agents/skills/feature-documentation/SKILL.md`).

Use this index to find the one feature document relevant to a task. Do not load every feature document into agent context.

| Feature | Document | Search terms | Primary entry point |
| ------- | -------- | ------------ | ------------------- |
| Engine gateway | [FEAT-001-engine-gateway.md](./FEAT-001-engine-gateway.md) | engine gateway, discovery, connection state machine, event stream, resync, request forwarding, engine.fetch | `packages/gateway-core/src/index.ts` |

FEAT-002 (module system) is created by task T-011.

## Index maintenance

- Add a row when creating or verifying a canonical feature document.
- Keep search terms aligned with both product language and code terminology.
- Keep primary entry points concise: one route, component, service, or command that starts the feature flow.
- Do not list planning notes, research notes, or unverified feature folders here until they have been checked against source code.
- Take the next unused ID: `ls docs/features/ | grep -oE 'FEAT-[0-9]+' | sort -u | tail -1`. Never reuse or renumber an ID.
