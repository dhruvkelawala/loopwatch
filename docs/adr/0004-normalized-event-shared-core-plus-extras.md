# Normalized events: shared core plus pass-through source extras

A Loopwatch Event has a small **common envelope** every source fills in — session reference, timestamp, event kind, and actor (user / agent / tool / system) — plus a **flexible source-specific payload** that preserves the source's native richness. Adapters **never drop data they don't recognize**: unknown fields and unknown event types are preserved and surfaced to the self-improvement loop as capability gaps, not discarded. Normalization is **capability-aware**: each source declares what it can provide, and missing data is marked unavailable rather than faked.

## Rationale

A lowest-common-denominator schema would flatten every source to the weakest one — betraying the no-fake-parity decision and throwing away Pi's richer signals. Preserving unknowns keeps adapters robust when agents change their event formats over time, and turns blind spots into Upgrade cards.

## Consequences

- Downstream consumers (watcher, timeline, retention) must tolerate partial and unknown payloads.
- The exact common-core field list is left as an implementation detail, to be fixed when the first adapter is built.
