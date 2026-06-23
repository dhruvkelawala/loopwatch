# Cockpit visual design: Watchtower, a three-pane instrument deck

The layered-UX decision ([ADR-0007](0007-deployment-shape-flue-node-engine-tauri-shell.md), PRD §6) settled the Cockpit's *posture* and *responsibilities* — session rail · session timeline · evidence inspector — but not its **look**. A second throwaway prototype ([`prototype/cockpit-ui.html`](../../prototype/cockpit-ui.html), notes in [`prototype/cockpit-ui-NOTES.md`](../../prototype/cockpit-ui-NOTES.md)) put **three structurally different, crafted desktop layouts** against the *same* 13-session dataset so they could be compared directly: **Watchtower** (dark, 3-pane instrument deck), **Logbook** (warm list + detail drawer), and **Bridge** (ops board: metric strip + dense table).

**Decision: Watchtower.** The Cockpit ships as a dark, three-pane instrument deck — a persistent **session rail** (sessions grouped by repo, with status + freshness), a **focused-session timeline** in the centre, and an **evidence inspector** on the right.

**Why it fits the Cockpit's job.** Its persistent 3-pane shape maps one-to-one onto the three Cockpit responsibilities, so nothing is hidden behind a drawer (Logbook) or a tab (Bridge) — it is the surface you *live in* for the deep, single-session investigation the Cockpit exists for. Triage-at-scale — scanning many sessions at a glance — is the **Pulse's** job, not the Cockpit's, which is exactly what Logbook's drawer and Bridge's table optimise for. The signature **convergence dial** (a target with a contact that drifts outward as the session diverges) gives an at-a-glance read of drift the other two lack.

**The committed aesthetic.** Cool slate background with an electric-**cyan** accent; **Geist / Geist Mono** typography; the shared severity spectrum (calm · watch · intervention) used sparingly; native window chrome (title bar, status bar carrying live spend + keyboard hints) and `.liv` freshness tags ([ADR-0009](0009-session-liveness-and-freshness-risk.md)). The register is serious developer tooling (Linear / Warp / Tower), not a web page.

This is a **visual-direction decision only.** It does not change the layered posture ([ADR-0007](0007-deployment-shape-flue-node-engine-tauri-shell.md)), the event model ([ADR-0004](0004-normalized-event-shared-core-plus-extras.md)), or any other prior decision. The prototype is throwaway reference, not shipping code.

## Consequences

- **Slice 4** (Tauri shell + empty Cockpit chrome) builds the rail/timeline/inspector regions to this design; **Slice 5** wires real `@flue/react` data into it. The prototype is the visual spec for those slices.
- The prototype loads **web fonts (Geist) from a CDN**. The Tauri build should **bundle the faces locally** to stay offline-capable and local-first ([ADR-0006](0006-local-first-structured-evidence-packets.md)).
- The prototype's dial, metric strip, and evidence cards are driven off a **mock `SESSIONS` shape**; re-point them at the normalized event model ([ADR-0004](0004-normalized-event-shared-core-plus-extras.md)) / Flue store when implementing.
- **Lane reconciliation:** the prototype's timeline lanes are request / tools / files / validation / convergence (+ liveness, cost); PRD §6 also calls for a dedicated **git** lane ([ADR-0008](0008-git-watcher-scoped-to-active-sessions.md)). Add it when building.
- The center pane has whitespace below the timeline at tall window sizes — fill it (e.g. a diff strip or raw activity log) once real data is available.
