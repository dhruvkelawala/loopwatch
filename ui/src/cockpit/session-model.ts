import { useEffect, useMemo, useState } from 'react';
import { buildSessionViews, type LoopwatchEvent, type SessionView } from '../loopwatch-events';

export type SessionGroup = { repo: string; sessions: SessionView[] };

export function useCockpitSessionModel(events: LoopwatchEvent[]) {
  const nowMs = useNow(15_000);
  const sessions = useMemo(() => buildSessionViews(events, nowMs), [events, nowMs]);
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    if (sessions.length === 0) {
      if (selectedId) setSelectedId('');
      return;
    }
    if (!selectedId || !sessions.some((session) => session.id === selectedId)) {
      setSelectedId(sessions[0].id);
    }
  }, [selectedId, sessions]);

  return {
    groupedSessions: groupSessionsByRepo(sessions),
    selected: sessions.find((session) => session.id === selectedId) ?? sessions[0],
    selectedId,
    selectSession: setSelectedId,
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
