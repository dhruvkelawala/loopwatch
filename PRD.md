# Loopwatch — Product Requirements (v1)

Status: **Draft for build** · Date: 2026-06-19 · Owner: dhruvrk2000

This PRD is the synthesis of the design grill captured in `docs/adr/0001`–`0011`, the glossary in [CONTEXT.md](./CONTEXT.md), and the Flue + session-data research. Where a decision has a record, the ADR is cited as the source of truth.

---

## 1. Summary

**Loopwatch is a local, passive companion for AI coding agents that helps your sessions *converge* on what you actually wanted.**

It does three things in service of one goal:

- **Start right** — recommend the right **Loop** (a reusable, self-verifying workflow with a clear stop condition) for the task.
- **Watch it close** — measure each live session against its goal (the loop's stop condition, or an inferred intent) and surface evidence-backed nudges when it drifts, burns, or sprawls.
- **Get better** — coach you over time (better loops, prompts, session habits), and improve itself.

It watches existing **Pi, Codex, and Claude Code** sessions; it never controls them.

**North-star question:** *Is this session converging on its goal — and if not, what should I do?*

## 2. Problem

AI coding agents rarely fail by getting obviously stuck. They keep making plausible progress while **drifting** from intent, **burning** time/tokens without stronger evidence, **sprawling** in scope, or **validating too weakly** — and they often report "done" before the evidence supports it. The operator (you) can't watch every session closely; by the time you look, the time is spent. Loopwatch is the operator's layer: it tells you *when to look* and *what would help*.

## 3. Goals & non-goals

**Goals**
- Multi-source from day one (Pi · Codex · Claude Code), passively.
- Detect non-convergence in time to matter, with evidence ("receipts").
- Make loops first-class: recommend them, and measure sessions against them.
- Coach the user's workflow, not just police the agent.
- Local-first and cost-bounded.

**Non-goals** (see README for the full list)
- Controlling/launching/pausing/steering agents — **deferred, not pursued in v1** ([ADR-0001](docs/adr/0001-observation-model.md)).
- Autonomous edits/PRs, including to Loopwatch itself (upgrades are propose-only — [ADR-0005](docs/adr/0005-self-improvement-is-propose-only.md)).
- Repo-wide docs-drift intelligence (git watcher is scoped — [ADR-0008](docs/adr/0008-git-watcher-scoped-to-active-sessions.md)).
- PR-review replacement, cloud/team dashboard, "best agent" leaderboard.

## 4. Success metrics

- **Primary:** share of watched sessions that converge / land on the first pass (self-reported + heuristic).
- Time-to-awareness: how early Loopwatch flags a real drift vs when the user would have noticed.
- Signal quality: intervention dismissal rate (proxy for false positives).
- Coaching uptake: loops recommended → adopted.
- Cost legibility: LLM spend per active session stays within the user's configured cap.

## 5. The three loops (product surfaces)

Loopwatch runs the same **watch → reflect → suggest** loop pointed at three subjects, each with its own card type:

| Loop | Subject | Card | Horizon | Surface |
|------|---------|------|---------|---------|
| Convergence | the **agent** | **Intervention card** | now | floating, interruptive |
| Coaching | **you** | **Coaching card** | next time | reflective |
| Self-improvement | **Loopwatch** | **Upgrade card** | reflective | Upgrades inbox |

## 6. UX — layered by severity ([ADR-0007](docs/adr/0007-deployment-shape-flue-node-engine-tauri-shell.md))

Verdict of the [intervention-UX prototype](prototype/NOTES.md): **layered**, escalating with severity.

1. **Pulse** — always-present menu-bar/tray indicator: aggregate convergence state ("5 · ⚠1"). The calm layer.
2. **OS notification** — fires when a session needs you, *even when the Cockpit window is closed*.
3. **Cockpit** — the dense, on-demand investigation window: **Session rail** (sessions grouped by repo, with capability badges + convergence status) · **Session timeline** (lanes: request / tools / files / git / validation / convergence) · **Evidence inspector** (the receipts behind any card). Opening/closing it does not stop observation.

Behaviour: every card is evidence-backed and dismissable; dismissals are remembered in-session ([ADR-0002](docs/adr/0002-convergence-detection-architecture.md) feedback); the Pivot nudge is togglable (default calm); no card without a recommended action.

## 7. Architecture ([ADR-0007](docs/adr/0007-deployment-shape-flue-node-engine-tauri-shell.md))

```
Source adapters (read-only)        Loopwatch engine = local Flue Node app
  Pi    ~/.pi/agent/sessions/*.jsonl  ─┐
  Codex ~/.codex/sessions/*.jsonl     ─┼─► normalize ─► Durable Streams (file-backed SQLite, local)
  Claude ~/.claude/projects/*.jsonl   ─┘        │
  Git watcher (active-session repos) ──────────┘        ▼
                                          per-session watcher (agent/workflow)
                                          = LLM judge over running summary
                                                 │  @flue/sdk (HTTP + Durable Streams, :3583)
                                                 ▼
                                One React app (@flue/react) → Pulse · notification · Cockpit
                                                 │
                                   thin Tauri shell: window + native tray + OS notifications
                                   + supervises the Flue Node engine
```

Key facts (from research, all verified):
- Flue is **headless**, runs locally on **Node** (chosen over Cloudflare for local-first — [ADR-0006](docs/adr/0006-local-first-structured-evidence-packets.md)); its append-only **Durable Streams** log is the event substrate.
- Node persistence defaults to **in-memory** → must configure the **file-backed `sqlite()` adapter** or data is lost on restart.
- `@flue/react` replays the full bounded stream on mount → the Cockpit back-fills a running session's timeline for free.

## 8. Core concepts

Full glossary in [CONTEXT.md](./CONTEXT.md). Key terms: **Source**, **Source Adapter**, **Capability**, **Agent Session** (identity = the source's own session — [ADR-0003](docs/adr/0003-session-identity-follows-the-source.md)), **Loopwatch Event** (shared core + source extras, unknowns preserved — [ADR-0004](docs/adr/0004-normalized-event-shared-core-plus-extras.md)), **Convergence Detection / Signal**, **Pivot**, **Loop / Loop Library**, **Intervention / Coaching / Upgrade Card**, **Cockpit**, **Pulse**, **Evidence Packet**.

### Per-source capability reality (measured)

| | Codex | Claude Code | Pi |
|---|---|---|---|
| Shape | envelope `{type,payload,timestamp}` | rich flat records | typed events |
| Tokens | nested in payload | ✓ tokens | ✓ tokens **+ $ cost** |
| Repo/branch | in payload | ✓ `cwd`+`gitBranch` per event | session-level `cwd`, **no branch** |

Asymmetry is exposed honestly via capability badges ([ADR-0004](docs/adr/0004-normalized-event-shared-core-plus-extras.md)); gaps feed the self-improvement loop.

## 9. Convergence engine ([ADR-0002](docs/adr/0002-convergence-detection-architecture.md), [-0009](docs/adr/0009-session-liveness-and-freshness-risk.md), [-0010](docs/adr/0010-loop-anchored-convergence-watches-agent-evidence.md), [-0011](docs/adr/0011-judge-cadence-and-cost-control.md))

- **LLM judge, not rules.** Drift is semantic. Deterministic signals (token burn, files changed, test pass/fail, repeated commands) are fed to the judge as **evidence**, never used as the decision.
- **Running summary, not re-read.** A per-session watcher maintains compact state (goal · done · validation · concerns), updated per meaningful event; raw events stay local for zoom-in.
- **Cadence & cost.** Event-driven + per-session rate cap; cheap model maintains summary + emits concern flag → strong model on concern-or-hard-signal; liveness gates spend; live spend meter.
- **Loop-anchored when a loop is in play.** The loop's stop condition is the judge's rubric; Loopwatch watches for the agent's *own* verification evidence (and flags its absence). Inferred-goal fallback otherwise.
- **Signals (v1):** drift, burn, weak validation, churn. (Scope creep, blocked-but-busy, premature confidence → v0.2.)
- **Liveness:** hybrid (file-recency + per-source process checks where available + user archive); `active → idle → ended`.

## 10. Scope

### v1 — the convergence walking skeleton
- Adapters **Pi · Codex · Claude**, **Level 1 passive** (read on-disk JSONL) — mandatory.
- Normalized event stream on Flue Durable Streams, file-backed local store.
- Capability badges · scoped git watcher.
- Convergence watcher (LLM judge, running summary, event cadence, model tiering); 4 signals; loop-anchored + inferred fallback.
- **Loops:** starter Loop Library + user's own · recommend-a-loop · loop auto-detection from opening prompt.
- **Coaching:** Pivot/fresh-session + reflective insights + loop recommendations (Coaching cards).
- **Layered UX:** Pulse → OS notification → Cockpit, in the Tauri shell.
- Dismissals remembered in-session · basic Upgrades inbox (capability gaps + unparsed events).

### v0.2
Level 2 enhancements (Claude hooks, Codex app-server, Pi diagnostics, opt-in) · named-skill recommendation + cross-session pattern coaching · scope-creep / blocked-but-busy / premature-confidence signals · deep-analyze + richer redaction · cross-session dismissal→Upgrade tuning · loop authoring/sharing UI.

### Deferred indefinitely
Level 3 (agent control).

## 11. Decision record index

| ADR | Decision |
|-----|----------|
| [0001](docs/adr/0001-observation-model.md) | Observe (L1+L2); control deferred, not rejected |
| [0002](docs/adr/0002-convergence-detection-architecture.md) | Per-session LLM judge over a maintained summary |
| [0003](docs/adr/0003-session-identity-follows-the-source.md) | Session identity follows the source |
| [0004](docs/adr/0004-normalized-event-shared-core-plus-extras.md) | Normalized events: shared core + preserved extras |
| [0005](docs/adr/0005-self-improvement-is-propose-only.md) | Self-improvement is propose-only |
| [0006](docs/adr/0006-local-first-structured-evidence-packets.md) | Local-first; structured evidence packets by default |
| [0007](docs/adr/0007-deployment-shape-flue-node-engine-tauri-shell.md) | Deployment: local Flue Node engine + Tauri shell |
| [0008](docs/adr/0008-git-watcher-scoped-to-active-sessions.md) | Git watcher scoped to active sessions |
| [0009](docs/adr/0009-session-liveness-and-freshness-risk.md) | Session liveness model + freshness risk |
| [0010](docs/adr/0010-loop-anchored-convergence-watches-agent-evidence.md) | Loop-anchored convergence watches agent evidence |
| [0011](docs/adr/0011-judge-cadence-and-cost-control.md) | Judge cadence & cost control |

## 12. Open questions & risks

1. **Freshness (must spike early — [ADR-0009](docs/adr/0009-session-liveness-and-freshness-risk.md)).** How often do Codex/Claude/Pi flush their JSONL? If minutes-laggy, a Level 2 live channel may have to be pulled into v1 for that source — could move the cut.
2. **Loop auto-detection** *(deferred in grill)*. Matching a paraphrased opening prompt to a library loop is fuzzy; a wrong match measures against the wrong target. Mitigation direction: only claim a loop above a confidence bar, else fall back to inferred goal.
3. **Pivot precision** *(deferred in grill)*. Distinguishing a real topic-pivot from the user merely clarifying. Default the nudge to calm to limit nagging.
4. **Semantic stop conditions** ([ADR-0010](docs/adr/0010-loop-anchored-convergence-watches-agent-evidence.md)). "Docs match implementation" can't be matched mechanically — softer LLM-only check.
5. **Flue observation surface** (research spike). Can a passive observer read Durable Streams off disk/SQLite directly, or must it go via the running server? Does the Pi source emit the same Durable-Streams shape as Flue (shared Pi lineage), letting one normalizer cover both?
6. **Level 2 footprint/consent mechanics** (v0.2). How hooks/diag/app-server get installed with consent and cleanly uninstalled.

## 13. Suggested build order

1. **Spike freshness** (#12.1) — it can change everything below.
2. One adapter (Pi or Claude, the richest) → normalized events on a file-backed Flue Node engine.
3. Cockpit session rail + timeline over `@flue/react` (read-only, no judge yet).
4. Convergence watcher (inferred-goal first), 1–2 signals, with the spend meter.
5. Tauri shell: Pulse + OS notifications.
6. Remaining two adapters + capability badges + git watcher.
7. Loops: library + recommendation + loop-anchored convergence.
8. Coaching (Pivot + reflective insights) + basic Upgrades inbox.
