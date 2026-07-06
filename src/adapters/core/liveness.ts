import { sessionKey, type SessionIdentity } from '../../events.js';

/**
 * Session liveness model (ADR-0009).
 *
 * Liveness is inferred primarily from **file-append recency** — the universal
 * signal every source provides — sharpened by an explicit end signal when a
 * source exposes one. Claude Code emits no session-end record, so for this
 * adapter "ended" is reached purely by the append-recency thresholds; the
 * explicit-end hook is kept for sources (and a future user "archive" action)
 * that can provide one.
 *
 * Thresholds are generous and configurable on purpose: the freshness spike
 * found Claude sessions idle for hours and resume, so a short "ended" timeout
 * would wrongly archive resumable sessions.
 */
export type LivenessState = 'active' | 'idle' | 'ended';

export interface LivenessThresholds {
  /** active → idle once no append for this long. */
  idleAfterMs: number;
  /** idle → ended once no append for this long. */
  endedAfterMs: number;
}

export const DEFAULT_LIVENESS: LivenessThresholds = {
  idleAfterMs: 5 * 60_000, // 5 minutes
  endedAfterMs: 30 * 60_000, // 30 minutes
};

/** Pure liveness decision from the time since the last observed append. */
export function livenessFor(
  lastAppendAt: number,
  now: number,
  thresholds: LivenessThresholds,
  options: { ended?: boolean } = {},
): LivenessState {
  if (options.ended) return 'ended';
  const age = now - lastAppendAt;
  if (age >= thresholds.endedAfterMs) return 'ended';
  if (age >= thresholds.idleAfterMs) return 'idle';
  return 'active';
}

export interface LivenessTransition {
  key: string;
  identity: SessionIdentity;
  from: LivenessState;
  to: LivenessState;
}

interface SessionLiveness {
  identity: SessionIdentity;
  lastAppendAt: number;
  state: LivenessState;
  ended: boolean;
}

/**
 * Tracks per-session liveness across polls and reports state transitions.
 * `observe()` records an append; `poll(now)` recomputes every tracked session
 * and returns only the sessions whose state changed.
 */
export class LivenessTracker {
  private readonly sessions = new Map<string, SessionLiveness>();

  constructor(private readonly thresholds: LivenessThresholds = DEFAULT_LIVENESS) {}

  /** Record that a session appended at `at` (defaults to now). */
  observe(identity: SessionIdentity, at: number = Date.now()): void {
    const key = sessionKey(identity);
    const existing = this.sessions.get(key);
    if (existing) {
      existing.lastAppendAt = Math.max(existing.lastAppendAt, at);
      // A fresh append revives the session, including one explicitly ended /
      // archived: real new activity overrides a prior end signal (parity with
      // the threshold path, which already revives on a later append).
      existing.ended = false;
    } else {
      this.sessions.set(key, { identity, lastAppendAt: at, state: 'active', ended: false });
    }
  }

  /** Mark a session ended via an explicit signal (source SessionEnd / user archive). */
  markEnded(identity: SessionIdentity, at: number = Date.now()): void {
    const key = sessionKey(identity);
    const existing = this.sessions.get(key);
    if (existing) existing.ended = true;
    // Stamp lastAppendAt with the end time (not 0) so the poll-time retention
    // window applies; a 0 sentinel would make eviction fire on the next poll.
    else this.sessions.set(key, { identity, lastAppendAt: at, state: 'active', ended: true });
  }

  state(identity: SessionIdentity): LivenessState | undefined {
    return this.sessions.get(sessionKey(identity))?.state;
  }

  /** Recompute all sessions; return the transitions that occurred this poll. */
  poll(now: number = Date.now()): LivenessTransition[] {
    const transitions: LivenessTransition[] = [];
    for (const [key, session] of this.sessions) {
      const next = livenessFor(session.lastAppendAt, now, this.thresholds, { ended: session.ended });
      if (next !== session.state) {
        transitions.push({ key, identity: session.identity, from: session.state, to: next });
        session.state = next;
      }
      // Bound memory in a long-running adapter: drop sessions that have been
      // ended for well past the threshold. observe() re-creates the entry on a
      // later append, so eviction is safe — the session just reappears fresh.
      if (next === 'ended' && now - session.lastAppendAt >= this.thresholds.endedAfterMs * 2) {
        this.sessions.delete(key);
      }
    }
    return transitions;
  }
}
