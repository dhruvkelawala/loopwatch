import assert from 'node:assert/strict';

import { LoopwatchEventSchema, type LoopwatchEvent, type LoopwatchEventInput } from '../src/events.js';
import { buildSessionViews } from '../ui/src/loopwatch-events.js';
import { upgradeCardsForSessions, type UpgradeCard } from '../ui/src/cockpit/upgrades.js';

let failures = 0;

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(`      ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
}

const baseMs = Date.parse('2026-07-04T12:00:00.000Z');

function iso(offsetMs: number): string {
  return new Date(baseMs + offsetMs).toISOString();
}

type EventInput = {
  id: string;
  sessionId: string;
  atMs: number;
  kind: string;
  actor: LoopwatchEvent['actor'];
  payload?: unknown;
};

function event(input: EventInput): LoopwatchEvent {
  const record: LoopwatchEventInput = {
    source: 'claude',
    sessionId: input.sessionId,
    timestamp: iso(input.atMs),
    kind: input.kind,
    actor: input.actor,
    context: {
      cwd: `/Users/d/dev/loopwatch/${input.sessionId}`,
      repo: 'loopwatch',
      gitBranch: `issue-17-${input.sessionId}`,
    },
    payload: {
      id: input.id,
      ...recordPayload(input.payload),
    },
  };
  return LoopwatchEventSchema.parse(record);
}

function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : { content: String(value ?? '') };
}

function userMessage(id: string, sessionId: string, atMs: number, text: string): LoopwatchEvent {
  return event({ id, sessionId, atMs, kind: 'message', actor: { type: 'user' }, payload: { content: text } });
}

function toolCall(id: string, sessionId: string, atMs: number, command: string): LoopwatchEvent {
  return event({
    id,
    sessionId,
    atMs,
    kind: 'tool_call',
    actor: { type: 'agent', name: 'bash' },
    payload: { toolName: 'bash', command },
  });
}

function usage(id: string, sessionId: string, atMs: number, totalTokens: number): LoopwatchEvent {
  return event({ id, sessionId, atMs, kind: 'usage', actor: { type: 'system' }, payload: { usage: { totalTokens } } });
}

function unknownKind(id: string, sessionId: string, atMs: number): LoopwatchEvent {
  return event({
    id,
    sessionId,
    atMs,
    kind: 'assistant_event.delta',
    actor: { type: 'system' },
    payload: { nativeType: 'assistant_event.delta', fragment: 'assistant streamed an event shape Loopwatch does not parse yet' },
  });
}

function sessionsForUpgradeEvidence(sessionIds: readonly string[]) {
  return buildSessionViews(
    sessionIds.flatMap((sessionId, index) => [
      userMessage(`${sessionId}-goal`, sessionId, index * 10_000, `Ship issue #17 evidence fixture ${index + 1}.`),
      toolCall(`${sessionId}-tool`, sessionId, index * 10_000 + 1_000, 'pnpm e2e:cockpit'),
      usage(`${sessionId}-usage`, sessionId, index * 10_000 + 2_000, 1_250 + index),
      unknownKind(`${sessionId}-unknown`, sessionId, index * 10_000 + 3_000),
    ]),
    baseMs + 60_000,
  );
}

function sessionsWithRepeatedCanonicalKinds(sessionIds: readonly string[]) {
  return buildSessionViews(
    sessionIds.flatMap((sessionId, index) => [
      userMessage(`${sessionId}-goal`, sessionId, index * 10_000, `Check canonical event-kind evidence fixture ${index + 1}.`),
      event({
        id: `${sessionId}-session`,
        sessionId,
        atMs: index * 10_000 + 1_000,
        kind: 'session',
        actor: { type: 'system' },
        payload: { phase: 'ended', nativeType: 'session' },
      }),
      event({
        id: `${sessionId}-diagnostic`,
        sessionId,
        atMs: index * 10_000 + 2_000,
        kind: 'diagnostic',
        actor: { type: 'system' },
        payload: { level: 'info', message: 'adapter preserved a diagnostic event', nativeType: 'diagnostic' },
      }),
      event({
        id: `${sessionId}-git`,
        sessionId,
        atMs: index * 10_000 + 3_000,
        kind: 'git',
        actor: { type: 'system' },
        payload: { branch: `issue-17-${sessionId}`, status: 'clean', nativeType: 'git' },
      }),
    ]),
    baseMs + 60_000,
  );
}

function cardByTitle(cards: readonly UpgradeCard[], title: RegExp): UpgradeCard {
  const card = cards.find((candidate) => title.test(candidate.title));
  assert.ok(card, `missing upgrade card matching ${title}; got ${cards.map((candidate) => candidate.title).join(', ')}`);
  return card;
}

function assertProposalOnly(card: UpgradeCard): void {
  assert.equal(card.type, 'upgrade');
  assert.equal(card.proposalOnly, true, `${card.title} must be marked proposalOnly`);
  assert.ok(card.suggestedUpgrade.trim().length > 0, `${card.title} must include a suggested upgrade`);
  assert.ok(card.acceptanceCriteria.length > 0, `${card.title} must include acceptance criteria`);
  const combinedCopy = [card.title, card.evidence, card.suggestedUpgrade, ...card.acceptanceCriteria].join('\n');
  assert.doesNotMatch(combinedCopy, /Loopwatch will (?:edit|install|open (?:a )?PR|change settings)/i, `${card.title} must not promise autonomous Loopwatch action`);
  assert.match(combinedCopy, /(?:proposal|propose-only|human-approved|does not|never)/i, `${card.title} must make human approval / propose-only behavior explicit`);
}

console.log('Upgrades inbox — deterministic model checks\n');

await check('a single blind spot stays below the evidence threshold', () => {
  const cards = upgradeCardsForSessions(sessionsForUpgradeEvidence(['single-upgrade-gap']));

  assert.equal(cards.some((card) => /capability gap/i.test(card.title)), false, 'one unavailable capability observation must not become an Upgrade Card');
  assert.equal(cards.some((card) => /Unknown event kind/i.test(card.title)), false, 'one unknown event observation must not become an Upgrade Card');
});

await check('repeated canonical session, diagnostic, and git events do not produce unknown-kind proposal cards', () => {
  const cards = upgradeCardsForSessions(sessionsWithRepeatedCanonicalKinds(['canonical-kind-one', 'canonical-kind-two']));
  const unknownKindTitles = cards.filter((card) => /^Unknown event kind:/i.test(card.title)).map((card) => card.title);

  assert.deepEqual(unknownKindTitles, [], `canonical session/diagnostic/git events must not become Unknown event kind cards; got ${unknownKindTitles.join(', ')}`);
});

await check('repeated capability gaps produce a proposal card with source, count, and capability evidence', () => {
  const cards = upgradeCardsForSessions(sessionsForUpgradeEvidence(['capability-gap-one', 'capability-gap-two']));
  const card = cardByTitle(cards, /Claude cost capability gap/);

  assert.match(card.evidence, /2 sessions reported cost unavailable/i);
  assert.match(card.evidence, /Claude adapter does not provide direct cost/i);
  assert.match(card.suggestedUpgrade, /real cost evidence/i);
  assert.match(card.suggestedUpgrade, /Claude Source Adapter/i);
  assert.ok(card.acceptanceCriteria.some((criterion) => /available only when real source data is present/i.test(criterion)), 'acceptance criteria guard against fake defaults');
  assertProposalOnly(card);
});

await check('repeated unknown event kinds produce a proposal card with event-kind evidence', () => {
  const cards = upgradeCardsForSessions(sessionsForUpgradeEvidence(['unknown-kind-one', 'unknown-kind-two']));
  const card = cardByTitle(cards, /Unknown event kind: assistant_event\.delta/);

  assert.match(card.evidence, /2 sessions preserved unknown event kind "assistant_event\.delta" from Claude/i);
  assert.match(card.suggestedUpgrade, /first-class Loopwatch Event kind|timeline lane mapping|source-native payload field/i);
  assert.ok(card.acceptanceCriteria.some((criterion) => /still preserve source-native payload fields/i.test(criterion)), 'acceptance criteria keep unknown native payloads from being dropped');
  assertProposalOnly(card);
});

if (failures > 0) {
  console.error(`\n${failures} upgrades inbox check(s) failed.`);
  process.exit(1);
}

console.log('\nAll upgrades inbox checks passed.');
