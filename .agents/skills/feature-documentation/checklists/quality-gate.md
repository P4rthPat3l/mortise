# Feature Document Quality Gate

Two tiers. Run tier 1; read tier 2.

---

# Tier 1 — Blocking checks (mechanical)

Run these. Do not assess them by reading — the point of this tier is that it does not depend on the judgment of whoever wrote the document. Any failure means the document is not finished.

Set `DOC` to the document path before running.

### B1. No placeholders survive

```bash
grep -nE 'FEAT-XXX|YYYY-MM-DD|path/to/|SymbolName|\[link\]|Example (measure|target|risk|responsibility)|Team or [Pp]erson|Domain term' "$DOC"
```

Must return nothing. Every hit is either an unfilled section that should be deleted or a row that should carry real content.

### B2. Every `Current` path exists

For each repository path in §11 Existing Artifacts:

```bash
test -e "<path>" || echo "MISSING: <path>"
```

A path that does not exist is either wrong, or `Planned` and in the wrong table. A document that points an agent at files which are not there is worse than no document.

### B3. The verification commit resolves

```bash
git cat-file -e "<last_verified_commit>^{commit}" || echo "BAD COMMIT"
```

Must pass whenever the document contains any `Current` claim. If `last_verified_commit` is `null`, no claim in the document may be labeled `Current`.

### B4. The document is not already stale

```bash
git log --oneline "<last_verified_commit>..HEAD" -- <every path in §11>
```

Empty output, or the listed commits were read and the document reflects them.

### B5. Validation commands are real

Every command in §20 exists in this repository — check `package.json` scripts, `Makefile`, `justfile`, or equivalent. Invented commands cause an agent to report a fabricated pass.

### B6. Rules and criteria are traceable

Every `BR-###`, `AC-###`, and `SEC-###` either names a test path that exists, or is explicitly marked as untested. Silence reads as covered.

### B7. Diagrams are complete and explained

Every fenced `mermaid` block is non-empty, declares a diagram type on its first line, and is followed by explanatory prose. No diagram is the only place important information appears.

### B8. Status vocabulary is clean

Every `Status` value comes from the axis-3 vocabulary (`Current` · `Planned` · `Inferred` · `Unknown`); frontmatter `status` and `implementation_status` come from axes 1 and 2. No value appears on an axis it does not belong to.

### B9. The feature is discoverable

The feature appears in `docs/features/_index.md`, and the repository's agent-context file points at `docs/features/`.

---

# Tier 2 — Review checks (judgment)

Work through these. Report which ones the document does not satisfy, rather than silently ticking them.

## Identity and status

- [ ] Feature has a stable ID and predictable file path.
- [ ] Owner and implementation status are present.
- [ ] Current, planned, inferred, and unknown content are distinguishable at a glance.
- [ ] Verification metadata is present only where code was actually inspected.

## Fast comprehension

- [ ] A reader can understand the purpose in one sentence.
- [ ] The feature snapshot identifies actors, trigger, outcome, entry points, stores, and integrations.
- [ ] The primary journey is understandable in approximately 30 seconds.
- [ ] Domain terminology is defined.

## Scope and behavior

- [ ] Included and excluded scope are explicit.
- [ ] Primary and alternate journeys are described.
- [ ] Business rules have stable IDs.
- [ ] Acceptance criteria are testable as written — a reader could write the test from the text alone.
- [ ] Edge cases cover the relevant subset of authorization, duplicates, concurrency, timeouts, retries, cancellation, and partial failure.

## Architecture and flows

- [ ] System context is shown.
- [ ] Control flow identifies decision owners and failure branches.
- [ ] Data flow identifies inputs, transformations, storage, outputs, and sensitive data.
- [ ] State transitions are documented when the feature has a lifecycle.
- [ ] Diagrams are focused rather than exhaustive.

## Implementation map

- [ ] Main symbols and responsibilities are listed, not just file paths.
- [ ] Generated and restricted areas are identified.
- [ ] Large source artifacts are linked rather than duplicated.

## Contracts and storage

- [ ] APIs, events, and external integrations are described.
- [ ] Compatibility and versioning concerns are documented.
- [ ] Data model, ownership, retention, and deletion are covered.
- [ ] Caching and invalidation are covered when relevant.

## Security, privacy, and operations

- [ ] Authentication and authorization enforcement points are clear.
- [ ] Tenant isolation and ownership rules are covered when relevant.
- [ ] Sensitive logging restrictions are documented.
- [ ] Rate limiting, abuse prevention, and secret handling are considered.
- [ ] Logs, metrics, alerts, and runbooks are identified.
- [ ] Performance, idempotency, retry, and timeout requirements are defined — and are real targets, not invented numbers.

## Implementation and release

- [ ] Implementation phases have concrete, observable outcomes.
- [ ] Expected files are identified without being represented as already implemented.
- [ ] Deployment order is safe.
- [ ] Migration, rollout, and rollback are documented.
- [ ] Risks, assumptions, and open questions are visible.

## Maintenance

- [ ] The changelog contains only meaningful changes.
- [ ] Significant decisions are recorded or linked.
- [ ] The document is expected to change in the same pull request as behavior.
- [ ] AI-agent safe and restricted modification areas are included.
- [ ] No statement presents an unverified assumption as fact.
