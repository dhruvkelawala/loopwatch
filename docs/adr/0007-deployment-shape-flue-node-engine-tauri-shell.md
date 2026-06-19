# Deployment shape: local Flue Node engine + thin Tauri shell

Loopwatch is built on **Flue**, targeting Flue's **Node runtime running locally** — not Cloudflare. Although Cloudflare Durable Objects is Flue's most mature production target, it would push raw session data off-machine, contradicting the local-first decision ([ADR-0006](0006-local-first-structured-evidence-packets.md)); the Node target keeps everything local.

**Persistence gotcha:** Flue's Node target defaults to *in-memory* SQLite and loses all state on restart. Loopwatch must configure a **file-backed `sqlite()` PersistenceAdapter** (`src/db.ts`, from `@flue/runtime/node`) so raw events and running summaries durably persist. Flue's append-only **Durable Streams** log is the substrate for the normalized event store ([ADR-0004](0004-normalized-event-shared-core-plus-extras.md)) and the watcher's running summaries ([ADR-0002](0002-convergence-detection-architecture.md)).

**UI:** a single React app built on **`@flue/react`** (`useFlueAgent` / `useFlueWorkflow`), subscribed to live, replayable Flue streams via `@flue/sdk` (HTTP + Durable Streams). Because the hooks replay the full bounded stream on mount, the Cockpit back-fills a running session's timeline from the durable log and then streams live — no custom realtime plumbing. The same reactive data drives all three layered surfaces (Pulse, notification content, Cockpit).

**Shell:** Flue is headless and provides no native tray or background notifications. Loopwatch wraps the React app in a **thin Tauri shell** whose only jobs are: host the webview, provide a native menu-bar/tray **Pulse**, fire **OS notifications while the Cockpit is closed**, and supervise the local Flue Node engine as a background process. **Electron was rejected** — it bundles a full Chromium for a native job this thin; Tauri uses the system webview and keeps the always-resident footprint small.

## Consequences

- Loopwatch is a **tray-resident desktop app**, not a browser tab.
- Flue's planned multi-node scaling (post-1.0) is irrelevant — Loopwatch is single-user, single-node, local.
- **Open spikes:** (1) whether the source adapters / Loopwatch's own engine can read Durable Streams off disk directly or must go via the running Flue server (`flue logs` is workflow-runs-only); (2) whether the Pi source emits the same Durable-Streams shape Flue uses (both are Pi-lineage), which would let one normalizer cover both.
