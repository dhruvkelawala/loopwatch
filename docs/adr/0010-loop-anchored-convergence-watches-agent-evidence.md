# Loop-anchored convergence watches for the agent's own verification evidence

Status: **accepted (provisional)** — adopted for v1; expected to evolve as loops and the evidence model mature.

Because Loopwatch never runs anything (no control — [ADR-0001](0001-observation-model.md)), it cannot evaluate a Loop's stop condition itself. Instead, loop-anchored convergence works by **watching for the evidence the agent produces when *it* runs its own verification**, with the Loop's stop condition serving as the convergence judge's explicit **rubric**:

- If the expected evidence appears and meets the bar → the loop has closed (converged).
- If the agent claims completion but the stop-condition evidence **never appeared** → that absence is a **first-class signal** (premature confidence / weak validation). The loop tells Loopwatch exactly what's missing.

## Consequence for the Loop schema

A Loop should declare its stop condition as **observable evidence** wherever possible (a command exit code, a passing suite, a coverage threshold) — not just prose — so Loopwatch can recognize it or its absence. Purely **semantic** stop conditions ("docs match the implementation") cannot be matched mechanically and fall back to the LLM judge assessing observed diffs, which is a softer check.
