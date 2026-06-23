# Agent Instructions

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo with `CONTEXT.md` at the repo root. See `docs/agents/domain.md`.

## Frontend data fetching

Use TanStack Query for React async/server-state reads and polling. Avoid hand-rolled `useEffect` fetch loops except for imperative subscriptions or browser APIs that do not fit query semantics.
