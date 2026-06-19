# Loopwatch Handoff - 2026-06-18

## Purpose

This handoff lets a fresh agent continue the Loopwatch product discussion without re-ideating from scratch. The next session should continue stress-testing the ambitious parts, then turn the settled decisions into a PRD.

Working name: **Loopwatch**. Rename later if desired.

Earlier baseline handoff from the prior session:

_(an earlier local temp handoff — not committed to this repo)_

That earlier document covered the initial product summary, why Flue fits, tech stack, MVP scope, out-of-scope items, open questions, and suggested next skills. This handoff captures the newer research and product decisions made after the user challenged the initial conservative take.

## User Direction And Tone

The user wants an ambitious product, not a timid Pi-only prototype. They explicitly rejected a Pi-only MVP. Multi-source is mandatory.

Important user corrections:

- "There is no point making it pi only. Multi-source is mandatory. I don't build this project without it."
- The user wants discussion of ambitious parts before building a PRD.
- The user wants hard things flagged, but not used as an excuse to shrink the product incorrectly.
- The user does not want Loopwatch to control agents ever. Agent control is out of scope, not merely deferred.

Use a direct, candid tone. Do not overcorrect into conservatism. The right stance is: ambitious, but sharply bounded.

## Research Summary

Research was done on Flue, Codex, Claude Code, and local Pi/SumoCode surfaces.

### Flue

Relevant sources:

- https://flueframework.com/blog/flue-1-0-beta/
- https://flueframework.com/
- https://github.com/withastro/flue
- https://blog.cloudflare.com/agents-platform-flue-sdk/

Findings:

- Flue is a good fit as Loopwatch's own runtime and app layer.
- It provides durable event streams, agents, workflows, sandboxes, channels, observability, SDK, and React bindings.
- The beta post emphasizes a durable append-only event log as source of truth, which matches Loopwatch's needs.
- Flue does not magically observe Codex, Claude, or Pi. Loopwatch still needs source adapters.

### Codex

Relevant sources:

- https://developers.openai.com/codex/app-server
- https://developers.openai.com/codex/sdk

Local surfaces inspected:

- `~/.codex/sessions/**/*.jsonl`
- `~/.codex/state_5.sqlite`
- `~/.codex/logs_2.sqlite`

Findings:

- Codex has an official app-server for controlled/local integrations with streamed agent events, approvals, conversation history, and generated schemas.
- Existing local Codex sessions also leave rollout JSONL and SQLite thread state.
- For Loopwatch, use passive local observation for existing sessions and app-server only where it naturally applies. Do not make app-server control a product requirement.

### Claude Code

Relevant sources:

- https://code.claude.com/docs/en/sessions
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/agent-sdk/sessions
- https://code.claude.com/docs/en/agent-sdk/streaming-output

Local surfaces inspected:

- `~/.claude/projects/**/*.jsonl`

Findings:

- Claude Code sessions are stored as local JSONL transcripts.
- Hooks can expose metadata such as `session_id`, `transcript_path`, `cwd`, and tool events.
- Passive transcript observation is realistic. Hook-based richer metadata is an enhancement.

### Pi / SumoCode

Local surfaces inspected:

- `~/.pi/agent/sessions/**/*.jsonl`
- `~/.pi/agent`
- `~/.pi/pi-acp/session-map.json`
- SumoCode repo (local checkout)

Relevant local files:

- `sumocode/README.md`
- `sumocode/docs/PI_TOOL_ARCHITECTURE.md`
- `sumocode/src/sumo-tui/runtime/diagnostics.ts`
- `sumocode/bin/sumocode.sh`

Findings:

- Pi/SumoCode appears to be the strongest source for observability.
- Pi session JSONL includes messages, model changes, thinking level changes, tool calls, tool results, usage, tokens, and cost in inspected samples.
- SumoCode has a diagnostics flight recorder enabled by `SUMO_TUI_DIAG_FILE`, with structured events for runtime, rendering, terminal state, Pi events, and lifecycle details.

## Current Product Thesis

Loopwatch is a local observability and intervention-awareness layer for AI coding agents.

It watches existing agent sessions across Pi, Codex, and Claude Code, normalizes their activity, detects convergence risks, and presents evidence-backed intervention notifications.

Loopwatch does not control agents.

## Settled Decisions

### Multi-source Is Mandatory

The MVP must include Pi, Codex, and Claude Code from day one, even if each adapter is shallow.

Correct MVP shape:

```text
Pi adapter      \
Codex adapter    -> normalized LoopwatchEvent stream -> detectors -> Flue synthesis -> React cockpit
Claude adapter  /

Git watcher -> repo context/doc signals --------^
```

### No Agent Control

Out of scope permanently:

- launching agents
- pausing agents
- stopping agents
- resuming agents
- steering agents
- injecting messages
- owning terminal/process control
- being a universal orchestrator

Loopwatch may recommend that the user intervene, but it does not intervene itself.

### Source Capability Badges

Do not fake parity across sources. Every source adapter should declare capabilities, for example:

```text
Pi:     transcript, tool calls, token/cost, diagnostics
Codex:  transcript, tool calls, token counts, app-server stream when available
Claude: transcript, tool calls, hooks if installed, maybe weaker cost data
```

Missing or weak capabilities should be visible in the UI and should feed the self-improvement system.

### Self-improving Loopwatch

Loopwatch should monitor its own blind spots and ask for upgrades to itself.

This means:

- It may propose improvements.
- It may generate implementation briefs.
- It may collect evidence for those briefs.
- It should not autonomously edit itself, install hooks, change settings, open PRs, or modify code in v1.

Examples:

- "Claude adapter is missing token usage; 12 sessions had unknown cost."
- "Codex parser ignored 8 new event types this week."
- "This detector was dismissed 6 times; threshold may be too sensitive."
- "User manually intervened after repeated validation failures, but Loopwatch did not alert."
- "Pi exposes cost data, but the UI does not show it."

### Notification And Inbox UX

There are two related but separate surfaces:

1. **Dismissable floating intervention cards**
   - For active agent/session risks.
   - Interruptive but lightweight.
   - Evidence-backed.
   - Grouped and throttled.
   - Severity-aware.
   - Deep-link into the session timeline.

2. **Loopwatch Upgrades inbox**
   - For product/self-improvement suggestions.
   - Slower, reflective, not interruptive.
   - Contains evidence, suggested upgrade, and acceptance criteria.

### Convergence Detection, Not Old-style Spiral Detection

The user clarified that latest SoTA agents generally do not get stuck in dumb loops. The more important problem is that they may take longer, misunderstand the task, or drift.

Rename the category from "spiral detection" to **Convergence Detection**.

Core question:

> Is this session still converging on the user's intended outcome?

Sub-signals:

- Drift: agent solves a nearby but wrong problem.
- Burn: time/tokens/tool calls rise without stronger evidence.
- Scope creep: change surface expands beyond the task.
- Weak validation: proof is weaker than change risk.
- Blocked-but-busy: agent keeps working around a missing dependency, decision, credential, test env, or unclear requirement.
- Churn: same files or approach repeatedly rewritten.
- Premature confidence: agent reports completion before evidence is strong enough.

Useful alert language:

- "Task appears to be expanding."
- "Agent is spending heavily without closing evidence gaps."
- "Validation is weaker than the change requires."
- "Implementation may have drifted from the original request."
- "Session may need a product decision."

### Privacy Position

The user noted that the models they use already send transcripts to providers. Do not overstate privacy fear.

Still, Loopwatch aggregates across providers, repos, sessions, tools, and time, so it should be transparent and controllable.

Recommended default:

- Allow LLM synthesis.
- Use structured evidence packets by default, not full raw transcripts.
- Keep raw event storage local.
- Let the user explicitly request deeper/full-context analysis.
- Show what evidence produced each alert.
- Redact obvious secrets by default.
- Avoid cloud sync/team features in MVP.

## UI Direction

If intervention is floating card UX, the rest of the page should not be card-heavy. It should feel like an agent session cockpit: panes, rows, timelines, filters, and inspectors.

Suggested main shell:

```text
┌──────────────────────────────────────────────────────────────┐
│ Repo / workspace   Active: 5 sessions   Alerts: 2   Upgrades │
├───────────────┬───────────────────────────────┬──────────────┤
│ Sessions      │ Active Session Timeline        │ Evidence     │
│               │                               │              │
│ Pi            │ User request                   │ Selected     │
│ Codex         │ Reads / edits / commands       │ event detail │
│ Claude        │ Git diff movement              │              │
│               │ Validation attempts            │ Files        │
│ grouped by    │ Convergence signals            │ Commands     │
│ repo/branch   │                               │ Diffs        │
└───────────────┴───────────────────────────────┴──────────────┘
```

Main areas:

1. Session rail
   - active and recent sessions
   - source, repo, branch, elapsed time
   - phase: reading, editing, validating, summarizing
   - changed file count
   - capability badges
   - convergence status

2. Active workbench
   - central timeline
   - lanes: conversation, tools, files, git, validation, convergence

3. Evidence inspector
   - selected event detail
   - repeated command failures
   - diff summary
   - changed files
   - validation history
   - transcript excerpts
   - missing data when unavailable

4. Top-level modes
   - Live
   - History
   - Upgrades
   - Sources
   - Settings

Default screen should answer:

> What are my agents doing right now, are they converging, and do I need to step in?

## Still Hard / Needs Discussion Before PRD

Continue one by one from here.

Hard areas already discussed:

- Live vs passive observation: resolved as observe-existing-sessions, no control.
- Event normalization: resolved direction is capability-aware normalization.
- Self-improvement: resolved direction is Upgrade Cards / inbox.
- Convergence detection: renamed from spiral detection; deterministic evidence first, LLM synthesis second.
- Notification UX: floating intervention cards plus separate Upgrades inbox.
- Privacy: allow LLM synthesis, but default to structured evidence packets and local raw storage.

Remaining hard areas to discuss:

- Session identity across repos, branches, worktrees, and subdirectories.
- Retention model for raw events, normalized events, summaries, and upgrade evidence.
- First concrete normalized event schema.
- Detector thresholds and how dismissals/false positives train them.
- How source adapters handle unknown or changing event shapes.
- How the git/doc watcher should work without becoming broad docs drift intelligence.
- What exactly belongs in MVP vs v0.2.

## Likely MVP

MVP should be ambitious but bounded:

- Multi-source adapters for Pi, Codex, Claude Code.
- Passive local observation of existing sessions.
- Capability declarations and badges.
- Normalized event stream.
- Git/file watcher per repo.
- Convergence detectors.
- Flue workflow/agent for intervention synthesis.
- React cockpit using Flue streams.
- Floating dismissable intervention cards.
- Loopwatch Upgrades inbox.
- Local-first raw storage and evidence packets for synthesis.

## Out Of Scope

Keep these out unless the user explicitly changes direction:

- Agent control/orchestration.
- Launching sessions from Loopwatch.
- Stop/pause/resume/steer.
- PR review replacement.
- GitHub/Linear external workflow integration.
- Cloud/team dashboard.
- Benchmark leaderboard claiming which agent is best.
- Autonomous code changes to Loopwatch.
- Automatic PR or issue creation.
- Broad repo-wide docs intelligence.

## Suggested Skills

Use these in the next session as needed:

- `domain-modeling`: define terms like source, session, adapter, capability, event, convergence signal, intervention card, upgrade card.
- `codebase-design`: design the adapter boundary, normalized event model, detector pipeline, and evidence packet shape.
- `grill-me` or `grilling`: stress-test the product boundaries and MVP before writing the PRD.
- `to-prd`: once decisions are settled, convert the conversation into a PRD.
- `prototype`: later, build a throwaway UI or event-pipeline prototype.
- `visual-explainer`: useful for a cockpit mockup or architecture diagram once the model is stable.

## Recommended Next Prompt

Continue the one-by-one discussion before writing the PRD:

> Continue from the Loopwatch handoff. We have settled no agent control, multi-source MVP, capability badges, floating intervention cards, Loopwatch Upgrades inbox, and convergence detection. Let's discuss the remaining hard parts one by one, starting with session identity across repos, branches, worktrees, and subdirectories.

