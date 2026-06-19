# Prototype — Intervention UX posture (Decision 11)

**Throwaway.** Delete this folder, or fold the winning posture into the real cockpit, once the verdict is in.

## Question

How should Loopwatch's intervention UX present itself? Is it a dashboard you *watch*, or a watchdog that *taps you on the shoulder* — and at what layers?

## What it does

One simulated desktop (menu bar + a faux Codex terminal) driven by one shared scenario: **Codex is drifting on an auth task** (4 failed `pnpm test` in 42m, no passing check, diff still growing). Five postures, switchable via `?variant=` and the floating bottom bar; **▶ Trigger** (or spacebar) replays the moment the drift crosses the line so you can feel each posture interrupt you.

- `invisible` — no persistent UI; only an OS notification on trigger.
- `ambient` — always-on menu-bar pulse; click to peek at a session popover.
- `cockpit` — full always-open dashboard (rail · timeline lanes · evidence inspector).
- `embedded` — the warning appears inline inside the terminal, next to the agent.
- `layered` — ambient pulse → OS notification → full cockpit, escalating by severity.

## Run

```
open prototype/intervention-ux.html
```

(or use the Launch preview panel). Arrow keys ←/→ cycle variants; spacebar triggers.

## Verdict

**Layered wins** (2026-06-19). Loopwatch presents at three severity-escalating layers: ambient menu-bar pulse (always) → OS notification (intervention) → full cockpit (investigate). This choice implies a **tray-resident desktop shell**, not a browser tab — see the follow-on shell decision. Safe to delete this prototype once the shell decision is recorded.
