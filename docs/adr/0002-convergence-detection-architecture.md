# Convergence detection: a per-session LLM judge over a maintained summary

Convergence detection is performed by a per-Agent-Session **watcher**. The judge is an **LLM, not deterministic rules** — drift is a semantic problem rules cannot see. To run affordably over several live sessions at once, the watcher keeps a compact **running state** per session (current goal · work done · validation status · open concerns) and re-judges on **meaningful events** (edit batches, validation attempts, commits) rather than on a clock or by re-reading the whole transcript. Deterministic signals (token burn, files changed, test pass/fail, repeated commands) are **fed to the judge as evidence, never used as the decision**. Cost is controlled by **model tiering** — a cheap model handles routine "still on track?" checks and escalates to a strong model only when concerned — and the tier policy is **configurable** to tune price/performance. Raw events stay local so the judge can zoom into exact evidence; full retrieval/RAG is deferred.

## Rationale

Re-reading the full transcript each time is simple but its cost and latency balloon as sessions grow; RAG keeps detail but is complex and overkill for v1. The maintained running summary (each event processed once) plus model tiering keeps continuous LLM judgment affordable while preserving semantic accuracy.

## Consequences / still open

- The watcher must distinguish **Drift** (the agent leaves an unchanged goal) from **Pivot** (the user changes the goal mid-session). The goal is *current and updatable*, not pinned once.
- The Pivot card / "start a fresh session" UX is not yet decided.
- The running summary can be lossy ("summary drift"); local raw events are the mitigation.
