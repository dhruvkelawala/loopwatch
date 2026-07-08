# Loopwatch

Loopwatch is a local, passive companion for AI coding agents that helps your sessions **converge** on what you actually wanted.

It does three things in service of one goal — help you **start** each session as the right *loop* (a reusable, self-verifying workflow with a clear stop condition), **watch** whether the session is actually closing that loop, and **coach** you to work better over time. It observes existing local sessions across Pi, Codex, and Claude Code and presents evidence-backed nudges. Loopwatch does not control, launch, pause, stop, resume, or steer agents — it makes *you* a sharper operator of them. (Agent control is deferred as a possible future enhancement, not pursued in v1.)

## Product Thesis

AI coding agents rarely fail by getting obviously stuck. More often, they keep making plausible progress while drifting from the user's intent, spending time without stronger evidence, expanding scope, or validating too weakly.

Loopwatch asks:

> Is this agent session still converging on the user's intended outcome?

A *loop* is the positive template of a healthy session: a structured workflow with an explicit stop condition, so the agent knows when its work is genuinely done. Loopwatch helps you start sessions as well-formed loops, measures convergence against the loop's stop condition (or an inferred goal when no loop is in play), and warns you when a session stops closing.

## The three loops

Loopwatch runs the same watch → reflect → suggest loop, pointed at three different subjects:

- **The agent** → *Intervention cards*: "this session may be drifting, burning, or validating too weakly."
- **You** → *Coaching cards*: the right loop for the task, a better prompt, or a session habit (e.g. start fresh after a Pivot).
- **Loopwatch itself** → *Upgrade cards*: its own blind spots (missing cost data, unparsed events, alerts you keep dismissing).

## Core Ideas

- Multi-source from day one: Pi, Codex, and Claude Code.
- Passive observation of existing sessions (control deferred, not pursued in v1).
- Loops as a first-class primitive: a library of reusable, self-verifying workflows.
- Convergence detection — drift, burn, weak validation, churn, scope creep — judged by an LLM over a maintained running summary, with deterministic signals as evidence.
- Loop-anchored convergence: when a known loop is running, measure against its stop condition.
- Source capability badges instead of fake parity.
- Normalized event stream across agents on Flue's durable log.
- Layered, severity-aware UX: ambient Pulse → OS notification → full Cockpit.
- Dedicated Loopwatch Upgrades inbox for self-improvement suggestions.
- Local-first raw storage with structured evidence packets for synthesis.

## Non-goals

- Agent control or orchestration in v1 (deferred as an optional future enhancement — see [ADR-0001](docs/adr/0001-observation-model.md)).
- Launching sessions from Loopwatch.
- PR review replacement.
- Cloud/team dashboard.
- Autonomous edits or PR creation (including to Loopwatch itself — upgrades are propose-only).
- Broad repo-wide docs-drift intelligence (the git watcher is scoped to active sessions).
- Benchmark leaderboard for which agent is "best."

## Current Context

The PRD is the canonical product context, backed by the architecture decisions in `docs/adr/`:

- [PRD.md](./PRD.md) — v1 product requirements
- [CONTEXT.md](./CONTEXT.md) — glossary / ubiquitous language
- [docs/adr/](./docs/adr/) — architecture decision records (0001–0011)
- [loopwatch-handoff-2026-06-18.md](./loopwatch-handoff-2026-06-18.md) — earlier discussion handoff

## Development

Loopwatch's first walking-skeleton slice is a local Flue Node app with file-backed SQLite persistence, per [ADR-0007](./docs/adr/0007-deployment-shape-flue-node-engine-tauri-shell.md).

Install dependencies:

```sh
pnpm install
```

Build the local Node target:

```sh
pnpm build
```

### Codex subscription OAuth dogfood

Loopwatch can optionally register Flue's `openai-codex` provider through `flue-codex-oauth`. Until that package is published to npm, this repo depends on the GitHub release tarball vendored at `vendor/flue-codex-oauth-0.0.1.tgz` from `https://github.com/dhruvkelawala/flue-codex-oauth/releases/tag/v0.0.1`.

Create the local auth file once:

```sh
pnpm exec flue-codex-login --auth-path ~/.flue/openai-codex.json
```

By default, Loopwatch auto-enables the provider only when that auth file exists. Force it on or off with `LOOPWATCH_CODEX_OAUTH=1` / `LOOPWATCH_CODEX_OAUTH=0`, and override the file path with `FLUE_CODEX_AUTH_PATH`. The app exposes a same-engine-boundary status endpoint at `/loopwatch/codex-auth`; it reports checks/status only, never token material.

Run the deterministic integration proof:

```sh
pnpm codex:oauth:check
```

Run the persistence proof:

```sh
pnpm persistence:check
```

That command builds the Flue server, starts it, writes a `record-event` workflow run carrying a normalized Loopwatch Event, stops the process, restarts it, and reads the same run metadata/events back from `data/flue-v4.db`. Passing output proves `src/db.ts` is using file-backed `sqlite()` rather than the Node target's default in-memory database, and that the normalized event survives restart with every unrecognized field intact. Override the SQLite path with `LOOPWATCH_FLUE_DB_PATH`; the versioned default keeps older `data/flue.db` files untouched after the Flue beta.9 schema bump.

### Normalized events

The shared event language is defined in [`src/events.ts`](./src/events.ts), per [ADR-0004](./docs/adr/0004-normalized-event-shared-core-plus-extras.md). Every Loopwatch Event carries a small common core — `source`, `sessionId`, `timestamp`, `kind`, and `actor` (`user` / `agent` / `tool` / `system`) — plus per-event `context` labels (cwd / gitBranch) and a flexible source-specific payload. Session identity is the pair `(source, sessionId)` ([ADR-0003](./docs/adr/0003-session-identity-follows-the-source.md)); repo/branch are derived context, never identity. Adapters never drop data they don't recognize: unknown fields and unknown kinds are preserved verbatim (the schema uses Zod's `looseObject`), and missing common-core data is rejected rather than faked.

The `record-event` (single) and `record-events` (batch) workflows are the ingest boundary: they validate the common core, preserve all extras, and persist each event onto Flue's Durable Streams log for the run via a structured `log` event.

Check the model in isolation (no server required):

```sh
pnpm events:check
```

### Source Adapters (Claude · Codex · Pi)

Every adapter shares one tail seam ([`src/adapters/core/`](./src/adapters/core/), [ADR-0003](./docs/adr/0003-session-identity-follows-the-source.md) / [ADR-0009](./docs/adr/0009-session-liveness-and-freshness-risk.md)): it tails a source's on-disk JSONL sessions, maps each record to a normalized event ([ADR-0004](./docs/adr/0004-normalized-event-shared-core-plus-extras.md)), and batch-ingests them. It keeps an idempotent per-file cursor (path · inode · byte offset · last id · parser version) so a restart resumes without re-emitting, tolerates partial trailing lines and rotation, and tracks liveness (`active → idle → ended`) on configurable thresholds. Each adapter supplies only its differences — its record→event mapping, filename→session-id rule, and **declared capabilities** (no fake parity):

- **Claude** ([`src/adapters/claude/`](./src/adapters/claude/)) — `~/.claude/projects/**/*.jsonl`; per-record `cwd` + `gitBranch`. Capabilities: transcript, tools.
- **Codex** ([`src/adapters/codex/`](./src/adapters/codex/)) — `~/.codex/sessions/**/rollout-*.jsonl`; `{ type, payload, timestamp }` envelope; cwd + git from the head `session_meta`. Capabilities: transcript, tools, tokens.
- **Pi** ([`src/adapters/pi/`](./src/adapters/pi/)) — `~/.pi/agent/sessions/**/*.jsonl`; typed records with a direct `$` cost (`usage.cost.total`) but no in-transcript branch — repo + branch are inferred from git ([ADR-0008](./docs/adr/0008-git-watcher-scoped-to-active-sessions.md)). Capabilities: transcript, tools, tokens, cost, diagnostics.

Missing data renders as **unavailable** in the Cockpit, never blank or faked. Run an adapter against the live server (start `pnpm dev` first):

```sh
pnpm adapter:claude   # or: pnpm adapter:codex · pnpm adapter:pi
```

Checks:

```sh
pnpm adapter:check        # Claude: mapping, identity/context, cursor idempotency, live append, liveness
pnpm codex:check          # Codex: envelope mapping, filename identity, no-drop, idempotent cursor
pnpm pi:check             # Pi: typed mapping, cost no-drop, git-inferred repo/branch, idempotent cursor
pnpm cockpit:caps:check   # Cockpit: honest capability badges + tokens/cost, "unavailable" never faked
pnpm ingest:check         # integration: adapter → record-events → durable store, live append without restart
```

### Cockpit (desktop shell)

The Cockpit is the Watchtower UI ([`ui/`](./ui/)) hosted inside a Tauri desktop shell ([`src-tauri/`](./src-tauri/)), per [ADR-0007](./docs/adr/0007-deployment-shape-flue-node-engine-tauri-shell.md). The shell owns the background observation processes: on launch it generates a per-run engine bearer token, spawns `node dist/server.mjs` (the built engine) plus a single supervised Source Adapters child (`node dist/adapter-sources.mjs`, hosting the Claude, Codex, and Pi adapters), and on quit it stops every child. Disable one source with `LOOPWATCH_{CLAUDE,CODEX,PI}_ADAPTER=0` (handled inside the adapters child), or the whole child with `LOOPWATCH_SOURCE_ADAPTERS=0`.

Run the Slice 5 live Cockpit proof (fixture Claude transcript → adapter → Flue runs → Cockpit projection):

```sh
pnpm cockpit:check
```

Run the web UI on its own against a separately-running engine (`pnpm dev` in another shell):

```sh
pnpm ui:dev          # Vite dev server on http://127.0.0.1:1420, proxies /api → engine
```

Run the full desktop app (builds the engine, Claude adapter, and UI, then launches the shell):

```sh
pnpm tauri:dev       # spawns the engine, opens the Cockpit window
pnpm tauri:build     # compiles the release shell (bundling is disabled in v1)
```

Lifecycle on macOS:

- **Closing the Cockpit window hides it** — the app stays running and the Flue engine keeps observing sessions in the background.
- **Clicking the dock icon reopens** the hidden Cockpit window.
- **Quitting (Cmd+Q) stops the Flue engine** before the process exits.

Environment overrides for supervised children:

- `LOOPWATCH_NODE_BIN` — Node binary used to run the engine and the source adapters (default `node`).
- `LOOPWATCH_SOURCE_ADAPTERS=0` — disable all source-adapter supervision for diagnostics.
- `LOOPWATCH_CLAUDE_ADAPTER=0` / `LOOPWATCH_CODEX_ADAPTER=0` / `LOOPWATCH_PI_ADAPTER=0` — disable a single source.
- `LOOPWATCH_ENGINE_PORT` / `LOOPWATCH_ENGINE_TOKEN` — pin the engine port/token instead of the launch defaults.

In dev the engine listens on `3583`; release launches reserve an ephemeral loopback port. The webview learns the engine base URL and bearer token from `window.__LOOPWATCH_ENGINE_CONFIG__`, injected by the shell before the page loads.
