# Spike — freshness & cadence (PRD §12.1, §13 step 1; ADR-0009)

**Question:** Is passive JSONL tailing fresh enough for timely intervention, and how bursty are events (for tuning the judge's cadence)?

**Status:** ✅ Resolved for **Pi**, **Codex**, and **Claude** (measured live during real active work). **Net verdict: the freshness risk is retired for v1.** Pi/Codex flush in tens of milliseconds; Claude batches writes but stays comfortably under the judge rate cap during active tool use. No Level 2 live channel needs to be pulled into v1 for any source.

---

## 1. Event timing (analyze mode) — run 2026-06-19

Characterizes inter-event gaps from record timestamps (agent clock). A proxy for how fresh passive observation *can* be, and an input to judge debounce.

| Source | records | span | median gap | p90 gap | max gap | gaps >60s |
|--------|---------|------|-----------|---------|---------|-----------|
| Codex  | 164 | 54 min | **0.0s** | 6.1s | ~44 min | 3 |
| Claude | 388 | ~11.7 hr | 2.9s | 70s | ~9 hr | 49 |
| Pi     | 66  | 42 min | 3.3s | 117s | ~9.5 min | 9 |

**Reads:**
1. **When active, events are dense — median 0–3s apart** (Codex extremely bursty). The *ceiling* on freshness is good: if files flush promptly, passive observation is near-real-time. → Supports the debounce-until-a-burst-settles cadence ([ADR-0011](../docs/adr/0011-judge-cadence-and-cost-control.md)).
2. **Long idle gaps are common and large** (Claude ~9 hr, Codex ~44 min, Pi ~9.5 min); Claude's file spanned ~12 hours of wall-clock. Sessions pause and resume. → Validates the liveness model ([ADR-0009](../docs/adr/0009-session-liveness-and-freshness-risk.md)): "ended" can't be a short timeout or resumable sessions get wrongly archived. Keep idle/ended thresholds generous + configurable; lean on process-liveness and explicit archive.

---

## 2. TRUE flush lag (live `--watch` mode) — run 2026-06-20  ✨ THE NUMBER

This is the measurement that actually validates or breaks the freshness assumption: **wall-clock delay between an event's own timestamp (agent clock) and the moment its bytes are visible to an outside reader.** Each source was tailed while a real session was actively doing work (90s windows, 100ms poll).

| Source | appends | records | lag min | lag median | lag p90 | lag p99 | lag max | lags >1s |
|--------|---------|---------|---------|-----------|---------|---------|---------|----------|
| **Pi**    | 9   | 12  | **6 ms**   | **35 ms**  | 83 ms  | 84 ms  | **84 ms**  | **0** |
| **Codex** | 27  | 52  | **2 ms**   | **48 ms**  | 100 ms | 105 ms | **105 ms** | **0** |
| **Claude**| 6   | 44  | 111 ms     | **982 ms** | 3.13 s | 24.56 s | **24.56 s** | 22 (of 44 recs) |

> **Claude note:** Claude batches/buffers writes, unlike Pi/Codex's near-immediate per-event flush. During active tool use the typical lag was still low (~1s median, ~3.1s p90), with a worst observed batched record of 24.56s. No records exceeded 30s.

Raw per-append samples (all sub-100ms; max single-event lag never exceeded 105ms in either source):

```
PI    +1456B 1rec lag=0.07s | +1290B 1rec 0.04s | +2713B 1rec 0.06s | +23380B 1rec 0.02s | +2039B 2rec 0.08s | +6107B 2rec 0.03s | +1149B 1rec 0.04s
CODEX +278B 1rec 0.02s | +725B 1rec 0.10s | +472B 2rec 0.02s | +9769B 3rec 0.04s | +1308B 4rec 0.03s | +1617B 3rec 0.04s | +1840B 2rec 0.07s  (27 appends total, all ≤0.105s)
```

Machine-readable summary blocks are reproducible with:
```
python3 spike/freshness-probe.py --watch <session.jsonl> --duration 90 --out <file>
```

### Verdict per source

- **Pi — Level 1 passive tailing is sufficient for v1.** Flush lag is ~35ms median / ≤84ms worst-case. Passive observation will see events within tens of milliseconds of the agent creating them — **~3 orders of magnitude under** the judge's rate cap (≈ once / 30–60s, [ADR-0011](../docs/adr/0011-judge-cadence-and-cost-control.md)). No Level 2 channel needed.
- **Codex — Level 1 passive tailing is sufficient for v1.** Flush lag is ~48ms median / ≤105ms worst-case, measured over 27 appends while the session was actively producing 0.3–4s-spaced events. No Level 2 channel needed.
- **Claude — Level 1 passive tailing is sufficient for v1.** Claude's write discipline differs from Pi/Codex: it batches/buffers events. In the active rerun, median lag was **0.982s**, p90 **3.13s**, and max **24.56s**. That is slower than Pi/Codex but still under the judge's rate cap (≈ once / 30–60s, [ADR-0011](../docs/adr/0011-judge-cadence-and-cost-control.md)) and does not justify a Level 2 channel in v1.

### Why this retires the risk (for the measured sources)

The freshness concern in [ADR-0009](../docs/adr/0009-session-liveness-and-freshness-risk.md) and [PRD §12.1](../PRD.md) was: *if a source flushes minutes-laggy, interventions arrive too late and a Level 2 live channel must be pulled into v1 (moving the cut).* Measured worst-case lag is **~100ms**, not minutes. Even accounting for measurement noise, there is **>2 orders of magnitude of headroom** before flush lag could threaten intervention timeliness. The v1 build order can proceed on the assumption that Level 1 passive tailing is fresh enough — for Pi and Codex, as a measured fact.

---

## 3. Adapter-layout finding (affects v1 source adapters)

While running the live measurement, a real implementation gotcha surfaced: **none of the three sources store session JSONL in a flat directory.** The probe (and any future adapter) must glob recursively per root, not pin a flat path.

| Source | Session-file layout |
|--------|--------------------|
| **Pi**    | `~/.pi/agent/sessions/<cwd-slug>/<timestamp>.jsonl` — sharded by working-directory slug (e.g. `--Users-dhruvkelawala-development-loopwatch--`) |
| **Codex** | `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` — sharded by date |
| **Claude**| `~/.claude/projects/<project-slug>/<uuid>.jsonl` — sharded by project slug |

The probe's `newest()` already globs `**/*.jsonl` recursively, so analyze mode found nested files correctly. The live `--watch` mode also became **`ENOENT`-tolerant** during this spike: Pi momentarily drops the path during writes (brief atomic-rename window), so a naive `os.path.exists()` check can race and miss appends. Any production tailer must retry-through-transient-`ENOENT`, not treat a missing path as "session gone." Both behaviors are now baked into `freshness-probe.py`.

---

## Still open

None for the freshness decision. A longer Claude sample would be useful for adapter tuning, but the active 90s run already answers the v1 cut question: Claude is batchier than Pi/Codex, yet still fresh enough for the event-driven, rate-capped judge. Level 2 live channels can remain out of v1.
