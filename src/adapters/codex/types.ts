/** Codex Source Adapter constants and loose record shape. */

export const CODEX_SOURCE = 'codex';
export const CODEX_SESSIONS_ROOT = '~/.codex/sessions';
export const CODEX_CURSOR_DIR = 'data/cursors/codex';

/**
 * Codex writes JSONL envelopes shaped like `{ timestamp, type, payload }` in
 * nested `rollout-*.jsonl` files under the Codex sessions root. The checked-in synthetic fixture is a
 * reduced equivalent with some useful fields lifted top-level. Keep this loose:
 * ADR-0004 requires preserving source-native payloads across format drift.
 */
export interface CodexRecord {
  timestamp?: string;
  type?: string;
  payload?: unknown;
  source?: string;
  id?: string;
  session_id?: string;
  sessionId?: string;
  role?: string;
  cwd?: string;
  items?: unknown;
  tool?: unknown;
  [key: string]: unknown;
}
