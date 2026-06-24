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

## Frontend theming

Use Tailwind v4 theme tokens for design-system colors, shadows, animations, and typography. Do not put raw hex/rgb values in JSX class names (for example `bg-[#123456]`); add a semantic token in `ui/src/styles.css` first, then use token utilities such as `bg-watch-bg`, `text-watch-ink`, or `border-watch-line`.
