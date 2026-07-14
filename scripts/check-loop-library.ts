/**
 * Deterministic Loop Library checks for issue #13.
 *
 * This script stays local and recommendation-only: no browsers, no live LLMs,
 * and no loop action/verification commands are run. It exercises the public
 * Loop Library module and the app-owned loop endpoints with fixture storage.
 */

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import app from '../src/app.js';
import {
  addUserLoop,
  loadLoopLibrary,
  LoopLibraryResponseSchema,
  LoopRecommendationResponseSchema,
  LoopSchema,
  recommendLoop,
  STARTER_LOOPS,
  type Loop,
} from '../src/loops.js';

let failures = 0;

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

const AddLoopResponseSchema = z.object({
  ok: z.literal(true),
  loop: LoopSchema,
});

const InvalidRequestResponseSchema = z.object({
  ok: z.literal(false),
  error: z.literal('invalid_request'),
  issues: z.array(z.unknown()).optional(),
});

const markerExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

async function assertNoLoopCommandRan(markerPath: string): Promise<void> {
  const exists = await markerExists(markerPath);
  assert.equal(exists, false, 'loop action or verification command created the execution marker');
}

function commandThatWouldCreateMarker(markerPath: string, label: string): string {
  return `node -e "require('node:fs').writeFileSync(process.argv[1], process.argv[2])" ${JSON.stringify(markerPath)} ${JSON.stringify(label)}`;
}

function userLoop(input: {
  id: string;
  title: string;
  summary: string;
  trigger: string;
  action: string;
  verification: string;
  memory: string;
  stopEvidence: string;
  tags: string[];
}): Loop {
  return LoopSchema.parse({
    id: input.id,
    title: input.title,
    summary: input.summary,
    trigger: input.trigger,
    action: input.action,
    verification: input.verification,
    memory: input.memory,
    stopCondition: {
      evidence: input.stopEvidence,
      observable: true,
    },
    tags: input.tags,
  });
}

function loopById(loops: Loop[], id: string): Loop {
  const loop = loops.find((candidate) => candidate.id === id);
  assert.ok(loop, `expected loop ${id} to exist`);
  return loop;
}

function engineRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Request(`http://127.0.0.1:3000${path}`, { ...init, headers });
}


async function expectJson<ResponseBody>(response: Response, status: number, schema: z.ZodType<ResponseBody>): Promise<ResponseBody> {
  if (response.status !== status) {
    assert.fail(`expected HTTP ${status} but got ${response.status}: ${await response.text()}`);
  }
  const raw = await response.json();
  return schema.parse(raw);
}

function assertCopyPromptIsUsable(task: string, loop: Loop, copyPrompt: string): void {
  assert.match(copyPrompt, new RegExp(`Task: ${escapeRegExp(task)}`), 'copy prompt must include the exact task');
  assert.match(copyPrompt, new RegExp(`Stop condition: ${escapeRegExp(loop.stopCondition.evidence)}`), 'copy prompt must include the selected loop stop condition');
  assert.match(copyPrompt, /Trigger:/, 'copy prompt must include the trigger');
  assert.match(copyPrompt, /Action:/, 'copy prompt must include the action');
  assert.match(copyPrompt, /Verification:/, 'copy prompt must include the verification');
  assert.match(copyPrompt, /Memory:/, 'copy prompt must include the memory');
  assert.match(copyPrompt, /Loopwatch does not execute this loop/, 'copy prompt must state that Loopwatch is recommendation-only');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

console.log('Loop Library — deterministic issue #13 checks\n');

const tempRoot = await mkdtemp(join(tmpdir(), 'lw-loop-library-'));
const previousUserLoopsPath = process.env.LOOPWATCH_USER_LOOPS_PATH;
try {
  const moduleUserLoopsPath = join(tempRoot, 'module-user-loops.json');
  const endpointUserLoopsPath = join(tempRoot, 'endpoint-user-loops.json');
  const commandMarkerPath = join(tempRoot, 'loop-command-was-executed');

  const migrationLoop = userLoop({
    id: 'database-migration-safety',
    title: 'Database Migration Safety',
    summary: 'Plan, apply, and prove a reversible database migration without corrupting tenant data.',
    trigger: 'Use when work changes schemas, migrations, rollback paths, tenant data, or database safety.',
    action: 'Draft the migration, exercise upgrade and rollback on fixture data, and keep application reads compatible during the cutover.',
    verification: 'Run migration up/down checks against a disposable database and assert tenant rows survive the round trip.',
    memory: 'Record migration id, rollback command, affected tables, fixture data, and before/after row counts.',
    stopEvidence: 'The migration applies and rolls back on fixture tenant data with row counts and compatibility checks preserved.',
    tags: ['database', 'migration', 'postgres', 'tenant', 'rollback', 'schema', 'data', 'safety'],
  });

  const poisonLoop = userLoop({
    id: 'poison-command-loop',
    title: 'Poison Command Loop',
    summary: 'Fixture loop whose command-looking strings must remain inert recommendations.',
    trigger: 'Use for command-execution safety checks only.',
    action: commandThatWouldCreateMarker(commandMarkerPath, 'action'),
    verification: commandThatWouldCreateMarker(commandMarkerPath, 'verification'),
    memory: 'If the marker file exists, Loopwatch executed a loop command and violated recommendation-only behavior.',
    stopEvidence: 'The marker file is absent after recommendation and endpoint calls.',
    tags: ['poison', 'command', 'execution', 'recommendation'],
  });

  const { verification: _invalidVerification, ...invalidPoisonLoop } = poisonLoop;

  await check('starter loops all carry required Loop fields and observable stop conditions', () => {
    assert.ok(STARTER_LOOPS.length >= 3, 'starter library must include multiple curated loops');
    for (const loop of STARTER_LOOPS) {
      const parsed = LoopSchema.parse(loop);
      assert.ok(parsed.trigger.trim(), `${parsed.id} is missing trigger`);
      assert.ok(parsed.action.trim(), `${parsed.id} is missing action`);
      assert.ok(parsed.verification.trim(), `${parsed.id} is missing verification`);
      assert.ok(parsed.memory.trim(), `${parsed.id} is missing memory`);
      assert.ok(parsed.stopCondition.evidence.trim(), `${parsed.id} is missing stop-condition evidence`);
      assert.equal(parsed.stopCondition.observable, true, `${parsed.id} stop condition must be observable in v1 starter loops`);
    }

    const { verification: _missingVerification, ...missingRequiredField } = STARTER_LOOPS[0]!;
    assert.equal(LoopSchema.safeParse(missingRequiredField).success, false, 'LoopSchema must reject loops missing a required field');
  });

  await check('user loops load from and persist to an explicit local JSON storage path', async () => {
    await writeFile(moduleUserLoopsPath, `${JSON.stringify([migrationLoop], null, 2)}\n`);

    const initial = await loadLoopLibrary({ userLoopsPath: moduleUserLoopsPath });
    LoopLibraryResponseSchema.parse(initial);
    assert.deepEqual(initial.user.map((loop) => loop.id), ['database-migration-safety']);
    assert.ok(initial.loops.some((loop) => loop.id === 'vertical-feature-slice'), 'starter loops must still be present');

    await addUserLoop(poisonLoop, { userLoopsPath: moduleUserLoopsPath });
    const rawStored = JSON.parse(await readFile(moduleUserLoopsPath, 'utf8'));
    const stored = z.array(LoopSchema).parse(rawStored);
    assert.deepEqual(stored.map((loop) => loop.id), ['database-migration-safety', 'poison-command-loop']);

    const reloaded = await loadLoopLibrary({ userLoopsPath: moduleUserLoopsPath });
    assert.deepEqual(reloaded.user.map((loop) => loop.id), ['database-migration-safety', 'poison-command-loop']);
    await assertNoLoopCommandRan(commandMarkerPath);
  });

  await check('recommendation selects a relevant loop instead of an irrelevant starter', async () => {
    const library = await loadLoopLibrary({ userLoopsPath: moduleUserLoopsPath });
    const bugTask = 'Debug a flaky regression where transcript replay throws after an adapter append';
    const bugCard = recommendLoop(bugTask, library.loops);
    assert.equal(bugCard.loop.id, 'diagnose-reproduce-fix');
    assert.ok(bugCard.score > 0, 'bug task should have positive relevance score');

    const migrationTask = 'Audit postgres tenant database migration rollback safety before shipping schema changes';
    const migrationCard = recommendLoop(migrationTask, library.loops);
    assert.equal(migrationCard.loop.id, 'database-migration-safety');
    assert.ok(migrationCard.score > bugCard.score, 'specific user loop should outrank generic starter loops for matching database task terms');
    await assertNoLoopCommandRan(commandMarkerPath);
  });

  await check('Coaching Card copy prompt contains the task, selected loop, stop condition, and recommendation-only guardrail', async () => {
    const library = await loadLoopLibrary({ userLoopsPath: moduleUserLoopsPath });
    const task = 'Audit postgres tenant database migration rollback safety before shipping schema changes';
    const card = recommendLoop(task, library.loops);
    const expectedLoop = loopById(library.loops, 'database-migration-safety');

    assert.equal(card.type, 'coaching');
    assert.equal(card.recommendationOnly, true);
    assert.equal(card.task, task);
    assert.equal(card.loop.id, expectedLoop.id);
    assertCopyPromptIsUsable(task, expectedLoop, card.copyPrompt);
    await assertNoLoopCommandRan(commandMarkerPath);
  });

  await check('loop endpoints expose the same recommendation-only library behavior without executing loop commands', async () => {
    process.env.LOOPWATCH_USER_LOOPS_PATH = endpointUserLoopsPath;

    const posted = await app.fetch(engineRequest('/loopwatch/loops', {
      method: 'POST',
      body: JSON.stringify(poisonLoop),
    }));
    const addResponse = await expectJson(posted, 201, AddLoopResponseSchema);
    assert.equal(addResponse.loop.id, 'poison-command-loop');

    const rejected = await app.fetch(engineRequest('/loopwatch/loops', {
      method: 'POST',
      body: JSON.stringify(invalidPoisonLoop),
    }));
    await expectJson(rejected, 400, InvalidRequestResponseSchema);
    await assertNoLoopCommandRan(commandMarkerPath);

    const libraryResponse = await expectJson(await app.fetch(engineRequest('/loopwatch/loops')), 200, LoopLibraryResponseSchema);
    assert.equal(libraryResponse.userLoopsPath, endpointUserLoopsPath);
    assert.deepEqual(libraryResponse.user.map((loop) => loop.id), ['poison-command-loop']);
    assert.ok(libraryResponse.starter.length >= STARTER_LOOPS.length, 'GET /loopwatch/loops must include starter loops');

    const endpointTask = 'Need a recommendation-only command execution safety loop';
    const recommendationResponse = await expectJson(
      await app.fetch(engineRequest(`/loopwatch/loops/recommend?task=${encodeURIComponent(endpointTask)}`)),
      200,
      LoopRecommendationResponseSchema,
    );
    assert.equal(recommendationResponse.card.loop.id, 'poison-command-loop');
    assert.equal(recommendationResponse.card.recommendationOnly, true);
    assertCopyPromptIsUsable(endpointTask, poisonLoop, recommendationResponse.card.copyPrompt);
    await assertNoLoopCommandRan(commandMarkerPath);
  });
} finally {
  if (previousUserLoopsPath === undefined) {
    delete process.env.LOOPWATCH_USER_LOOPS_PATH;
  } else {
    process.env.LOOPWATCH_USER_LOOPS_PATH = previousUserLoopsPath;
  }
  await rm(tempRoot, { recursive: true, force: true });
}

if (failures > 0) {
  process.exit(1);
}

console.log('\nAll Loop Library checks passed.');
