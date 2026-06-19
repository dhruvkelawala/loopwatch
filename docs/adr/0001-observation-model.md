# Loopwatch observes agents; control is deferred, not rejected

Loopwatch v1 reaches up to **Level 2**: passive reading of the files agents already write (Level 1 — the always-on floor for Pi, Codex, and Claude Code), plus opt-in, consent-gated, undoable "assisted-live" enhancements (Level 2 — e.g. Claude hooks, Codex app-server stream, Pi diagnostics). **Level 3** (controlling agents: launch / pause / stop / steer) is **deferred as an optional future enhancement** — out of v1 scope, but no longer ruled out forever.

This revises the earlier "agent control is permanently out of scope" stance recorded in the README and the 2026-06-18 handoff. Rationale: Level 1 + Level 2 deliver the multi-source observability product without inheriting process/terminal ownership, permission models, and "who is allowed to act" complexity. Deferring rather than forbidding Level 3 keeps the door open for a later away-from-desk pause/stop, while keeping v1 small and honest.

## Consequences

- README "Non-goals" and the handoff's "No Agent Control" section now overstate the boundary and need reconciling to "deferred, not permanent."
