# Prototype — Cockpit UI variants

**Throwaway.** Delete this folder once the chosen variant is folded into the real
Cockpit, or when the question is answered.

## Question

The intervention-UX prototype ([`NOTES.md`](./NOTES.md)) settled the *posture* —
layered by severity: Pulse → OS notification → Cockpit. This prototype asks the
next question: **what should the Cockpit itself look like, as a Tauri desktop app?**

Three **structurally different layouts** for the same surface, switchable in the
browser, so you can compare them against identical data and pick one (or combine parts).

## What it is

One self-contained HTML file, three Cockpit variants on one route, gated by `?variant=`
and a floating bottom bar (`←`/`→` cycle). All three render the **same** 13-session set
(the drift scenario from the intervention-UX prototype, enriched) so they're directly
comparable. Click any session in any variant to refocus all three on it. Each variant is
framed as real window chrome (title bar, traffic lights, status bar) — the way it ships
inside the Tauri webview.

```
open prototype/cockpit-ui.html
```

## Direction: crafted, distinctive desktop software

Not three flavours of the same grey dev tool — three different *products*. Each variant
commits to its own typeface, palette, and integrated signature mark, in the register of
Linear / Warp / Things / Tower: dense, restrained, unmistakably itself. Real web type
(loaded from Google Fonts), committed colour, meticulous spacing. The signature marks are
*integrated*, not bolted on. Deliberately not: generic system fonts, grey-on-grey, novelty
glyphs that read as a landing page rather than software you keep open next to your editor.

## The three variants

| key | name | type | palette | structural bet & signature |
|-----|------|------|---------|----------------------------|
| `watchtower` | **Watchtower** | Geist / Geist Mono | cool slate + electric **cyan** | 3-pane instrument deck (rail · timeline · evidence). Signature: a convergence dial — concentric target, rotating sweep, a contact that drifts outward as the session diverges from goal. |
| `logbook` | **Logbook** | **Fraunces** serif · Hanken Grotesk · IBM Plex Mono | warm **parchment** + brass/oxblood, paper grain | activity list grouped by status + slide-over detail drawer. Signature: brass-bezel status rings + dotted-leader ledger receipts. |
| `bridge` | **Bridge** | Chivo · **Martian Mono** | near-black + **amber**/steel | ops board: metric strip + dense sortable table + tabbed lower pane. Signature: live sparklines with gradient area-fill and a pulsing endpoint. |

Each carries the same three Cockpit responsibilities from PRD §6 — **session rail · session
timeline · evidence inspector** — but disagrees about layout structure and primary affordance:

- **Watchtower** bets on a persistent 3-pane layout you live in.
- **Logbook** bets on a calm list where the detail comes to you (drawer).
- **Bridge** bets on table + metrics, for scanning many sessions at once.

## What's deliberately NOT here (prototype scope)

- No live data — sessions are a hardcoded array, not the Flue Durable Streams store.
- No real `@flue/react` / Tauri wiring; this is plain HTML/CSS/JS.
- No dismiss/escalate mutations beyond visual state; the Bridge's command bar is decorative.
- Web fonts load from Google Fonts (needs network). The actual Tauri build can bundle the
  same faces locally — the prototype uses the CDN so the *look* is representative.

## Verdict

**Winner: Watchtower** (the 3-pane instrument deck).

- **Which variant?** Watchtower, used whole — not a combination.
- **Why it's right for the Cockpit.** Its persistent 3-pane shape maps one-to-one onto the
  three Cockpit responsibilities (rail · timeline · evidence), so nothing is hidden behind a
  drawer or a tab — it's the surface you *live in* while watching sessions, which is what the
  Cockpit is for. The cool instrument aesthetic reads as serious developer tooling, and the
  convergence dial gives an at-a-glance read of drift that the other two lack. Logbook's
  drawer and Bridge's table are better for triage-at-scale than for the deep single-session
  focus the Cockpit centres on.
- **Effect on the layered posture.** None. Pulse → notification → Cockpit is unchanged;
  Watchtower is purely the look of the deepest layer.

### Follow-ups for the real build (PRD step 5)

- Center pane has whitespace below the timeline at tall window sizes — fill it (e.g. a diff
  strip or activity log) when wiring real data.
- The dial, metric strip, and evidence cards are data-driven off the mock `SESSIONS` shape;
  re-point them at the normalized event model / Flue store.
