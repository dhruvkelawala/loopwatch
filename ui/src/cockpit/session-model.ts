import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildSessionViews, type LoopwatchEvent, type SessionConvergence, type SessionView, type TimelineItem, type TimelineLane } from '../loopwatch-events';

export type SessionGroup = { repo: string; sessions: SessionView[] };

export function useCockpitSessionModel(events: LoopwatchEvent[], convergenceSessions: SessionConvergence[] = []) {
  const nowMs = useNow(15_000);
  const convergenceBySession = useMemo(() => new Map(convergenceSessions.map((session) => [session.id, session])), [convergenceSessions]);
  const sessions = useMemo(() => applyConvergence(buildSessionViews(events, nowMs), convergenceBySession), [events, convergenceBySession, nowMs]);
  const [selectedId, setSelectedId] = useState(() => sessionIdFromLocation());
  const selectSession = useCallback((sessionId: string) => {
    setSelectedId(sessionId);
    writeSessionHash(sessionId);
  }, []);

  useEffect(() => {
    const focusSession = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: unknown }>).detail?.sessionId;
      if (typeof sessionId !== 'string' || sessionId.trim() === '') return;
      selectSession(sessionId);
    };
    const syncFromHash = () => {
      const sessionId = sessionIdFromLocation();
      if (sessionId) setSelectedId(sessionId);
    };

    window.addEventListener('loopwatch:focus-session', focusSession);
    window.addEventListener('hashchange', syncFromHash);
    return () => {
      window.removeEventListener('loopwatch:focus-session', focusSession);
      window.removeEventListener('hashchange', syncFromHash);
    };
  }, [selectSession]);

  useEffect(() => {
    if (sessions.length === 0) return;
    if (!selectedId || !sessions.some((session) => session.id === selectedId)) {
      setSelectedId(sessions[0].id);
    }
  }, [selectedId, sessions]);

  return {
    groupedSessions: groupSessionsByRepo(sessions),
    selected: sessions.find((session) => session.id === selectedId) ?? sessions[0],
    selectedId,
    selectSession,
  };
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(interval);
  }, [intervalMs]);
  return now;
}

function groupSessionsByRepo(sessions: SessionView[]): SessionGroup[] {
  const groups = new Map<string, SessionView[]>();
  for (const session of sessions) {
    const group = groups.get(session.repo) ?? [];
    group.push(session);
    groups.set(session.repo, group);
  }
  return [...groups.entries()]
    .map(([repo, group]) => ({ repo, sessions: group }))
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

function applyConvergence(sessions: SessionView[], convergenceBySession: Map<string, SessionConvergence>): SessionView[] {
  return sessions.map((session) => {
    const convergence = convergenceBySession.get(session.id);
    if (!convergence) return session;
    return {
      ...session,
      goal: convergence.summary.goal || session.goal,
      phase: convergence.status === 'calm' ? session.phase : convergence.evidence[0]?.signal.replaceAll('_', ' ') ?? session.phase,
      severity: convergence.status,
      convergence,
      lanes: withConvergenceLane(withGitLane(session.lanes, convergence), convergence),
    };
  });
}

function withGitLane(lanes: TimelineLane[], convergence: SessionConvergence): TimelineLane[] {
  if (!convergence.git) return lanes;
  const item: TimelineItem = {
    id: `${convergence.id}:git:${convergence.git.sampledAt}`,
    at: convergence.git.sampledAt,
    label: convergence.git.dirty ? 'Working tree changed' : 'Working tree clean',
    tone: convergence.git.dirty ? 'watch' : 'calm',
    detail: `${convergence.git.diff.files} files · +${convergence.git.diff.insertions}/-${convergence.git.diff.deletions} · ${convergence.git.validation.detail}`,
  };
  return lanes.map((lane) => (lane.lane === 'git' ? { lane: lane.lane, items: [item] } : lane));
}

function withConvergenceLane(lanes: TimelineLane[], convergence: SessionConvergence): TimelineLane[] {
  return lanes.map((lane) => {
    if (lane.lane !== 'convergence') return lane;
    return { lane: lane.lane, items: convergenceItems(convergence) };
  });
}

function convergenceItems(convergence: SessionConvergence): TimelineItem[] {
  if (convergence.evidence.length === 0) {
    return [
      {
        id: `${convergence.id}:convergence:calm`,
        at: convergence.judge.lastRunAt ?? convergence.lastEventAt,
        label: 'Convergence calm',
        tone: 'calm',
        detail: `Cheap judge found no concerns · ${convergence.spend.totalCalls} calls`,
      },
    ];
  }

  return convergence.evidence.map((evidence) => ({
    id: `${convergence.id}:convergence:${evidence.eventId}:${evidence.signal}`,
    at: evidence.timestamp,
    label: evidence.title,
    tone: evidence.severity,
    detail: evidence.detail,
  }));
}

function sessionIdFromLocation(): string {
  const raw = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('session');
  return raw?.trim() ?? '';
}

function writeSessionHash(sessionId: string) {
  const next = `session=${encodeURIComponent(sessionId)}`;
  if (window.location.hash.replace(/^#/, '') === next) return;
  window.history.replaceState(null, '', `#${next}`);
}
