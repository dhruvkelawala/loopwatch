# Spike — freshness & cadence (PRD §12.1, §13 step 1)

**Question:** Is passive JSONL tailing fresh enough for timely intervention, and how bursty are events (for tuning the judge's cadence)?

**Method:** `freshness-probe.py` (analyze mode) over the newest existing session file per source; inter-event timing from record timestamps. Run 2026-06-19.

## Findings — event timing

| Source | records | span | median gap | p90 gap | max gap | gaps >60s |
|--------|---------|------|-----------|---------|---------|-----------|
| Codex  | 164 | 54 min | **0.0s** | 6.1s | ~44 min | 3 |
| Claude | 388 | ~11.7 hr | 2.9s | 70s | ~9 hr | 49 |
| Pi     | 66  | 42 min | 3.3s | 117s | ~9.5 min | 9 |

## Reads

1. **When a session is active, events are dense — median 0–3s apart** (Codex is extremely bursty, many events/second). So the *ceiling* on freshness is good: if files flush promptly, passive observation can be near-real-time. → Supports the debounce-until-a-burst-settles cadence ([ADR-0011](../docs/adr/0011-judge-cadence-and-cost-control.md)).
2. **Long idle gaps are common and large** (Claude ~9 hr, Codex ~44 min, Pi ~9.5 min); Claude's file spanned ~12 hours of wall-clock. Sessions pause and resume. → Validates the liveness model ([ADR-0009](../docs/adr/0009-session-liveness-and-freshness-risk.md)): "ended" can't be a short timeout or resumable sessions get wrongly archived. Keep idle/ended thresholds generous + configurable; lean on process-liveness and explicit archive.

## STILL OPEN — the actual freshness number

This measures when events *occurred* (agent clock), **not** when bytes hit disk. True flush lag — the delay between an event happening and Loopwatch being able to read it — needs the **live mode during an active session**:

```
python3 spike/freshness-probe.py --watch ~/.codex/sessions/<newest>.jsonl
```

Run that while driving a real session in each tool. If appends lag by minutes, that source may need a Level 2 live channel pulled into v1. Until then: **event cadence is favorable; flush lag is unconfirmed** — freshness remains a partially-validated assumption.
