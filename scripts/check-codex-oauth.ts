import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { configureLoopwatchCodexOAuth, createLoopwatchCodexOAuthIntegration, loopwatchCodexOAuthSnapshot } from '../src/codex-oauth.js';

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${name}`);
    console.error(`      ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
}

async function writeFakeCodexAuth(authPath: string) {
  await mkdir(dirname(authPath), { recursive: true });
  await writeFile(
    authPath,
    `${JSON.stringify(
      {
        provider: 'openai-codex',
        credentials: {
          access: 'test-access-token',
          refresh: 'test-refresh-token',
          expires: Date.now() + 60 * 60_000,
          accountId: 'acct-loopwatch-dogfood',
        },
        lastRefresh: '2026-07-08T00:00:00.000Z',
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await chmod(authPath, 0o600);
}

console.log('Codex OAuth integration — deterministic checks\n');

const tempRoot = await mkdtemp(join(tmpdir(), 'lw-codex-oauth-'));
try {
  const cwd = join(tempRoot, 'repo');
  const missingAuthPath = join(tempRoot, 'secrets', 'missing-openai-codex.json');
  const authPath = join(tempRoot, 'secrets', 'openai-codex.json');
  await mkdir(cwd, { recursive: true });
  await mkdir(join(tempRoot, 'secrets'), { recursive: true });
  await chmod(join(tempRoot, 'secrets'), 0o700);

  await check('auto mode stays disabled when the auth file is absent', () => {
    const integration = createLoopwatchCodexOAuthIntegration({ FLUE_CODEX_AUTH_PATH: missingAuthPath }, cwd);
    const snapshot = loopwatchCodexOAuthSnapshot(integration);
    assert.equal(snapshot.mode, 'auto');
    assert.equal(snapshot.enabled, false);
    assert.equal(snapshot.status.configured, false);
    assert.equal(snapshot.providerId, 'openai-codex');
    assert.equal(snapshot.modelExample, 'openai-codex/gpt-5.5');
  });

  await writeFakeCodexAuth(authPath);

  await check('explicit disable wins even when a valid auth file exists', () => {
    const integration = createLoopwatchCodexOAuthIntegration(
      { LOOPWATCH_CODEX_OAUTH: '0', FLUE_CODEX_AUTH_PATH: authPath },
      cwd,
    );
    const snapshot = loopwatchCodexOAuthSnapshot(integration);
    assert.equal(snapshot.mode, 'disabled');
    assert.equal(snapshot.enabled, false);
    assert.equal(snapshot.status.configured, true);
  });

  await check('explicit enable configures the openai-codex provider from a local auth file without network refresh', async () => {
    const integration = createLoopwatchCodexOAuthIntegration(
      { LOOPWATCH_CODEX_OAUTH: '1', FLUE_CODEX_AUTH_PATH: authPath },
      cwd,
    );
    const status = await configureLoopwatchCodexOAuth(integration);
    assert.equal(integration.enabled, true);
    assert.equal(status?.configured, true);
    assert.equal(status?.accountId, 'acct-loopwatch-dogfood');
  });
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log('\nCodex OAuth integration checks passed.');
