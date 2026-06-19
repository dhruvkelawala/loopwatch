# Local-first data; structured evidence packets by default

Raw events are stored locally and stay local. When the convergence judge needs an LLM, it sends a **compact structured evidence packet** by default — the watcher's running summary plus the specific signals behind a card — not full raw transcripts. Obvious secrets are **redacted** before anything leaves the machine. The user can opt into **"deep analyze"** to send fuller transcript context for a single card. The LLM provider/model is configurable; cloud is acceptable.

## Rationale

Loopwatch aggregates across providers, repos, sessions, and time, which makes the pooled data more sensitive than any single session — even though each agent already sends its own transcript to its own provider. Defaulting to structured packets also forces alerts to be explainable from evidence rather than vibes. The running-summary architecture ([ADR-0002](0002-convergence-detection-architecture.md)) makes structured-by-default essentially free.
