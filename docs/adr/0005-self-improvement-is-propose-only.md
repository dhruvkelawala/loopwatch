# Self-improvement is propose-only

Loopwatch monitors its own blind spots — capability gaps, unparsed event types, repeatedly dismissed alerts — and turns them into **Upgrade cards** (evidence + suggested fix + acceptance criteria). In v1 it is strictly **propose-only**: it never edits its own code, changes settings, installs hooks, or opens PRs autonomously. A human approves and applies every change. Upgrade cards live in a dedicated, non-interruptive **Upgrades inbox**, separate from the floating Intervention cards used for active session risks.

## Rationale

Autonomous self-modification is the same control/permission swamp deliberately avoided for agents (see [ADR-0001](0001-observation-model.md)), just pointed inward. Propose-only preserves trust and keeps v1 bounded. A separate inbox keeps slow, reflective product suggestions from competing with urgent, interruptive session alerts.
