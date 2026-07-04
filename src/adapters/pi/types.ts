/** Pi Source Adapter constants and loose record shape. */

export const PI_SOURCE = 'pi';
export const PI_SESSIONS_ROOT = '~/.pi/agent/sessions';
export const PI_CURSOR_DIR = 'data/cursors/pi';

/**
 * Pi writes typed JSONL events with direct model usage/cost details. Older
 * synthetic fixtures use `{ source:"pi", event, ts }`; real Pi records use
 * `{ type, timestamp }`. Keep both accepted and preserve every native field.
 */
export interface PiRecord {
  source?: string;
  type?: string;
  event?: string;
  id?: string;
  sessionId?: string;
  timestamp?: string;
  ts?: string;
  cwd?: string;
  worktree?: unknown;
  actor?: unknown;
  message?: unknown;
  validation?: unknown;
  [key: string]: unknown;
}
