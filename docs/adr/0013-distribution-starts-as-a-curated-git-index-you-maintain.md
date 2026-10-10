# ADR-0013: Distribution starts as a curated git index you maintain

- **Status:** Accepted
- **Date:** 2026-10-10
- **Source:** [Architecture research §12](../research/2026-10-10-architecture-research.html)

## Context
A hosted registry needs accounts, signing, scanning and abuse handling. None of that pays off before there are real publishers.

## Decision
A public git repository of index entries (id, versions, download URL, SHA-256, publisher, declared capabilities). Entries arrive by pull request and you review them against written rules. The client reads the index and can hide a yanked version remotely.

## Alternatives considered
npm as the registry. A hosted registry from day one. Open VSX.

## Consequences
Review work scales with submissions. Moving to a hosted registry later keeps the same index format.
