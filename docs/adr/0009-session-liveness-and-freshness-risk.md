# Session liveness model, and freshness as an unvalidated assumption

A session's liveness is inferred from a **hybrid** signal: **file-append recency** (the universal signal every source provides) as the primary indicator, sharpened by **per-source process-liveness checks** (PID / lock / socket / state db) where a source exposes them, plus an explicit user **"archive"** action. Sessions move `active → idle → ended` on configurable thresholds.

The convergence watcher's **LLM spend follows liveness**: active sessions get full watching, idle sessions drop to cheap/paused checks, and ended sessions stop being judged. This ties cost control directly to lifecycle.

## Recorded risk — freshness is unvalidated

Loopwatch's "real-time" promise is only as fresh as each agent **flushes** its JSONL to disk. This has **not been measured**. Early in v1, spike the actual flush cadence of Codex, Claude Code, and Pi. If a source proves minutes-laggy, a Level 2 live channel (hook / app-server / diagnostics) may have to be **pulled into v1 for that source** to keep interventions timely — which would move the v1 cut. Until measured, treat timely passive observation as an assumption, not a fact.
