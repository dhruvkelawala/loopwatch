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

Run the persistence proof:

```sh
pnpm persistence:check
```

That command builds the Flue server, starts it, writes a `record-event` workflow run carrying a normalized Loopwatch Event, stops the process, restarts it, and reads the same run metadata/events back from `data/flue.db`. Passing output proves `src/db.ts` is using file-backed `sqlite()` rather than the Node target's default in-memory database, and that the normalized event survives restart with every unrecognized field intact.

### Normalized events

The shared event language is defined in [`src/events.ts`](./src/events.ts), per [ADR-0004](./docs/adr/0004-normalized-event-shared-core-plus-extras.md). Every Loopwatch Event carries a small common core — `source`, `sessionId`, `timestamp`, `kind`, and `actor` (`user` / `agent` / `tool` / `system`) — plus per-event `context` labels (cwd / gitBranch) and a flexible source-specific payload. Session identity is the pair `(source, sessionId)` ([ADR-0003](./docs/adr/0003-session-identity-follows-the-source.md)); repo/branch are derived context, never identity. Adapters never drop data they don't recognize: unknown fields and unknown kinds are preserved verbatim (the schema uses Zod's `looseObject`), and missing common-core data is rejected rather than faked.

The `record-event` (single) and `record-events` (batch) workflows are the ingest boundary: they validate the common core, preserve all extras, and persist each event onto Flue's Durable Streams log for the run via a structured `log` event.

Check the model in isolation (no server required):

```sh
pnpm events:check
```

### Claude Source Adapter

The first Source Adapter ([`src/adapters/claude/`](./src/adapters/claude/), [ADR-0003](./docs/adr/0003-session-identity-follows-the-source.md) / [ADR-0009](./docs/adr/0009-session-liveness-and-freshness-risk.md)) tails Claude Code transcripts (`~/.claude/projects/**/*.jsonl`), maps each record to a normalized event, and batch-ingests them into the store. It keeps an idempotent per-transcript cursor (path · inode · byte offset · last uuid · parser version) so a restart resumes without re-emitting, tolerates partial trailing lines and rotation, and tracks liveness (`active → idle → ended`) on configurable thresholds.

Run it against the live server (start `pnpm dev` first):

```sh
pnpm adapter:claude
```

Checks:

```sh
pnpm adapter:check   # pure: mapping, identity/context, cursor idempotency, live append, liveness (no server)
pnpm ingest:check    # integration: adapter → record-events → durable store, live append without restart
```

### Cockpit (desktop shell)

The Cockpit is the Watchtower UI ([`ui/`](./ui/)) hosted inside a Tauri desktop shell ([`src-tauri/`](./src-tauri/)), per [ADR-0007](./docs/adr/0007-deployment-shape-flue-node-engine-tauri-shell.md). The shell owns the Flue engine: on launch it spawns `node dist/server.mjs` (the built engine) as a child process on port `3583`, and on quit it stops that child.

Run the web UI on its own against a separately-running engine (`pnpm dev` in another shell):

```sh
pnpm ui:dev          # Vite dev server on http://127.0.0.1:1420, proxies /api → engine
```

Run the full desktop app (builds the engine + UI, then launches the shell):

```sh
pnpm tauri:dev       # spawns the engine, opens the Cockpit window
pnpm tauri:build     # compiles the release shell (bundling is disabled in v1)
```

Lifecycle on macOS:

- **Closing the Cockpit window hides it** — the app stays running and the Flue engine keeps observing sessions in the background.
- **Clicking the dock icon reopens** the hidden Cockpit window.
- **Quitting (Cmd+Q) stops the Flue engine** before the process exits.

Environment override for the engine child:

- `LOOPWATCH_NODE_BIN` — Node binary used to run the engine (default `node`).

The engine port is fixed at `3583`; the packaged webview's base URL and the CSP `connect-src` are pinned to it.
