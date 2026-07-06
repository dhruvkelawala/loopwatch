import type { SessionView } from '../loopwatch-events.js';

export type UpgradeCard = {
  id: string;
  type: 'upgrade';
  title: string;
  evidence: string;
  suggestedUpgrade: string;
  acceptanceCriteria: string[];
  proposalOnly: true;
};

const CAPABILITY_GAP_THRESHOLD = 2;
const UNKNOWN_EVENT_THRESHOLD = 2;
const KNOWN_EVENT_KINDS = new Set(['message', 'tool_call', 'tool_result', 'usage', 'session', 'diagnostic', 'git', 'system']);

export function upgradeCardsForSessions(sessions: readonly SessionView[]): UpgradeCard[] {
  return [...capabilityGapCards(sessions), ...unknownEventKindCards(sessions)].sort((a, b) => a.title.localeCompare(b.title));
}

function capabilityGapCards(sessions: readonly SessionView[]): UpgradeCard[] {
  const gaps = new Map<string, { source: string; capability: string; details: Set<string>; sessionIds: Set<string> }>();

  for (const session of sessions) {
    for (const capability of session.capabilityBadges) {
      if (capability.state !== 'unavailable') continue;
      const key = `${session.source}:${capability.key}`;
      const gap = gaps.get(key) ?? { source: session.source, capability: capability.label, details: new Set(), sessionIds: new Set() };
      gap.details.add(capability.detail);
      gap.sessionIds.add(session.id);
      gaps.set(key, gap);
    }
  }

  return [...gaps.entries()]
    .filter(([, gap]) => gap.sessionIds.size >= CAPABILITY_GAP_THRESHOLD)
    .map(([key, gap]) => ({
      id: `upgrade:capability:${slug(key)}`,
      type: 'upgrade' as const,
      title: `${gap.source} ${gap.capability} capability gap`,
      evidence: `${gap.sessionIds.size} sessions reported ${gap.capability} unavailable: ${[...gap.details].join('; ')}.`,
      suggestedUpgrade: `Add real ${gap.capability} evidence to the ${gap.source} Source Adapter, or keep the badge explicitly unavailable if the source cannot provide it without faking parity.`,
      acceptanceCriteria: [
        `${gap.source} fixture sessions expose ${gap.capability} as available only when real source data is present.`,
        'Capability badges continue to label unavailable data honestly instead of filling fake defaults.',
        'The upgrade remains human-approved; Loopwatch does not install hooks, change settings, or edit itself.',
      ],
      proposalOnly: true,
    }));
}

function unknownEventKindCards(sessions: readonly SessionView[]): UpgradeCard[] {
  const unknownKinds = new Map<string, { kind: string; sources: Set<string>; sessionIds: Set<string> }>();

  for (const session of sessions) {
    for (const event of session.events) {
      if (KNOWN_EVENT_KINDS.has(event.kind)) continue;
      const entry = unknownKinds.get(event.kind) ?? { kind: event.kind, sources: new Set(), sessionIds: new Set() };
      entry.sources.add(session.source);
      entry.sessionIds.add(session.id);
      unknownKinds.set(event.kind, entry);
    }
  }

  return [...unknownKinds.values()]
    .filter((entry) => entry.sessionIds.size >= UNKNOWN_EVENT_THRESHOLD)
    .map((entry) => ({
      id: `upgrade:unknown-kind:${slug(entry.kind)}`,
      type: 'upgrade' as const,
      title: `Unknown event kind: ${entry.kind}`,
      evidence: `${entry.sessionIds.size} sessions preserved unknown event kind "${entry.kind}" from ${[...entry.sources].join(', ')}.`,
      suggestedUpgrade: `Decide whether "${entry.kind}" should become a first-class Loopwatch Event kind, timeline lane mapping, or source-native payload field.`,
      acceptanceCriteria: [
        `Fixtures with "${entry.kind}" are parsed intentionally and still preserve source-native payload fields.`,
        `Cockpit labels "${entry.kind}" with a deliberate lane/detail instead of an accidental fallback.`,
        'The upgrade remains propose-only; Loopwatch never opens PRs, edits code, changes settings, or installs anything automatically.',
      ],
      proposalOnly: true,
    }));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}
