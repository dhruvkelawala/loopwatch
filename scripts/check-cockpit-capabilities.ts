/**
 * Pure unit test for the Cockpit capability + usage projection (issue #11).
 * No server — drives the same `buildSessionViews` the UI uses.
 *
 * Proves the honest-badge contract:
 *   - each source shows badges for exactly what it declares (no fake parity);
 *   - Pi surfaces a direct $ cost + tokens; Codex surfaces cumulative tokens;
 *   - missing data is null → the UI renders "unavailable", never a faked zero;
 *   - a Pi branch inferred from git is flagged `branchInferred`.
 *
 * Run with: pnpm cockpit:caps:check
 */
import assert from 'node:assert/strict';

import { buildSessionViews, type LoopwatchEvent } from '../ui/src/loopwatch-events.js';

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${name}`);
    console.error(`      ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
}

const NOW = Date.parse('2026-06-24T20:30:00.000Z');
function at(secondsAgo: number): string {
  return new Date(NOW - secondsAgo * 1000).toISOString();
}

function ev(event: Partial<LoopwatchEvent> & Pick<LoopwatchEvent, 'source' | 'sessionId' | 'kind'>): LoopwatchEvent {
  return { timestamp: at(60), actor: { type: 'system' }, ...event } as LoopwatchEvent;
}

console.log('Cockpit capabilities + usage — unit checks\n');

check('Claude declares transcript + tools only; tokens/cost are unavailable (null)', () => {
  const [view] = buildSessionViews(
    [
      ev({ source: 'claude', sessionId: 's1', kind: 'message', actor: { type: 'user' }, timestamp: at(60), context: { repo: 'acme', gitBranch: 'main' }, payload: { message: { content: 'hi' } } }),
      ev({ source: 'claude', sessionId: 's1', kind: 'message', actor: { type: 'agent' }, timestamp: at(30), payload: { message: { content: [{ type: 'text', text: 'yo' }] } } }),
    ],
    NOW,
  );
  assert.deepEqual(view.capabilities, ['transcript', 'tools']);
  assert.equal(view.tokens, null, 'Claude tokens unavailable (not declared)');
  assert.equal(view.cost, null, 'Claude cost unavailable (not declared)');
  assert.equal(view.branchInferred, false, 'Claude reports its own branch');
});

check('Pi surfaces a direct $ cost + tokens, plus diagnostics; inferred branch flagged', () => {
  const [view] = buildSessionViews(
    [
      ev({ source: 'pi', sessionId: 'p1', kind: 'session', timestamp: at(120), context: { cwd: '/x', repo: 'loopwatch', gitBranch: 'feat/x', branchInferred: true } }),
      ev({ source: 'pi', sessionId: 'p1', kind: 'message', actor: { type: 'user' }, timestamp: at(110), context: { repo: 'loopwatch', gitBranch: 'feat/x', branchInferred: true }, payload: { message: { role: 'user', content: [{ type: 'text', text: 'go' }] } } }),
      ev({ source: 'pi', sessionId: 'p1', kind: 'message', actor: { type: 'agent' }, timestamp: at(60), context: { repo: 'loopwatch', gitBranch: 'feat/x', branchInferred: true }, payload: { message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { input: 1000, output: 200, cost: { total: 0.0123 } } } } }),
      ev({ source: 'pi', sessionId: 'p1', kind: 'message', actor: { type: 'agent' }, timestamp: at(30), context: { repo: 'loopwatch', gitBranch: 'feat/x', branchInferred: true }, payload: { message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], usage: { input: 500, output: 100, cost: { total: 0.0077 } } } } }),
    ],
    NOW,
  );
  assert.deepEqual(view.capabilities, ['transcript', 'tools', 'tokens', 'cost', 'diagnostics']);
  assert.equal(view.tokens, 1800, 'tokens = sum of input+output (1000+200+500+100)');
  assert.ok(Math.abs((view.cost ?? 0) - 0.02) < 1e-9, 'cost = sum of message costs (0.0123+0.0077)');
  assert.equal(view.branch, 'feat/x');
  assert.equal(view.branchInferred, true, 'git-inferred branch is flagged honest');
});

check('Codex surfaces cumulative tokens from token_count; cost not declared', () => {
  const [view] = buildSessionViews(
    [
      ev({ source: 'codex', sessionId: 'c1', kind: 'session', timestamp: at(120), context: { repo: 'acme-api', gitBranch: 'fix/x' } }),
      ev({ source: 'codex', sessionId: 'c1', kind: 'usage', timestamp: at(90), payload: { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 9882 } } } } }),
      ev({ source: 'codex', sessionId: 'c1', kind: 'usage', timestamp: at(30), payload: { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 33575 } } } } }),
    ],
    NOW,
  );
  assert.deepEqual(view.capabilities, ['transcript', 'tools', 'tokens']);
  assert.equal(view.tokens, 33575, 'tokens = latest cumulative total_token_usage.total_tokens');
  assert.equal(view.cost, null, 'Codex cost unavailable (not declared)');
});

check('Codex with no token_count info renders tokens as unavailable (null), never faked', () => {
  const [view] = buildSessionViews(
    [
      ev({ source: 'codex', sessionId: 'c2', kind: 'session', timestamp: at(60), context: { repo: 'infra' } }),
      ev({ source: 'codex', sessionId: 'c2', kind: 'usage', timestamp: at(30), payload: { type: 'event_msg', payload: { type: 'token_count', info: null } } }),
    ],
    NOW,
  );
  assert.deepEqual(view.capabilities, ['transcript', 'tools', 'tokens']);
  assert.equal(view.tokens, null, 'declared but unobserved → unavailable, not 0');
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll Cockpit capability checks passed.');
