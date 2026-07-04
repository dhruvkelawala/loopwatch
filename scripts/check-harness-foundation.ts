import assert from 'node:assert/strict';

import { newCursor } from '../src/adapters/claude/cursor.js';
import { mapClaudeRecord, sessionIdFromPath } from '../src/adapters/claude/map.js';
import { discoverTranscripts, readNewRecords } from '../src/adapters/claude/transcript.js';
import { LoopwatchEventSchema } from '../src/events.js';
import { validateCockpitEngineFixture } from '../tests/support/cockpit-fixture.js';
import { fixturePath } from '../tests/support/fixtures.js';
import { assertDeterministicPromptContract, loadPromptContractFixture } from '../tests/support/prompt-contracts.js';
import { loadAllSourceTranscriptFixtures } from '../tests/support/source-fixtures.js';

let failures = 0;

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

console.log('Harness foundation — deterministic checks\n');

await check('synthetic source transcript fixtures cover Claude, Codex, and Pi with validated native shapes', async () => {
  const fixtures = await loadAllSourceTranscriptFixtures();
  assert.deepEqual(
    fixtures.map((fixture) => fixture.source).sort(),
    ['claude', 'codex', 'pi'],
  );
  for (const fixture of fixtures) {
    assert.ok(fixture.records.length >= 3, `${fixture.source} fixture should contain a small multi-event session`);
    assert.ok(
      fixture.relativePath.every((segment) => !segment.includes('..') && !segment.startsWith('/')),
      `${fixture.source} fixture path must stay inside tests/fixtures`,
    );
  }
});

await check('Claude source fixture is readable by the real transcript parser and preserves source-native payload', async () => {
  const root = fixturePath('source-transcripts', 'claude', 'projects');
  const transcripts = await discoverTranscripts(root);
  assert.equal(transcripts.length, 1);

  const transcript = transcripts[0];
  const read = await readNewRecords(transcript, newCursor(transcript));
  assert.equal(read.records.length, 3);
  assert.ok(read.bytesRead > 0);

  const event = LoopwatchEventSchema.parse(mapClaudeRecord(read.records[1], { fileSessionId: sessionIdFromPath(transcript) }));
  assert.equal(event.source, 'claude');
  assert.equal(event.sessionId, 'claude-alpha-session');
  assert.equal(event.kind, 'tool_call');
  assert.equal(event.actor.type, 'agent');
  assert.equal((event.payload as Record<string, unknown>).syntheticMarker, 'claude-source-fixture');
});

await check('prompt-contract fixture validates and deterministic fake judge output matches exactly', async () => {
  const contract = await loadPromptContractFixture('prompt-contracts', 'convergence-failing-validation.valid.json');
  const output = assertDeterministicPromptContract(contract);
  assert.equal(output.verdict, 'fail');
  assert.equal(output.findings[0]?.evidenceEventIds[0], 'eval-fixture-tool-1');
});

await check('malformed prompt-contract fixture is rejected rather than silently skipped', async () => {
  await assert.rejects(
    () => loadPromptContractFixture('prompt-contracts', 'malformed-missing-verdict.json'),
    /verdict/,
  );
});

await check('Cockpit mocked-engine fixture satisfies the endpoint contracts used by Playwright', () => {
  validateCockpitEngineFixture();
});

if (failures > 0) {
  console.error(`\n${failures} harness foundation check(s) failed.`);
  process.exit(1);
}

console.log('\nAll harness foundation checks passed.');
