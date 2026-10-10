# Roadmap, prototype and risks

## Phases

| Phase | Goal | Scope | Exit criteria |
| --- | --- | --- | --- |
| **0 Validate** | Settle the irreversible decisions | The walking skeleton from section 9 | P1 to P7 pass; ADRs confirmed or revised |
| **1 Minimal client** | A daily-drivable client | Connection management, session list, timeline, composer, permissions and forms, review and diff, terminal, settings, command palette, keybindings, built-in themes, diagnostics. All of it as first-party modules. | Used daily by the team; contract tests on two engine versions; no forbidden imports |
| **2 Customization** | Declarative tier goes public | User themes and VS Code import, keybindings, layouts, settings, prompt templates, tool renderers; local install of declarative packages; safe mode | Ten or more community-style declarative packages built by you; schemas versioned and documented |
| **3 Sandboxed extensions** | Public API v1 preview | Views, background logic, commands, actions, status items, storage, capability approval, developer mode, test harness, docs and samples, API report | Five sample extensions; security suite green; API frozen for v1 |
| **4 Agent integrations** | Extensions with an engine half | Companion engine plugin pattern over plugin RPC, host-held integration credentials, network capability, workflow automation built from commands and session events (with `prompt:send` confirmation) | One integration end to end, such as an issue tracker with an MCP or plugin tool plus a panel |
| **5 Ecosystem** | Distribution at scale | Curated index, then registry; signing; update channels; rollback UI; publisher verification; yank; optional T2 and T3 for verified publishers | Third-party publishers shipping updates without your help |
| **W Web, then mobile** | Same product on more surfaces | A `gateway-server` host with its own login, the web build of the same React UI, extension assets on a separate origin, then a Capacitor mobile shell. Runs as a parallel track once Phase 1 is stable. | The desktop's contract and end-to-end suites pass through the server host; security review of remote access done |

**[Recommendation]** Review two decisions at every phase boundary. Has upstream shipped third-party GUI extensions (A7)? Has the engine API changed shape (A1)? Either one can change the plan.

## Testing strategy

| Level | What it proves | How |
| --- | --- | --- |
| Unit | Pure logic is correct | Adapter projections and event translation, reducers, keybinding resolution, settings layering, manifest validation, capability decisions |
| Adapter contract | The adapter matches each supported engine version | Golden fixtures of real responses and event streams per version; validate every request the adapter can build against that version's `openapi.json` |
| Engine integration | Real engine behavior: admission, streaming, permissions, resync | Spawn pinned `opencode` binaries with temporary XDG directories and `OPENCODE_DB`; or run `@opencode/sdk` in-process with an in-memory database; drive deterministic turns with `@opencode/simulation`'s simulated provider (API to confirm) |
| Resilience | Correctness under the stream's failure modes | Kill the engine mid-turn, drop the network, throttle the consumer until the 4,096-event queue overflows, replace the registration with another version |
| End to end | Critical desktop workflows | Playwright's Electron support: connect, create session, prompt, approve permission, reconnect, install, enable and disable an extension, safe mode |
| Extension API compatibility | Public API changes are intentional | API Extractor report in review; type tests; a corpus of sample extensions run on every release; boot with each optional provider disabled, like upstream's graph matrix |
| Security | Capabilities hold | Denied calls fail with `NOT_GRANTED`; frames cannot fetch, navigate or reach the parent; spoofed postMessage sources are rejected; archive traversal and size limits; storage quotas |
| Engine upgrade regression | New releases do not break you silently | Nightly matrix of floor, latest release and upstream `v2` HEAD; diff `openapi.json` and the event manifest between tags (the method used in 2.10) and alert on removals |
| Extension development | Authors can test without the full app | A headless host harness implementing `@mortise/extension-api` with fixtures, plus developer mode with hot reload in the app |

## Phase 0 prototype acceptance criteria

**[Recommendation]** Build a walking skeleton that settles the decisions that are hardest to reverse, before any product work. It passes when every item below holds.

- **P1 Coexistence.** With the official desktop running, the prototype joins the shared service without replacing it, and survives the official app replacing the service.
- **P2 Resync.** A forced queue overflow and a killed engine both end with a timeline identical to a fresh load.
- **P3 Transport.** The typed client in the renderer works through the IPC-backed fetch. The password is absent from renderer memory, and two windows share one upstream stream.
- **P4 Adapter.** One session timeline renders from snapshot plus deltas. A prompt retried with the same `msg_` id is admitted once.
- **P5 Module boundary.** Two first-party modules communicate through a contract. Lint rejects a forbidden import.
- **P6 Sandbox.** One third-party view, one command and one declarative tool renderer work. A denied capability fails cleanly. RPC latency, per-frame memory and process placement are measured.
- **P7 Versions.** The same build passes contract tests against OpenCode 2.0.20 and 2.0.26.
- **P8 Portability.** `@mortise/gateway-core` passes its tests under plain Node with no Electron, and one React view renders a live session timeline without dropping frames while tokens stream.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Upstream opens the official desktop to third-party GUI extensions, competing with your ecosystem (A7) | Medium | High | Watch `packages/desktop/src/main/extension`; differentiate on safety and customization; keep manifest concepts close enough to port |
| Engine API churn returns (a 2.1 or 3.0 redesign) | Medium | High | Adapter, capability flags, nightly matrix, declared range |
| Event loss produces wrong state | Medium | High | Snapshot-first design, resync on every reconnect, durable sequence gap checks, resilience tests |
| Version war with official clients over the shared service | Medium | Medium | Join-never-replace policy; explicit consent to restart |
| Two engines on one database (if isolation is skipped) | Low with policy | High | C4; isolated mode always sets `OPENCODE_DB` |
| Effect 4 release-candidate churn through `@opencode/schema` | Medium | Medium | Use only the Promise client root; keep Effect out of your public API |
| Iframe isolation weaker than assumed (A5) | Low | High | Measure in P6; `WebContentsView` fallback |
| Public API too thin to attract authors (A6) | Medium | Medium | Build first-party features on the module system so missing contribution points surface early; add a T2 tier for vetted publishers |
| Malicious or compromised extension | Medium once popular | High | Capabilities, hashes, re-approval, signing, curated index, safe mode, kill switch in the index |
| Release cadence outpaces your testing (27 releases in 27 days) | High | Medium | Untested state instead of blocking; automated nightly matrix |
| Users run an OpenCode version outside your range, since you do not bundle one | High | Medium | Clear version screen with update steps; capability flags instead of a hard block where safe |
| React re-renders make streaming janky | Medium | Medium | External store with selectors, frame batching, virtualization (6.11); measured in P8 |
| A later web host exposes agent control over the network | Medium | High | Loopback by default, server-side login, engine password never sent to browsers, security review before shipping web |

## Decisions

| Question | Decision | What it changes |
| --- | --- | --- |
| Desktop only, or also web and mobile? | **[Decided]** Desktop first, web and mobile after it works | Host-neutral gateway core from day one (C11, 6.10); web and mobile as a later roadmap track |
| Bundle OpenCode, or require an install? | **[Decided]** Users install it | A supported range instead of one pinned version; detection and update guidance (8.6) |
| Host UI framework | **[Decided]** React | No reuse of `@opencode/ui`; explicit lifetimes and streaming patterns (6.6, 6.11); ADR-006 |
| Who runs the registry | **[Decided]**, on recommendation. A curated git index you maintain, then a hosted registry if the ecosystem grows | ADR-013; review rules written before the index opens |
| Companion engine plugin installs | **[Decided]** Show the config line, verify with `GET /api/plugin` | No writes to engine config (7.12) |
| Contribute upstream? | **[Decided]**, on recommendation. Open issues for the four asks in 8.8; never block on them | Each improvement adopted behind a capability flag |
| Product name and branding | **[Recommendation]** Mortise, alternate Binnacle | Section 13; formal trademark and domain checks still needed |
