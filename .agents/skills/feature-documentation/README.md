# Feature Documentation Skill

A reusable skill for creating one canonical, AI-readable and human-readable Markdown document per software feature.

## Files

- `SKILL.md` — instructions, operating modes, and workflow
- `templates/feature-minimal.md` — low-risk features; ~15 sections
- `templates/feature-full.md` — contracts, storage, permissions, money, personal data; 31 sections
- `templates/index.md` — `docs/features/_index.md` index, so documents can be found
- `examples/FEAT-014-payment-processing.md` — a completed document at the expected density
- `checklists/quality-gate.md` — blocking mechanical checks, then judgment review

## Recommended installation

Copy this directory into the skills directory used by your AI development environment, preserving the structure.

## Recommended invocation

- `Use the feature-documentation skill to design FEAT-014 before implementation.`
- `Use the feature-documentation skill to document the current checkout feature.`
- `Use the feature-documentation skill to plan a change to password reset.`
- `Use the feature-documentation skill to synchronize the feature doc with this pull request.`

## Recommended repository convention

```text
docs/features/
├── _index.md                          # index — keep current
├── FEAT-001-user-authentication.md
├── FEAT-002-password-reset.md
└── FEAT-014-payment-processing.md
```

Add a pointer to `docs/features/` in the repository's `AGENTS.md` so agents find the documents without being told.

## Design principles

1. **Markdown is canonical.** Code, schemas, migrations, and tests remain authoritative for what they define; the document explains how they fit together and links to them.
2. **Never present planned behavior as current.** Three status axes — document lifecycle, implementation state, and per-claim trust — are tracked separately and never share vocabulary.
3. **Placeholders are illustrations.** An unfilled section is honest. A fabricated one is a defect.
4. **Verification is mechanical.** `last_verified_commit` plus a `git log` drift check answers whether the document still describes the code.
