# Loopwatch

Loopwatch is a local, passive companion for AI coding agents that helps your sessions converge on what you actually wanted — by starting them as the right loop, watching whether they close, and coaching you over time. It never controls the agents. This glossary keeps product language precise while the design is being sharpened.

## Language

**Loopwatch**:
A local observability and intervention-awareness layer for AI coding agents. Loopwatch watches existing sessions and surfaces evidence-backed recommendations, but does not control agents.

**Source**:
An agent environment that Loopwatch can observe, such as Pi, Codex, or Claude Code.
_Avoid_: Provider, platform

**Source Adapter**:
The source-specific observer that reads a source's local session activity and emits Loopwatch's shared event language.
_Avoid_: Integration, connector

**Capability**:
A declared kind of evidence a source adapter can reliably provide, such as transcript activity, tool calls, token usage, cost, hooks, or diagnostics.
_Avoid_: Feature parity

**Agent Session**:
A single observed body of agent work from one source.
_Avoid_: Job, task, run

**Loopwatch Event**:
A normalized record of observed session activity that downstream detectors and synthesis can reason over.
_Avoid_: Raw event, log line

**Raw Event**:
A source-native observation stored locally before normalization.
_Avoid_: Loopwatch Event

**Convergence Detection**:
The assessment of whether an agent session is still moving toward the user's intended outcome.
_Avoid_: Spiral detection, loop detection

**Convergence Signal**:
Evidence that informs convergence detection, such as drift, burn, weak validation, churn, scope creep, blocked-but-busy behavior, or premature confidence.
_Avoid_: Alert, warning

**Pivot**:
A deliberate change of the user's intended outcome within a single Agent Session — the user starts a new topic after earlier work is done. Distinct from Drift, which is the agent moving away from an unchanged goal; a Pivot is the user moving the goal itself. Loopwatch should detect a Pivot and suggest starting a fresh session.
_Avoid_: Drift, scope creep

**Loop**:
A reusable, self-verifying agent workflow — a structured prompt with a trigger, action, verification, memory, and an explicit stop condition that tells the agent when its work is genuinely done. A well-run session is a closing loop, and a loop's stop condition is the concrete target convergence is measured against.
_Avoid_: Macro, script, automation

**Loop Library**:
The collection of Loops Loopwatch can recommend — a curated starter set plus the user's own.
_Avoid_: Template gallery, catalog

**Intervention Card**:
A dismissable floating notification for an active session risk that may require user attention.
_Avoid_: Upgrade card, alert modal

**Upgrade Card**:
A non-interruptive suggestion for improving Loopwatch itself, backed by observed blind spots or repeated product friction.
_Avoid_: Intervention card, task ticket

**Coaching Card**:
A reflective recommendation to improve the user's own AI workflow — typically the right Loop for the task, or a better prompt or session habit — drawn from observed patterns. Distinct from an Intervention Card (about the agent) and an Upgrade Card (about Loopwatch).
_Avoid_: Tip, nudge

**Evidence Packet**:
A structured bundle of selected observations used to explain, synthesize, or justify a convergence finding without sending full raw transcripts by default.
_Avoid_: Full transcript, dump

**Cockpit**:
Loopwatch's main window — the dense, on-demand investigation surface (session rail, session timeline, evidence inspector). Opened from a Pulse or a notification; closing it does not stop observation.
_Avoid_: Dashboard, home screen

**Pulse**:
The always-present ambient indicator in the menu bar / tray showing aggregate convergence state across active sessions. The calmest layer of the layered intervention UX, escalating to OS notifications and then the Cockpit.
_Avoid_: Tray badge, status light
