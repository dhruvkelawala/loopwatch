# Loopwatch v1 evidence dossier

Date: 2026-07-04
Target: macOS arm64 personal alpha
Goal: ship Loopwatch v1 from issues #1, #7-#17, #22, PRD.md, CONTEXT.md, and ADRs.

## Release artifact

- Release command: `CI=false pnpm tauri:build`.
- Result: passed.
- Built binary: `src-tauri/target/release/loopwatch`.
- Note: `pnpm tauri:build` with the ambient `CI=1` failed before build with Tauri CLI argument parsing: `invalid value '1' for '--ci'`; rerunning with `CI=false` built successfully.

## Commits by scope

| Scope | Issue(s) | Commit(s) | Evidence |
| --- | --- | --- | --- |
| Baseline verification harness | #1, #7 | `7a2bde3`, `499a7fb` | `pnpm v1:baseline`; `pnpm v1:harness`; `pnpm harness:fixtures` |
| Engine hardening | #22 | `2f850c3` | `pnpm security:check`; security review passed earlier in the v1 goal |
| Cockpit live session path | #7 | `9928914`, `5330a5e` | `pnpm cockpit:check`; `pnpm e2e:cockpit`; UI reviews passed |
| Convergence watcher + intervention/evidence surface | #8, #9 | `a400a47` | `pnpm convergence:check`; `pnpm e2e:cockpit`; reviews passed earlier in the v1 goal |
| Layered alerting | #10 | `d22eb94` | `pnpm alerting:check`; `cargo test alerting::tests::macos_native_notification_smoke --manifest-path src-tauri/Cargo.toml -- --ignored` |
| Codex/Pi source parity | #11 | `a45d443` | `pnpm source:check`; source smoke commands for Claude, Codex, Pi |
| Scoped git watcher | #12 | `70995a8` | `pnpm git:check` |
| Loop Library + recommendation | #13 | `f086dc6` | `pnpm loop:check` |
| Loop auto-detection + loop-anchored convergence | #14 | `b70e67a` | `pnpm convergence:check` |
| Pivot detection + fresh-session nudge | #15 | `7d732eb` | `pnpm convergence:check`; `pnpm e2e:cockpit` |
| Reflective post-session coaching insights | #16 | `701094b` | `pnpm convergence:check`; `pnpm e2e:cockpit` |
| Upgrades inbox | #17 | `1256627` | `pnpm upgrades:check`; `pnpm e2e:cockpit`; reviewer passed |
| Evidence privacy / ADR-0006 outbound packet | #1 | `eabd9f1` | `pnpm evidence:privacy:check`; `pnpm v1:baseline`; security review passed |
| Watchtower UI fidelity | #7 / ADR-0012 | `5330a5e` | `pnpm e2e:cockpit`; `pnpm ui:build`; frontend/design reviews passed |

## Final verification commands

All commands below were run locally in `/Volumes/SumoDeus NVMe/code/flue-experiment/loopwatch`.

| Command | Result | What it proves |
| --- | --- | --- |
| `pnpm v1:baseline` | Passed | All 12 baseline contracts: normalized event, Claude adapter, source parity, persistence, ingest, Cockpit replay, convergence watcher, scoped git, Loop Library, Upgrades inbox, Evidence privacy, layered alerting |
| `pnpm v1:harness` | Passed with source-smoke/live-eval skips by default | Aggregate harness command runs deterministic fixtures and reports opt-in gates explicitly |
| `pnpm harness:fixtures` | Passed | Synthetic Claude/Codex/Pi fixtures, prompt-contract fixtures, malformed eval rejection, Cockpit fixture endpoint contract |
| `LOOPWATCH_SOURCE_SMOKE=1 LOOPWATCH_SOURCE=claude LOOPWATCH_SOURCE_SMOKE_ROOT=tests/fixtures/source-transcripts/claude/projects pnpm harness:source-smoke` | Passed | Claude Source Adapter reads fixture transcripts and emits normalized events |
| `LOOPWATCH_SOURCE_SMOKE=1 LOOPWATCH_SOURCE=codex LOOPWATCH_SOURCE_SMOKE_ROOT=tests/fixtures/source-transcripts/codex pnpm harness:source-smoke` | Passed | Codex Source Adapter reads fixture transcripts and emits normalized events |
| `LOOPWATCH_SOURCE_SMOKE=1 LOOPWATCH_SOURCE=pi LOOPWATCH_SOURCE_SMOKE_ROOT=tests/fixtures/source-transcripts/pi pnpm harness:source-smoke` | Passed | Pi Source Adapter reads fixture transcripts and emits normalized events |
| `LOOPWATCH_LIVE_EVAL=1 LOOPWATCH_EVAL_PROVIDER=fake pnpm harness:eval:live` | Passed | Optional live-eval hook is wired through the deterministic fake provider and validates prompt-contract behavior |
| `pnpm security:check` | Passed | #22 token, Host, Origin, CORS, mounted Flue router, and adapter bearer-token behavior |
| `pnpm evidence:privacy:check` | Passed | ADR-0006 Evidence Packet redaction, consent gate, scoped transcript snippets, redaction-before-truncation, prefix preservation |
| `pnpm e2e:cockpit` | Passed, 12/12 | Cockpit fixture flows: focus/deep link, bearer token, Watchtower UI, intervention/evidence inspector, coaching, Upgrades inbox, Pivot, dismissal memory |
| `pnpm ui:tsc` | Passed | UI TypeScript compile |
| `pnpm tsc` | Passed | Repo TypeScript compile |
| `pnpm ui:build` | Passed | Production UI build, bundled local Geist Sans/Mono assets, no CDN font dependency in build output |
| `cargo test alerting::tests::macos_native_notification_smoke --manifest-path src-tauri/Cargo.toml -- --ignored` | Passed | Native macOS notification smoke path executed |
| `pnpm dev:data:reset -- --dry-run` | Passed | Developer reset path lists local data targets without deletion |
| `CI=false pnpm tauri:build` | Passed | Release-mode Tauri app/binary builds on macOS arm64 |

## ADR invariant coverage

| ADR / invariant | Verification evidence |
| --- | --- |
| ADR-0002 Convergence detection architecture: maintained summary, evidence-backed status, no control over agents | `pnpm convergence:check`; `pnpm v1:baseline` |
| ADR-0003 Source identity follows Source + source-native session id | `pnpm events:check`; `pnpm adapter:check`; `pnpm source:check`; `pnpm v1:baseline` |
| ADR-0004 Normalized event shared core + preserved extras | `pnpm events:check`; `pnpm source:check`; `pnpm harness:fixtures` |
| ADR-0005 Self-improvement is propose-only | `pnpm upgrades:check`; `pnpm e2e:cockpit` |
| ADR-0006 Local-first structured Evidence Packets | `pnpm evidence:privacy:check`; final security review reported no blocking findings |
| ADR-0007 Tauri shell + local Flue Node engine + layered UX | `pnpm persistence:check`; `pnpm cockpit:check`; `pnpm alerting:check`; `CI=false pnpm tauri:build` |
| ADR-0008 Git watcher scoped to active sessions | `pnpm git:check`; Cockpit Watchtower E2E git lane assertions |
| ADR-0009 Session liveness and freshness risk | Claude adapter liveness checks; source smoke for Claude/Codex/Pi; Cockpit `.liv` freshness E2E assertions |
| ADR-0010 Loop-anchored convergence watches agent evidence | `pnpm convergence:check`; `pnpm loop:check` |
| ADR-0011 Judge cadence and cost control | `pnpm convergence:check`; Cockpit spend/status E2E assertions |
| ADR-0012 Watchtower Cockpit visual design | `pnpm e2e:cockpit`; `pnpm ui:build`; frontend correctness/design reviews reported no blocking findings |

## Source E2E parity

| Source | Adapter / normalization proof | Capability/freshness/Cockpit proof | Remaining risk |
| --- | --- | --- | --- |
| Claude | `pnpm adapter:check`; `LOOPWATCH_SOURCE_SMOKE=1 LOOPWATCH_SOURCE=claude ... pnpm harness:source-smoke` | `pnpm cockpit:check`; `pnpm e2e:cockpit`; Watchtower fixture asserts Claude capability badges, `.liv active`, watcher evidence, git/validation/cost/convergence lanes | No known blocking risk |
| Codex | `pnpm source:check`; `LOOPWATCH_SOURCE_SMOKE=1 LOOPWATCH_SOURCE=codex ... pnpm harness:source-smoke` | `pnpm e2e:cockpit`; Watchtower fixture asserts Codex row, ended liveness, unavailable tokens/cost where not faked | No known blocking risk |
| Pi | `pnpm source:check`; `LOOPWATCH_SOURCE_SMOKE=1 LOOPWATCH_SOURCE=pi ... pnpm harness:source-smoke` | `pnpm e2e:cockpit`; Watchtower fixture asserts Pi row, idle liveness, cost/tokens available when fixture provides real usage | No known blocking risk |

## Security and privacy

- #22 hardening uses release-blocking deterministic checks for configured bearer token, Host restriction, Origin restriction, CORS preflight, mounted Flue router protection, and Claude adapter bearer token propagation.
- ADR-0006 Evidence Packet checks prove default outbound payloads omit raw transcript/events, redactions cover the specified secret shapes, deep analyze requires explicit consent, transcript snippets are scoped to one evidence card, and redaction precedes compaction/truncation.
- Final Evidence privacy security review result: no blocking findings.
- Final Watchtower UI reviews: no blocking findings.

## Freshness and liveness

- Automated liveness/freshness coverage exists in adapter checks and UI tests.
- Cockpit now exposes `.liv active`, `.liv idle`, `.liv ended`, plus freshness text from the last source write.
- Synthetic source smoke for Claude/Codex/Pi passed. These fixture smokes prove adapter path correctness, not real machine p95 measurements.
- [INFERENCE] Real passive JSONL p95 freshness still depends on local source write/flush behavior; no Level 2 assisted-live path was required by the deterministic v1 fixture gates.

## LLM / eval evidence

- Deterministic prompt-contract fixture passed via `pnpm harness:fixtures`.
- Malformed prompt-contract fixture is rejected rather than silently skipped.
- Optional live-eval hook was exercised with the deterministic fake provider: `LOOPWATCH_LIVE_EVAL=1 LOOPWATCH_EVAL_PROVIDER=fake pnpm harness:eval:live` passed.
- No external paid/live model provider was configured in this run; no claim is made about a real provider call.

## UI / native evidence

- `pnpm e2e:cockpit` passed 12 Playwright tests including Watchtower repo+source groups, capabilities, `.liv` tags, full lane set, severity spectrum, live spend/status, intervention/evidence inspector, coaching, Upgrades inbox, Pivot, and dismissal memory.
- `pnpm ui:build` emitted local Geist Sans and Geist Mono font assets from `@fontsource`, satisfying the no-CDN font requirement.
- Native macOS notification smoke test passed through the ignored test that sends a real desktop notification path.

## Developer data reset

- Reset script: `pnpm dev:data:reset -- --dry-run`.
- Targets listed: `data`, `.loopwatch/test-results`, `.loopwatch/playwright-report`.
- Destructive reset requires `--confirm-delete-dev-data`; dry run performed no deletion.

## Issue comments

- Progress/evidence comments were posted during the v1 goal to feature issues and the v1 epic.
- Final summary comment will be posted to #1 with this dossier path and current release commits.
- Issues are intentionally left open for the user to close manually.

## Definition of done audit

- Issues #7-#17 and #22 have implementation commits and passing targeted verification.
- Baseline and per-slice verification harnesses exist and pass.
- Blocking reviewer findings observed during the goal were fixed before commit; final relevant reviews report no blocking findings.
- Deterministic eval/harness passes.
- Optional eval hook passes with the configured fake provider; no external provider was configured.
- Equal fixture E2E/source-smoke coverage exists for Claude, Codex, and Pi without faking unavailable capabilities.
- Security hardening is implemented and verified.
- Release binary build succeeds with `CI=false pnpm tauri:build`.
- Evidence comments have been posted; final epic comment remains part of release closeout.
- No GitHub issues were closed by agents.
- No known shipped TODO/no-op/mock-only product path remains in the scoped v1 contracts.
