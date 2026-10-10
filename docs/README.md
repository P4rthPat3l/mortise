# Documentation map

Read the one document your task needs. Do not load everything.

| Document | Read it when |
| --- | --- |
| [architecture/overview.md](architecture/overview.md) | You need the layers, module boundaries, state ownership, lifecycles, error handling or versioning. Start with its "Repository mapping" section. |
| [architecture/extension-system.md](architecture/extension-system.md) | You work on extensions, capabilities, sandboxing or distribution. |
| [architecture/roadmap.md](architecture/roadmap.md) | You need phases, the Phase 0 acceptance criteria (P1 to P8), testing strategy or risks. |
| [opencode/engine-contract.md](opencode/engine-contract.md) | You touch the engine in any way. Read "Agent gotchas" first. |
| [adr/README.md](adr/README.md) | You need to know why a decision was made, or you want to change one. |
| [features/_index.md](features/_index.md) | You implement or change a feature. One canonical document per feature. |
| [research/2026-10-10-architecture-research.html](research/2026-10-10-architecture-research.html) | You need the original evidence. It is large; open the section you need. |

## Conventions

- Evidence labels: **[Verified]** read in source, **[Inferred]** reasoned but not executed, **[Recommendation]** proposed design, **[Assumption]** could invalidate the design, **[Open question]** unresolved, **[Decided]** chosen by the maintainer.
- OpenCode facts are pinned to v2.0.25 unless stated. Re-verify against newer releases.
- Feature documents follow `.agents/skills/feature-documentation/SKILL.md`.
