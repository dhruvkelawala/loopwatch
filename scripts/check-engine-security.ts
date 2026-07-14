/**
 * Deterministic security contract checks for issue #22.
 *
 * No server is started here: requests are sent directly to the Hono app, and the
 * Claude adapter ingest path uses a fetch fake. The checks are intentionally RED
 * until the engine gains bearer auth, Host/Origin enforcement, CORS preflight
 * hardening, and adapter token threading.
 *
 * Run with: pnpm security:check
 */
import assert from 'node:assert/strict';

import app from '../src/app.js';
import { httpIngest, type IngestFn } from '../src/adapters/claude/adapter.js';

const ENGINE_PORT = 41_273;
const TOKEN = 'issue-22-test-token';
const TOKEN_ENV = 'LOOPWATCH_ENGINE_TOKEN';
const HOSTS_ENV = 'LOOPWATCH_ENGINE_ALLOWED_HOSTS';

let failures = 0;

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  const envSnapshot: Record<string, string | undefined> = {
    PORT: process.env.PORT,
    [TOKEN_ENV]: process.env[TOKEN_ENV],
    [HOSTS_ENV]: process.env[HOSTS_ENV],
  };
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${name}`);
    console.error(`      ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  } finally {
    for (const [name, value] of Object.entries(envSnapshot)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function configureEngineToken(token: string | undefined): void {
  process.env.PORT = String(ENGINE_PORT);
  delete process.env[HOSTS_ENV];
  if (token === undefined) delete process.env[TOKEN_ENV];
  else process.env[TOKEN_ENV] = token;
}

function engineRequest(
  path: string,
  {
    method = 'GET',
    host = `127.0.0.1:${ENGINE_PORT}`,
    token,
    origin,
    headers,
    body,
  }: {
    method?: string;
    host?: string;
    token?: string;
    origin?: string;
    headers?: HeadersInit;
    body?: BodyInit;
  } = {},
): Request {
  const requestHeaders = new Headers(headers);
  if (token !== undefined) requestHeaders.set('authorization', `Bearer ${token}`);
  if (origin !== undefined) requestHeaders.set('origin', origin);
  return new Request(`http://${host}${path}`, { method, headers: requestHeaders, body });
}

async function fetchEngine(
  path: string,
  options?: Parameters<typeof engineRequest>[1],
): Promise<Response> {
  return app.fetch(engineRequest(path, options));
}

async function expectStatus(response: Response, expected: number, label: string): Promise<void> {
  const text = await response.text();
  assert.equal(response.status, expected, `${label}: expected HTTP ${expected}, got ${response.status} ${text}`);
}

async function expectOk(response: Response, label: string): Promise<void> {
  const text = await response.text();
  assert.ok(response.ok, `${label}: expected 2xx, got ${response.status} ${text}`);
}

console.log('Loopwatch engine security — issue #22 contract checks\n');

await check('no-token compatibility mode still allows local health probes', async () => {
  configureEngineToken(undefined);
  await expectOk(await fetchEngine('/health'), 'GET /health without configured token');
});

await check('configured token is required on app-owned engine requests', async () => {
  configureEngineToken(TOKEN);

  await expectStatus(await fetchEngine('/health'), 401, 'missing bearer token');
  await expectStatus(await fetchEngine('/health', { token: 'wrong-token' }), 401, 'wrong bearer token');
  await expectOk(await fetchEngine('/health', { token: TOKEN }), 'correct bearer token');
});

await check('configured token protects the mounted Flue router, not only app-owned routes', async () => {
  configureEngineToken(TOKEN);

  await expectStatus(await fetchEngine('/openapi.json'), 401, 'missing bearer token on Flue route');
  await expectOk(await fetchEngine('/openapi.json', { token: TOKEN }), 'correct bearer token on Flue route');
});

await check('Host is restricted to the expected loopback authority', async () => {
  configureEngineToken(TOKEN);

  await expectOk(await fetchEngine('/health', { host: `127.0.0.1:${ENGINE_PORT}`, token: TOKEN }), '127.0.0.1 host');
  await expectOk(await fetchEngine('/health', { host: `localhost:${ENGINE_PORT}`, token: TOKEN }), 'localhost host');
  await expectStatus(
    await fetchEngine('/health', { host: `loopwatch.attacker.test:${ENGINE_PORT}`, token: TOKEN }),
    403,
    'DNS-rebinding host',
  );
  await expectStatus(
    await fetchEngine('/health', { host: '127.0.0.1:3583', token: TOKEN }),
    403,
    'loopback host on an unexpected port',
  );
});

await check('production configured hosts reject DNS rebinding and wrong-port loopback hosts', async () => {
  configureEngineToken(TOKEN);
  process.env[HOSTS_ENV] = `127.0.0.1:${ENGINE_PORT},localhost:${ENGINE_PORT}`;

  await expectOk(await fetchEngine('/health', { host: `127.0.0.1:${ENGINE_PORT}`, token: TOKEN }), 'configured 127.0.0.1 host');
  await expectOk(await fetchEngine('/health', { host: `localhost:${ENGINE_PORT}`, token: TOKEN }), 'configured localhost host');
  await expectStatus(
    await fetchEngine('/health', { host: `loopwatch.attacker.test:${ENGINE_PORT}`, token: TOKEN }),
    403,
    'configured hosts reject DNS-rebinding host',
  );
  await expectStatus(
    await fetchEngine('/health', { host: '127.0.0.1:3583', token: TOKEN }),
    403,
    'configured hosts reject loopback host on an unexpected port',
  );
});

await check('Origin is accepted only for Tauri and local dev Cockpit surfaces', async () => {
  configureEngineToken(TOKEN);

  for (const origin of ['tauri://localhost', 'http://tauri.localhost', 'http://127.0.0.1:1420', 'http://localhost:1420']) {
    await expectOk(await fetchEngine('/health', { token: TOKEN, origin }), `allowed origin ${origin}`);
  }

  await expectStatus(
    await fetchEngine('/health', { token: TOKEN, origin: 'https://attacker.example' }),
    403,
    'malicious web origin',
  );
});

await check('CORS preflight permits Cockpit Authorization and denies malicious origins', async () => {
  configureEngineToken(TOKEN);

  const allowed = await fetchEngine('/health', {
    method: 'OPTIONS',
    origin: 'tauri://localhost',
    headers: {
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'Authorization',
    },
  });
  await expectOk(allowed, 'allowed Cockpit preflight');
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'tauri://localhost', 'preflight echoes the allowed origin');
  assert.match(
    allowed.headers.get('access-control-allow-headers') ?? '',
    /authorization/i,
    'preflight allows the Authorization request header',
  );

  await expectStatus(
    await fetchEngine('/health', {
      method: 'OPTIONS',
      origin: 'https://attacker.example',
      headers: {
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'Authorization, Content-Type',
      },
    }),
    403,
    'malicious preflight',
  );
});

await check('Claude adapter httpIngest sends a configured bearer token', async () => {
  const originalFetch = globalThis.fetch;
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ ok: true, runId: 'run-security-check' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const authenticatedHttpIngest = httpIngest as (serverUrl: string, options: { token: string }) => IngestFn;
    await authenticatedHttpIngest(`http://127.0.0.1:${ENGINE_PORT}`, { token: TOKEN })([]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1, 'one ingest request is sent');
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get('authorization'), `Bearer ${TOKEN}`, 'ingest request carries Authorization');
});

if (failures > 0) {
  console.error(`\n${failures} security check(s) failed.`);
  process.exit(1);
}

console.log('\nEngine security checks passed.');
