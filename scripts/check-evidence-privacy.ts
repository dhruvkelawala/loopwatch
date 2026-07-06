/**
 * Deterministic privacy contract checks for ADR-0006.
 *
 * These checks intentionally target the production evidence-packet boundary that
 * prepares outbound LLM / judge / eval payloads. Raw normalized events may stay
 * local, but the default outbound packet must be compact structured evidence,
 * and every outbound path must redact obvious secrets before anything leaves the
 * machine.
 *
 * Run with: pnpm evidence:privacy:check
 */
import assert from 'node:assert/strict';

import type { ConvergenceEvidenceRef, RunningSummary } from '../src/convergence.js';
import type { LoopwatchEvent } from '../src/events.js';
import { buildEvidencePacket, redactSecrets } from '../src/evidence-packet.js';

type RedactionReport = {
  count: number;
  categories: string[];
};

type Redacted<T> = {
  value: T;
  report: RedactionReport;
};

type EvidencePacketInput = {
  session: { id: string; source: string; sessionId: string; status: 'calm' | 'watch' | 'intervention'; liveness: 'active' | 'idle' | 'ended' };
  summary: RunningSummary;
  evidence: ConvergenceEvidenceRef[];
  events: LoopwatchEvent[];
  deepAnalyzeConsent?: boolean;
  requestedEvidenceEventId?: string;
};

type EvidencePacket = {
  session: { id: string; source: string; sessionId: string };
  summary: RunningSummary;
  signals: unknown[];
  omittedRawTranscript: boolean;
  transcript?: { scope: 'selected_evidence'; events: Array<{ id: string; timestamp: string; kind: string; actorType: string; snippet: string }> };
  redactions: RedactionReport;
};

const redact = redactSecrets as <T>(value: T) => Redacted<T>;
const buildPacket = buildEvidencePacket as (input: EvidencePacketInput) => EvidencePacket;

let failures = 0;

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${name}`);
    console.error(`      ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function assertJsonIncludes(value: unknown, needle: string, label: string): void {
  assert.ok(json(value).includes(needle), `${label}: expected JSON to retain ${needle}`);
}

function assertJsonMatches(value: unknown, pattern: RegExp, label: string): void {
  assert.match(json(value), pattern, `${label}: expected JSON to match ${pattern}`);
}

function assertNoReplacementCaptureMarkers(value: unknown, label: string): void {
  assert.doesNotMatch(json(value), /\$[12]/, `${label}: must not emit literal regex replacement capture markers`);
}

function assertJsonOmits(value: unknown, forbidden: readonly string[], label: string): void {
  const body = json(value);
  for (const fragment of forbidden) {
    assert.equal(body.includes(fragment), false, `${label}: leaked forbidden fragment ${fragment}`);
  }
}

function assertRedactionMarker(value: unknown, label: string): void {
  assert.match(json(value), /REDACTED/i, `${label}: expected an explicit redaction marker`);
}

function assertReportRecorded(result: Redacted<unknown>, label: string): void {
  assert.equal(typeof result.report.count, 'number', `${label}: report.count must be a number`);
  assert.ok(result.report.count > 0, `${label}: report must record at least one redaction`);
  assert.ok(Array.isArray(result.report.categories), `${label}: report.categories must be an array`);
  assert.ok(result.report.categories.length > 0, `${label}: report must record at least one redaction category`);
  for (const category of result.report.categories) {
    assert.equal(typeof category, 'string', `${label}: each redaction category is a string`);
  }
}

function assertRedacts<T>(label: string, value: T, forbidden: readonly string[], safeMarker: string): void {
  const result = redact(value);
  assertJsonOmits(result.value, forbidden, label);
  assertJsonIncludes(result.value, safeMarker, label);
  assertRedactionMarker(result.value, label);
  assertReportRecorded(result, label);
}

const session = { id: 'claude:privacy-session', source: 'claude', sessionId: 'privacy-session', status: 'intervention' as const, liveness: 'active' as const };

const API_KEY = 'sk-proj-loopwatch-privacy-0123456789abcdefghijklmnopqrstuvwxyz';
const BEARER_TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.loopwatchprivacy.signature';
const BASIC_AUTH = 'Basic bG9vcHdhdGNoOnByaXZhY3ktcGFzcw==';
const PRIVATE_KEY_HEADER = '-----BEGIN OPENSSH PRIVATE KEY-----';
const PRIVATE_KEY_BODY = 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAPRpbnRlbnRpb25hbC1wcml2YXRlLWtleQ==';
const PRIVATE_KEY_FOOTER = '-----END OPENSSH PRIVATE KEY-----';
const ENV_SECRET_ASSIGNMENT = 'LOOPWATCH_API_SECRET=env-secret-value-12345';
const CREDENTIAL_URL = 'https://deploy-user:deploy-pass-123@example.com/org/private-repo.git';
const TOKEN_ONLY_CREDENTIAL_URL = 'https://ghp_loopwatchtokenonly1234567890@github.com/org/repo.git';
const NON_BEARER_AUTH_TOKEN = 'ghp_loopwatchauthheader1234567890';
const FREE_TEXT_AUTH_HEADER = `Authorization: token ${NON_BEARER_AUTH_TOKEN}`;
const LONG_PRIVATE_KEY_BODY = `${PRIVATE_KEY_BODY}\n`.repeat(8);
const LONG_PRIVATE_KEY_BLOCK = `${PRIVATE_KEY_HEADER}\n${LONG_PRIVATE_KEY_BODY}${PRIVATE_KEY_FOOTER}`;
const COMMAND_OUTPUT_SECRET = 'cmd-output-secret-7890';
const SAFE_MARKER = 'safe-public-marker';
const PREFIX_PRESERVATION_TEXT = [
  `remote ${CREDENTIAL_URL}`,
  FREE_TEXT_AUTH_HEADER,
  `OPENAI_API_KEY=${API_KEY}`,
  ENV_SECRET_ASSIGNMENT,
  SAFE_MARKER,
].join('\n');
const PREFIX_PRESERVATION_FORBIDDEN = [
  CREDENTIAL_URL,
  'deploy-user:deploy-pass-123',
  FREE_TEXT_AUTH_HEADER,
  NON_BEARER_AUTH_TOKEN,
  API_KEY,
  'env-secret-value-12345',
];

const summary: RunningSummary = {
  goal: 'Ship the Evidence privacy slice without exporting raw transcripts.',
  done: ['Mapped structured evidence packet boundary.'],
  validation: ['privacy harness should pass after production redaction is implemented'],
  concerns: ['validation output contained credentials before redaction'],
};

const cardEvidence: ConvergenceEvidenceRef = {
  eventId: 'evt-validation-secret',
  timestamp: '2026-07-04T12:00:02.000Z',
  kind: 'tool_result',
  severity: 'intervention',
  signal: 'weak_validation',
  title: 'Validation output exposed credentials',
  detail: `Validation failed with ${ENV_SECRET_ASSIGNMENT} and API key ${API_KEY}`,
  recommendedAction: 'Send only structured evidence and redact the command output before asking a judge.',
};

const events: LoopwatchEvent[] = [
  {
    id: 'evt-user-request',
    source: 'claude',
    sessionId: 'privacy-session',
    timestamp: '2026-07-04T12:00:00.000Z',
    kind: 'message',
    actor: { type: 'user' },
    payload: { id: 'evt-user-request', text: 'Please run the privacy check.' },
  },
  {
    source: 'claude',
    id: 'evt-validation-secret',
    sessionId: 'privacy-session',
    timestamp: '2026-07-04T12:00:01.000Z',
    kind: 'tool_call',
    actor: { type: 'agent', tool: 'bash' },
    payload: {
      id: 'evt-validation-secret',
      command: 'pnpm evidence:privacy:check',
      output: `check failed but retained ${SAFE_MARKER}; token=${COMMAND_OUTPUT_SECRET}`,
      headers: { Authorization: BASIC_AUTH },
      remote: CREDENTIAL_URL,
    },
  },
  {
    source: 'claude',
    id: 'evt-unrelated-private',
    sessionId: 'privacy-session',
    timestamp: '2026-07-04T12:00:03.000Z',
    kind: 'message',
    actor: { type: 'agent' },
    payload: {
      id: 'evt-unrelated-private',
      text: `Unrelated raw transcript line with ${BEARER_TOKEN} that must not be sent for the requested card.`,
    },
  },
];

function packetInput(overrides: Partial<EvidencePacketInput> = {}): EvidencePacketInput {
  return { session, summary, evidence: [cardEvidence], events, ...overrides };
}

function payloadIds(packet: EvidencePacket): string[] {
  const transcriptEvents = packet.transcript?.events ?? [];
  return transcriptEvents.map((event) => event.id);
}

console.log('Evidence privacy — ADR-0006 contract checks\n');

await check('default Evidence Packet is structured summary/signals/card evidence and omits raw transcript events', () => {
  const packet = buildPacket(packetInput());

  assert.deepEqual(packet.session, session, 'packet identifies the source session');
  assert.deepEqual(packet.summary, summary, 'packet carries the running summary');
  assert.equal(packet.omittedRawTranscript, true, 'default packet declares raw transcript omission');
  assert.equal(packet.transcript, undefined, 'default packet does not include transcript context');
  assert.equal(Object.hasOwn(packet as object, 'events'), false, 'default packet does not expose raw events at top level');

  assert.ok(Array.isArray(packet.signals), 'packet carries structured signals');
  const signalBody = json(packet.signals);
  assert.match(signalBody, /evt-validation-secret/, 'packet carries the requested card evidence event');
  assert.match(signalBody, /weak_validation/, 'card evidence preserves the convergence signal');

  assertJsonOmits(packet, [API_KEY, ENV_SECRET_ASSIGNMENT, COMMAND_OUTPUT_SECRET, PRIVATE_KEY_BODY, CREDENTIAL_URL], 'default packet');
});

await check('redacts API keys while retaining non-secret context', () => {
  assertRedacts(
    'API key redaction',
    { provider: 'openai', apiKey: API_KEY, note: SAFE_MARKER },
    [API_KEY],
    SAFE_MARKER,
  );
});

await check('redacts bearer tokens while retaining non-secret context', () => {
  assertRedacts(
    'bearer token redaction',
    { message: `retry failed with ${BEARER_TOKEN}`, note: SAFE_MARKER },
    [BEARER_TOKEN, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.loopwatchprivacy.signature'],
    SAFE_MARKER,
  );
});

await check('redacts auth headers regardless of authorization scheme', () => {
  assertRedacts(
    'auth header redaction',
    { headers: { Authorization: BASIC_AUTH, 'X-Trace-Id': SAFE_MARKER } },
    [BASIC_AUTH, 'bG9vcHdhdGNoOnByaXZhY3ktcGFzcw=='],
    SAFE_MARKER,
  );
});

await check('redacts free-text auth headers regardless of authorization scheme', () => {
  assertRedacts(
    'free-text token auth header redaction',
    { log: `request failed\n${FREE_TEXT_AUTH_HEADER}\n${SAFE_MARKER}` },
    [FREE_TEXT_AUTH_HEADER, NON_BEARER_AUTH_TOKEN],
    SAFE_MARKER,
  );
});

await check('redacts private key blocks', () => {
  assertRedacts(
    'private key redaction',
    { file: 'id_ed25519', contents: `${PRIVATE_KEY_HEADER}\n${PRIVATE_KEY_BODY}\n${PRIVATE_KEY_FOOTER}`, note: SAFE_MARKER },
    [PRIVATE_KEY_HEADER, PRIVATE_KEY_BODY, PRIVATE_KEY_FOOTER],
    SAFE_MARKER,
  );
});

await check('redacts env secret assignments', () => {
  assertRedacts(
    'env assignment redaction',
    { dotenvLine: `export ${ENV_SECRET_ASSIGNMENT}`, note: SAFE_MARKER },
    [ENV_SECRET_ASSIGNMENT, 'env-secret-value-12345'],
    SAFE_MARKER,
  );
});

await check('redacts credential URLs', () => {
  assertRedacts(
    'credential URL redaction',
    { remote: CREDENTIAL_URL, note: SAFE_MARKER },
    [CREDENTIAL_URL, 'deploy-user:deploy-pass-123'],
    SAFE_MARKER,
  );
  assertRedacts(
    'token-only credential URL redaction',
    { remote: TOKEN_ONLY_CREDENTIAL_URL, note: SAFE_MARKER },
    [TOKEN_ONLY_CREDENTIAL_URL, 'ghp_loopwatchtokenonly1234567890'],
    SAFE_MARKER,
  );

});

await check('preserves non-secret prefixes when redacting text secrets', () => {
  const result = redact({ text: PREFIX_PRESERVATION_TEXT });
  assertJsonOmits(result.value, PREFIX_PRESERVATION_FORBIDDEN, 'prefix-preserving text redaction');
  assertJsonIncludes(result.value, 'https://[REDACTED:credential_url]@example.com/org/private-repo.git', 'credential URL redaction');
  assertJsonIncludes(result.value, 'Authorization: [REDACTED:auth_header]', 'Authorization header redaction');
  assertJsonMatches(result.value, /OPENAI_API_KEY=\[REDACTED:[a-z_]+\]/, 'API key assignment redaction');
  assertJsonMatches(result.value, /LOOPWATCH_API_SECRET=\[REDACTED:[a-z_]+\]/, 'env secret assignment redaction');
  assertJsonIncludes(result.value, SAFE_MARKER, 'prefix-preserving text redaction');
  assertNoReplacementCaptureMarkers(result.value, 'prefix-preserving text redaction');
  assertReportRecorded(result, 'prefix-preserving text redaction');
});

await check('evidence packets preserve redaction prefixes without replacement capture markers', () => {
  const evidence: ConvergenceEvidenceRef = {
    ...cardEvidence,
    eventId: 'evt-prefix-redaction',
    timestamp: '2026-07-04T12:00:04.000Z',
    title: 'Prefix redaction exposed replacement captures',
    detail: PREFIX_PRESERVATION_TEXT,
  };
  const event: LoopwatchEvent = {
    source: 'claude',
    id: 'evt-prefix-redaction',
    sessionId: 'privacy-session',
    timestamp: '2026-07-04T12:00:04.000Z',
    kind: 'message',
    actor: { type: 'agent' },
    payload: { id: 'evt-prefix-redaction', text: PREFIX_PRESERVATION_TEXT },
  };
  const packet = buildPacket(
    packetInput({
      evidence: [evidence],
      events: [event],
      deepAnalyzeConsent: true,
      requestedEvidenceEventId: 'evt-prefix-redaction',
    }),
  );
  assertJsonOmits(packet, PREFIX_PRESERVATION_FORBIDDEN, 'prefix-preserving evidence packet');
  assertJsonIncludes(packet, 'https://[REDACTED:credential_url]@example.com/org/private-repo.git', 'evidence packet credential URL redaction');
  assertJsonIncludes(packet, 'Authorization: [REDACTED:auth_header]', 'evidence packet Authorization redaction');
  assertJsonMatches(packet, /OPENAI_API_KEY=\[REDACTED:[a-z_]+\]/, 'evidence packet API key assignment redaction');
  assertJsonMatches(packet, /LOOPWATCH_API_SECRET=\[REDACTED:[a-z_]+\]/, 'evidence packet env secret assignment redaction');
  assertJsonIncludes(packet, SAFE_MARKER, 'prefix-preserving evidence packet');
  assertNoReplacementCaptureMarkers(packet, 'prefix-preserving evidence packet');
});

await check('redacts secrets embedded in command output and details', () => {
  assertRedacts(
    'command output redaction',
    {
      payload: {
        command: 'pnpm evidence:privacy:check',
        output: `check failed but retained ${SAFE_MARKER}; token=${COMMAND_OUTPUT_SECRET}`,
        details: `Authorization: ${BASIC_AUTH}\nOPENAI_API_KEY=${API_KEY}`,
      },
    },
    [COMMAND_OUTPUT_SECRET, BASIC_AUTH, API_KEY],
    SAFE_MARKER,
  );
});

await check('deep analyze omits or rejects transcript context without explicit consent', () => {
  try {
    const packet = buildPacket(packetInput({ requestedEvidenceEventId: 'evt-validation-secret' }));
    assert.equal(packet.omittedRawTranscript, true, 'unconsented deep analyze keeps raw transcript omitted');
    assert.equal(packet.transcript, undefined, 'unconsented deep analyze does not include transcript events');
    assertJsonOmits(packet, [COMMAND_OUTPUT_SECRET, PRIVATE_KEY_BODY, CREDENTIAL_URL, BEARER_TOKEN], 'unconsented deep analyze packet');
  } catch (error) {
    assert.match(
      error instanceof Error ? error.message : String(error),
      /consent|deep analyze|transcript/i,
      'rejection should explain the consent boundary',
    );
  }
});

await check('deep analyze redacts private key blocks before transcript snippets are compacted', () => {
  const longKeyEventId = 'evt-long-private-key';
  const longKeyEvidence: ConvergenceEvidenceRef = {
    ...cardEvidence,
    eventId: longKeyEventId,
    title: 'Deep analyze snippet exposed a private key block',
    detail: 'Deep analyze requested the selected long-key transcript event.',
  };
  const longKeyEvent: LoopwatchEvent = {
    source: 'claude',
    id: longKeyEventId,
    sessionId: 'privacy-session',
    timestamp: '2026-07-04T12:00:04.000Z',
    kind: 'tool_call',
    actor: { type: 'agent', tool: 'bash' },
    payload: {
      id: longKeyEventId,
      command: 'ssh-add /tmp/id_ed25519',
      output: `provisioning failed before ${LONG_PRIVATE_KEY_BLOCK}\n${SAFE_MARKER}`,
    },
  };

  const packet = buildPacket(
    packetInput({
      deepAnalyzeConsent: true,
      requestedEvidenceEventId: longKeyEventId,
      evidence: [longKeyEvidence],
      events: [longKeyEvent],
    }),
  );

  assert.equal(packet.omittedRawTranscript, false, 'consented deep analyze declares transcript inclusion');
  assert.deepEqual(payloadIds(packet), [longKeyEventId], 'transcript context is scoped to the selected long-key event');
  assertJsonIncludes(packet, SAFE_MARKER, 'long private key transcript packet');
  assertJsonOmits(packet, [PRIVATE_KEY_HEADER, PRIVATE_KEY_BODY, PRIVATE_KEY_FOOTER], 'long private key transcript packet');
  assertRedactionMarker(packet, 'long private key transcript packet');
});

await check('deep analyze with consent includes only redacted transcript snippets for the requested card', () => {
  const packet = buildPacket(packetInput({ deepAnalyzeConsent: true, requestedEvidenceEventId: 'evt-validation-secret' }));

  assert.equal(packet.omittedRawTranscript, false, 'consented deep analyze declares transcript inclusion');
  assert.ok(packet.transcript, 'consented deep analyze includes transcript context');
  assert.deepEqual(payloadIds(packet), ['evt-validation-secret'], 'transcript context is scoped to the requested evidence card');
  assertJsonIncludes(packet, SAFE_MARKER, 'consented transcript packet');
  assertJsonOmits(
    packet,
    [API_KEY, ENV_SECRET_ASSIGNMENT, COMMAND_OUTPUT_SECRET, PRIVATE_KEY_BODY, CREDENTIAL_URL, BASIC_AUTH, BEARER_TOKEN, 'evt-unrelated-private'],
    'consented transcript packet',
  );
  assertRedactionMarker(packet, 'consented transcript packet');
});

await check('deep analyze matches events whose stable id lives only in the payload (real adapter shape)', () => {
  // Normalized adapter events carry no top-level id — the stable id is inside
  // the preserved native payload, and evidence cards reference that id.
  const payloadIdEvent: LoopwatchEvent = {
    source: 'pi',
    sessionId: 'privacy-session',
    timestamp: '2026-07-04T12:00:05.000Z',
    kind: 'tool_result',
    actor: { type: 'tool', name: 'bash' },
    payload: { id: 'pi-payload-only-id', message: { role: 'bashExecution', command: 'pnpm check', output: 'ok' } },
  };
  const packet = buildPacket(
    packetInput({
      deepAnalyzeConsent: true,
      requestedEvidenceEventId: 'pi-payload-only-id',
      events: [...events, payloadIdEvent],
      evidence: [{ ...cardEvidence, eventId: 'pi-payload-only-id' }],
    }),
  );

  assert.ok(packet.transcript, 'payload-id deep analyze includes transcript context');
  assert.deepEqual(payloadIds(packet), ['pi-payload-only-id'], 'transcript context matches the payload-carried event id');
});

if (failures > 0) {
  console.error(`\n${failures} evidence privacy check(s) failed.`);
  process.exit(1);
}

console.log('\nEvidence privacy checks passed.');
