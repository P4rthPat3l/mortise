# Architecture Decision Records

ADRs record the decisions that shape Mortise. Each file is immutable once accepted: to change a decision, write a new ADR that supersedes it and update the old one's status to `Superseded by ADR-NNNN`.

| ID | Title | Status |
| --- | --- | --- |
| ADR-0001 | [Integrate only through public engine interfaces](0001-integrate-only-through-public-engine-interfaces.md) | Accepted (validate in Phase 0) |
| ADR-0002 | [Join the shared service; never replace it unasked](0002-join-the-shared-service-never-replace-it-unasked.md) | Accepted (validate in Phase 0) |
| ADR-0003 | [Engine gateway in the Electron main process](0003-engine-gateway-in-the-electron-main-process.md) | Accepted (validate in Phase 0) |
| ADR-0004 | [Adapter package as the only OpenCode-aware code](0004-adapter-package-as-the-only-opencode-aware-code.md) | Accepted (validate in Phase 0) |
| ADR-0005 | [Electron for the desktop shell](0005-electron-for-the-desktop-shell.md) | Accepted (validate in Phase 0) |
| ADR-0006 | [React for the host UI; framework-neutral extension API](0006-react-for-the-host-ui-framework-neutral-extension-api.md) | Accepted |
| ADR-0007 | [First-party features as modules on an internal SDK](0007-first-party-features-as-modules-on-an-internal-sdk.md) | Accepted (validate in Phase 0) |
| ADR-0008 | [Two APIs: internal module SDK and public extension API](0008-two-apis-internal-module-sdk-and-public-extension-api.md) | Accepted (validate in Phase 0) |
| ADR-0009 | [Staged extension tiers](0009-staged-extension-tiers.md) | Accepted (validate in Phase 0) |
| ADR-0010 | [Client persistence in SQLite in main](0010-client-persistence-in-sqlite-in-main.md) | Accepted (validate in Phase 0) |
| ADR-0011 | [Extensions never hold agent authority](0011-extensions-never-hold-agent-authority.md) | Accepted (validate in Phase 0) |
| ADR-0012 | [Declared engine range with capability detection](0012-declared-engine-range-with-capability-detection.md) | Accepted (validate in Phase 0) |
| ADR-0013 | [Distribution starts as a curated git index you maintain](0013-distribution-starts-as-a-curated-git-index-you-maintain.md) | Accepted |
| ADR-0014 | [Web and mobile reuse the desktop core](0014-web-and-mobile-reuse-the-desktop-core.md) | Accepted (validate in Phase 0) |

## Adding an ADR

1. Copy `TEMPLATE.md` to the next unused number.
2. Its status starts as `Proposed`.
3. Link the research or discussion that motivated it.
4. Add a row to this table in the same change.
5. Never renumber.
