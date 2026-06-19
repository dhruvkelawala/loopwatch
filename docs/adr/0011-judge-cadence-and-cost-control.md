# Convergence judge: event-driven cadence and cost control

The convergence judge is **event-driven and rate-capped**, not continuously polling. It runs when a meaningful unit completes — a settled burst of tool calls, a validation run, a commit, or a completion-like message — subject to a **configurable per-session rate cap** (≈ once / 30–60s).

**Escalation:** a cheap model maintains the running summary and emits a **concern flag**; the strong model is invoked only on that flag or a **hard signal** (a completion claim without supporting evidence, a burn spike, or repeated identical failures).

**Cost is bounded three ways:** the rate cap and model tiering are configurable ([ADR-0002](0002-convergence-detection-architecture.md)); liveness gates spend so idle/ended sessions go quiet ([ADR-0009](0009-session-liveness-and-freshness-risk.md)); and the Cockpit surfaces a live **LLM-spend meter** the user can see and cap.

## Rationale

Continuous LLM judgment over several live sessions is the same token burn the product warns the user about. Event-driven, rate-capped judgment stays timely on the moments that matter (a test result, a completion claim) while keeping cost legible and bounded. Trade-off accepted: a few seconds of latency in exchange for bounded cost.
