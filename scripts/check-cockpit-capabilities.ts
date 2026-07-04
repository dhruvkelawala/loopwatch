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
  assert.equal(view.tokens, 33575, 'tokens = max cumulative total_token_usage.total_tokens');
  assert.equal(view.cost, null, 'Codex cost unavailable (not declared)');
});

check('Codex token total is the max even when same-timestamp samples are reordered', () => {
  const ts = at(45);
  const [view] = buildSessionViews(
    [
      ev({ source: 'codex', sessionId: 'c5', kind: 'session', timestamp: at(120), context: { repo: 'acme' } }),
      // Two cumulative samples at the SAME timestamp: the higher (later) total
      // must win regardless of the arbitrary payload-hash tiebreak order.
      ev({ source: 'codex', sessionId: 'c5', kind: 'usage', timestamp: ts, payload: { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 51000 } } } } }),
      ev({ source: 'codex', sessionId: 'c5', kind: 'usage', timestamp: ts, payload: { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 42000 } } } } }),
    ],
    NOW,
  );
  assert.equal(view.tokens, 51000, 'max cumulative total wins over an arbitrarily-ordered lower sample');
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

check('distinct Codex envelope records sharing a timestamp are not collapsed in dedupe', () => {
  const ts = at(90);
  const [view] = buildSessionViews(
    [
      ev({ source: 'codex', sessionId: 'c3', kind: 'session', timestamp: at(120), context: { repo: 'acme-api' } }),
      // Two distinct records with the SAME timestamp + kind + actor and no text.
      ev({ source: 'codex', sessionId: 'c3', kind: 'tool_call', actor: { type: 'agent' }, timestamp: ts, payload: { type: 'response_item', payload: { type: 'function_call', call_id: 'call_a', name: 'exec_command' }, timestamp: ts } }),
      ev({ source: 'codex', sessionId: 'c3', kind: 'tool_call', actor: { type: 'agent' }, timestamp: ts, payload: { type: 'response_item', payload: { type: 'function_call', call_id: 'call_b', name: 'apply_patch' }, timestamp: ts } }),
    ],
    NOW,
  );
  assert.equal(view.eventCount, 3, 'distinct same-timestamp Codex records are all retained');
});

check('Codex message text is unpacked from the envelope into the title', () => {
  const [view] = buildSessionViews(
    [
      ev({ source: 'codex', sessionId: 'c4', kind: 'message', actor: { type: 'user' }, timestamp: at(90), payload: { type: 'event_msg', payload: { type: 'user_message', message: 'Fix the failing auth test in packages/api' } } }),
      ev({ source: 'codex', sessionId: 'c4', kind: 'message', actor: { type: 'agent' }, timestamp: at(30), payload: { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'On it.' }] } } }),
    ],
    NOW,
  );
  assert.match(view.title, /Fix the failing auth test/, 'Codex user text drives the title, not a generic fallback');
  assert.match(view.goal, /Fix the failing auth test/, 'Codex user text drives the goal');
});

check('Codex + Pi tool commands are unpacked and routed into timeline lanes', () => {
  const [view] = buildSessionViews(
    [
      ev({ source: 'codex', sessionId: 't1', kind: 'message', actor: { type: 'user' }, timestamp: at(120), context: { repo: 'acme' }, payload: { type: 'event_msg', payload: { type: 'user_message', message: 'check git + run tests' } } }),
      // Codex exec_command with a git command (JSON-string arguments).
      ev({ source: 'codex', sessionId: 't1', kind: 'tool_call', actor: { type: 'agent' }, timestamp: at(90), payload: { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'git status --short' }) } } }),
      // Pi toolCall bash with a validation command.
      ev({ source: 'codex', sessionId: 't1', kind: 'tool_call', actor: { type: 'agent' }, timestamp: at(60), payload: { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'pnpm test' }) } } }),
    ],
    NOW,
  );
  const lane = (name: string) => view.lanes.find((l) => l.lane === name);
  assert.ok(lane('git')?.items.some((i) => i.detail.includes('git status')), 'Codex git command routes to the git lane');
  assert.ok(lane('validation')?.items.some((i) => i.detail.includes('pnpm test')), 'Codex validation command routes to the validation lane');
});

check('Pi toolCall + bashExecution commands are unpacked', () => {
  const [view] = buildSessionViews(
    [
      ev({ source: 'pi', sessionId: 'tp', kind: 'session', timestamp: at(120), context: { repo: 'loopwatch' } }),
      ev({ source: 'pi', sessionId: 'tp', kind: 'tool_call', actor: { type: 'agent' }, timestamp: at(90), payload: { type: 'message', id: 'a1', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'go test ./...' } }] } } }),
      ev({ source: 'pi', sessionId: 'tp', kind: 'tool_result', actor: { type: 'tool' }, timestamp: at(60), payload: { type: 'message', id: 'b1', message: { role: 'bashExecution', command: 'git diff --stat', output: '' } } }),
    ],
    NOW,
  );
  const lane = (name: string) => view.lanes.find((l) => l.lane === name);
  assert.ok(lane('validation')?.items.some((i) => i.detail.includes('go test')), 'Pi toolCall command routes to validation');
  assert.ok(lane('git')?.items.some((i) => i.detail.includes('git diff')), 'Pi bashExecution command routes to git');
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll Cockpit capability checks passed.');
