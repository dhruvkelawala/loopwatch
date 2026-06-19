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
