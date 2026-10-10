---
name: feature-documentation
description: Create and maintain one canonical Markdown document per software feature for AI-assisted development. Use before implementing a feature, while planning changes, during implementation, or when documenting an existing feature. Produces a human-readable and AI-readable feature document with user journey, architecture, control flow, data flow, implementation map, contracts, cases, risks, testing, rollout, decisions, and changelog.
---

# Feature Documentation Skill

Create a single, canonical, version-controlled Markdown document that allows both a human engineer and an AI coding agent to quickly understand, implement, modify, test, review, and operate a software feature.

The document is not a replacement for source code, API schemas, tests, tickets, or architecture decision records. It is the feature's navigation and reasoning layer: it explains how those artifacts fit together and links to their authoritative locations.

## Use this skill when

Use this skill when the user asks to:

- design a new feature before implementation;
- create a feature specification or implementation plan;
- document an existing feature;
- understand how a feature works across frontend, backend, database, events, and infrastructure;
- prepare context for an AI coding agent;
- update feature documentation after a code change;
- review whether a feature is documented well enough to implement safely.

Typical requests include:

- "Create a feature doc before we build this."
- "Document how checkout works."
- "Prepare an AI-ready implementation plan for this feature."
- "Update the feature doc after this pull request."
- "Map the data and control flow for this module."

## Canonical format and location

Use Markdown as the maintained source of truth.

Preferred location:

```text
/docs/features/<feature-id>-<feature-slug>.md
```

Example:

```text
/docs/features/FEAT-014-payment-processing.md
```

For a feature with supporting diagrams, schemas, or examples:

```text
/docs/features/payment-processing/
├── README.md
├── assets/
├── examples/
└── schemas/
```

The feature's main document must remain `README.md` or a single predictable `.md` file. HTML or PDF may be generated for publishing, but must not become the manually maintained source of truth.

### Feature IDs

Before assigning an ID, list the existing documents and take the next unused number:

```bash
ls docs/features/ | grep -oE 'FEAT-[0-9]+' | sort -u | tail -1
```

Never reuse or renumber an ID. If two documents collide, the later one moves; stable IDs are referenced from code comments, tickets, and other feature documents.

### Discovery

Feature documents are useless if neither a human nor an agent can find the right one. Maintain both:

1. `docs/features/_index.md` — an index table of every feature document. Use `templates/index.md`. Update it in the same change that creates, renames, or retires a feature document.
2. A pointer in the repository's `AGENTS.md` (or equivalent agent-context file), such as: `Feature documentation lives in docs/features/. Read the relevant feature document before changing a feature.` Add this line if it is missing.

## Operating modes

Determine the mode before writing. Two questions decide it:

| Does the code exist? | Is a change being made? | Mode                                        |
| -------------------- | ----------------------- | ------------------------------------------- |
| No                   | —                       | **A** — pre-implementation design           |
| Yes                  | No                      | **B** — existing-feature documentation      |
| Yes                  | Yes, not yet written    | **C** — change planning                     |
| Yes                  | Yes, already merged     | **D** — post-implementation synchronization |

If the answer to the first question is "partly", the modes combine: document what exists in Mode B, plan the rest in Mode A, and keep the two clearly separated by claim status rather than writing one blended narrative.

### Mode A: Pre-implementation design

Use when the feature does not exist yet or implementation has not started.

Rules:

- Mark the feature as `proposed` or `approved`.
- Label file paths, APIs, tables, events, and flows as `planned`.
- Do not present assumptions as current system behavior.
- Inspect the repository and reuse existing architectural conventions where possible.
- Record open questions and decisions that must be resolved before coding.
- Produce a phased implementation plan with validation at each phase.

### Mode B: Existing-feature documentation

Use when documenting code that already exists.

Rules:

- Inspect the actual implementation before describing it.
- Link to repository-relative source paths.
- Identify entry points, data stores, side effects, failure paths, feature flags, tests, metrics, and integrations.
- Record the commit used for verification: `git rev-parse --short HEAD`. Record it only after inspecting the code, and only if the working tree is clean (`git status --porcelain`); otherwise the commit does not describe what was read.
- Clearly mark anything inferred or unverified.

### Mode C: Change planning

Use when modifying an existing feature.

Rules:

- Separate `Current behavior` from `Proposed change`.
- Include impact analysis and compatibility risks.
- Identify files likely to change without pretending they have already changed.
- Define migration, rollout, rollback, and test requirements.
- After implementation, update the document to reflect the final behavior.

### Mode D: Post-implementation synchronization

Use after a feature or change is implemented.

Rules:

- Compare the document against the final code.
- Replace planned paths and contracts with actual paths and contracts.
- Remove abandoned plans or move them to decisions/changelog.
- Update `last_updated`, `last_verified_commit`, version, diagrams, tests, and changelog.
- Do not mark the document verified unless the relevant code and tests were inspected.

#### Drift check

`last_verified_commit` exists to answer one question: has the code moved since anyone last checked this document? Run this against the paths in the implementation map:

```bash
git log --oneline <last_verified_commit>..HEAD -- <path> <path> ...
```

Non-empty output means the document is presumed stale. Read those commits before trusting or updating any `Current` claim. Run the same check at the start of Mode C, so a change is not planned against a description that no longer holds.

## Core workflow

Follow this sequence.

### 1. Establish the feature boundary

Identify:

- feature name and stable ID;
- user or system problem;
- primary actors;
- trigger and expected outcome;
- included and excluded scope;
- upstream and downstream dependencies;
- whether this is a new feature, existing feature, or proposed change.

A feature should represent one coherent user or system capability. Split the document when multiple capabilities can be independently developed, released, owned, or removed.

### 2. Inspect available evidence

When a repository is available, inspect before drafting:

- repository structure;
- nearby features and naming conventions;
- routing and entry points;
- application/service/domain layers;
- database schemas and migrations;
- APIs and generated schemas;
- queues, events, scheduled jobs, and webhooks;
- tests and fixtures;
- configuration and feature flags;
- observability and deployment files;
- existing product, design, or decision documents.

Prefer authoritative evidence in this order:

1. Executed behavior and tests
2. Source code and schemas
3. Deployment/configuration files
4. Current product or architecture documentation
5. Tickets and discussion notes
6. Inference

Label inference explicitly.

### 3. Create the document from the template

Choose the template by risk, not by ambition:

| Template                       | Use when                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `templates/feature-minimal.md` | Single-surface features, low blast radius, no new contracts or storage, reversible.                                                                                        |
| `templates/feature-full.md`    | New or changed API/event/storage contracts, permissions or tenant boundaries, money, personal data, migrations, multi-service coordination, or anything hard to roll back. |

When in doubt, start minimal. Promoting a minimal document to the full template later is cheap; a full template padded with invented content is worse than no document.

Read `examples/FEAT-014-payment-processing.md` before writing the first document in a repository. It is a completed full-template document at the expected level of detail, and it shows the central discipline in use: a shipped-and-verified charge flow and an unimplemented refund flow coexisting in one document, labeled apart throughout.

Section numbers are stable across both templates and across every feature document in the repository, so `§14` means "Business Rules" everywhere. The minimal template therefore has numbering gaps. This is intended — never renumber sections to close a gap.

#### Placeholders are illustrations, not content

Every row, path, metric, and value in a template is an example showing the expected shape and density. Replace it or delete it.

- A finished document contains no `Example`, `FEAT-XXX`, `YYYY-MM-DD`, `path/to/`, `SymbolName`, or `[link]` strings.
- Do not invent latency targets, error codes, metric names, owners, or risks to fill a table. Unfilled is honest; fabricated is a defect.
- If a section has no real content, delete the section, or keep it with a single `Unknown` line and a matching entry in §28 Open Questions.
- A table with only illustrative rows left in it is an unfilled section. Treat it as one.

Keep the top of the document optimized for a 30-second understanding:

1. one-sentence purpose;
2. feature snapshot;
3. current/planned status;
4. primary user journey;
5. system context diagram;
6. implementation entry points.

Then provide deeper implementation and operational detail.

### 4. Model behavior visually

Use Mermaid diagrams because they are text-based, diffable, readable by AI, and renderable in common repository tools.

Use the correct diagram for the question:

- `flowchart`: control flow and branching;
- `sequenceDiagram`: runtime interactions and data movement;
- `stateDiagram-v2`: lifecycle and legal transitions;
- `erDiagram`: persisted data relationships;
- `journey`: user experience stages.

Every diagram must have a short explanation. A diagram must not be the only source of important information.

### 5. Map implementation artifacts

Create an implementation map containing repository-relative paths and key symbols.

Separate paths by status:

- `Existing`: verified in the repository;
- `Planned`: expected to be created or changed;
- `Generated`: should not be edited manually;
- `Restricted`: requires explicit human/security/infrastructure review.

Do not paste large source files into the feature document. Link to them and explain their responsibility.

### 6. Define behavior as testable rules

Assign stable IDs to important behavior:

- business rules: `BR-001`;
- acceptance criteria: `AC-001`;
- security requirements: `SEC-001`;
- operational requirements: `OPS-001`;
- decisions: `DEC-001`.

Write cases in Given/When/Then form where useful. Cover happy path, alternate paths, authorization, invalid input, concurrency, duplicate requests, dependency failures, retries, cancellation, rollback, and partial success when relevant.

### 7. Create an executable implementation plan

For new work, divide implementation into safe phases. Each phase must include:

- objective;
- expected files or modules;
- behavior introduced;
- tests or validation commands;
- completion criteria;
- rollback or recovery consideration when applicable.

Do not use vague steps such as "implement backend" or "add tests." Name the responsibility and observable outcome.

### 8. Run the documentation quality gate

Use `checklists/quality-gate.md` before finalizing. It has two tiers:

- **Blocking checks** are mechanical — run the commands, do not eyeball them. A failure means the document is not finished. Self-assessment by reading is not a substitute; the checks exist because a document that describes files which do not exist is worse than no document.
- **Review checks** are judgment. Work through them, and state in the completion response which ones the document does not satisfy and why.

Beyond the mechanical checks, the document is ready only when:

- current and planned behavior are clearly separated;
- major flows can be understood without opening source code;
- authoritative source paths are linked;
- important rules are testable;
- failure and security behavior are documented;
- implementation and rollout steps are actionable;
- unknowns are visible rather than silently assumed.

## Required document rules

### Source-of-truth rules

- Markdown is canonical.
- Code remains authoritative for implemented behavior.
- OpenAPI/GraphQL/protobuf/schema files remain authoritative for generated contracts.
- Database migrations and schemas remain authoritative for storage structure.
- Tests remain authoritative for verified examples.
- The feature document explains and links; it does not duplicate entire authoritative artifacts.

### Status rules

There are three independent status axes. Each has a closed vocabulary, and **no value is ever reused across axes** — if a word is not in the list for that axis, it is wrong there.

**Axis 1 — Document lifecycle.** Frontmatter `status`. Where the document sits in its own review process.

`proposed` · `approved` · `active` · `superseded` · `retired`

**Axis 2 — Implementation state.** Frontmatter `implementation_status`. How much of the described feature exists in the codebase.

`not_started` · `in_progress` · `shipped_unverified` · `shipped_verified` · `sunsetting`

**Axis 3 — Claim status.** Used inline and in the `Status` column of tables. How much trust an individual statement has earned. This is the axis that matters most to an agent reading the document.

- `Current` — implemented, and read in the code at `last_verified_commit`;
- `Planned` — approved or proposed, not implemented;
- `Inferred` — consistent with the evidence, not directly verified;
- `Unknown` — unresolved.

Rules:

- Never describe `Planned` or `Inferred` content as `Current`.
- A `Current` claim requires a `last_verified_commit`. Without one, the strongest available label is `Inferred`.
- Axes are independent: a document can be `active` / `in_progress`, with §11 rows split between `Current` and `Planned`. Do not collapse them.
- Deprecation lives on axes 1 and 2 (`superseded`, `retired`, `sunsetting`), never on axis 3. A deprecated-but-working code path is still `Current`; say so and note its removal plan in §26.

### Version semantics

`version` in the frontmatter tracks the documented feature, not the prose:

- **major** — a breaking change to a contract, permission model, or storage structure;
- **minor** — new user-visible behavior, new rules, or new contracts;
- **patch** — corrections, clarifications, and verification updates that do not change described behavior.

### Readability rules

- Put the summary and diagrams before deep details.
- Prefer tables for inventories and comparisons.
- Keep paragraphs short.
- Use stable headings across all feature documents.
- Define domain terms.
- Expand uncommon abbreviations on first use.
- Use meaningful diagram node names.
- Keep diagrams focused; split diagrams that exceed roughly 12-15 nodes.
- Add links from file paths when repository rendering supports them.

### AI-readability rules

- Use predictable headings.
- Use YAML frontmatter.
- Use explicit statuses and stable IDs.
- Avoid implied requirements.
- Record assumptions and confidence.
- Include exact validation commands.
- Identify safe, restricted, and generated modification areas.
- Include the last commit against which the document was verified.
- Keep a machine-readable implementation inventory in Markdown tables.

### Change-control rules

Update the feature document in the same pull request when a change affects:

- user-visible behavior;
- business rules;
- permissions or security;
- API, event, or data contracts;
- control flow or state transitions;
- database structure;
- feature flags or configuration;
- observability or operational procedures;
- implementation ownership or primary file locations.

Do not add changelog entries for spelling-only documentation changes.

## Minimum viable feature document

For small features, do not force every full section. `templates/feature-minimal.md` is exactly this set, with the stable section numbers preserved:

§1 Snapshot · §2 Problem and Outcome · §3 Scope · §6 User Journey · §7 System Context · §8 Control Flow · §9 Data Flow · §11 Implementation Map · §14 Business Rules · §15 Acceptance Criteria · §17 Security and Privacy · §20 Testing · §24 Implementation Plan · §26 Risks · §30 Changelog

Add any further section from the full template by its own number when the feature needs it. For medium or high-risk features, start from the full template instead.

## Scaling guidance

Use one main file per feature, but avoid turning it into a data dump.

Keep in the main file:

- summaries;
- diagrams;
- ownership;
- paths and symbols;
- rules;
- cases;
- contracts at the level needed to reason about the feature;
- risks;
- testing and rollout;
- decisions and changelog.

Link out to:

- full API schemas;
- large JSON examples;
- generated database references;
- test fixtures;
- large runbooks;
- detailed architecture decision records;
- incident reports;
- design assets.

## Output expectations

When creating a new feature document:

1. Allocate the next feature ID and create or propose the canonical Markdown path.
2. Populate the relevant sections using available evidence, and delete the sections and rows you did not fill.
3. Mark unknown and planned content explicitly.
4. Include Mermaid diagrams for primary flows.
5. Provide an implementation plan when the feature is not complete.
6. Add the feature to `docs/features/_index.md`.
7. Validate using the quality gate.
8. Summarize unresolved blockers at the end.

When updating an existing feature document:

1. Run the drift check before trusting any existing `Current` claim.
2. Preserve stable IDs where their meaning has not changed.
3. Update diagrams and implementation maps.
4. Record behaviorally significant changes.
5. Remove stale or contradicted statements.
6. Update verification metadata only after inspection.
7. Update the index row if status, owner, or title changed.

## Completion response

Report:

- the document path created or updated;
- the operating mode used;
- the most important architecture or behavior findings;
- unresolved questions or risks;
- validation performed;
- whether the document reflects planned or verified implementation.
