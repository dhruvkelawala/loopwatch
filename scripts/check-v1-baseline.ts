import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runVerificationChecks, summarizeVerificationResults, type VerificationCheck } from './lib/check-harness.js';

const baselineChecks: VerificationCheck[] = [
  {
    name: 'Normalized Loopwatch Event contract',
    command: ['pnpm', 'events:check'],
    issues: ['#1'],
    adrs: ['ADR-0003', 'ADR-0004'],
    proves: [
      'shared event core is validated rather than faked',
      'unknown source-native fields survive normalization',
      'session identity is source plus source-native session id',
    ],
  },
  {
    name: 'Claude Source Adapter contract',
    command: ['pnpm', 'adapter:check'],
    issues: ['#7'],
    adrs: ['ADR-0003', 'ADR-0004', 'ADR-0009'],
    proves: [
      'Claude transcript records map to normalized Loopwatch Events',
      'cursor idempotency and restart resume avoid duplicate emits',
      'file-append liveness transitions active to idle to ended',
    ],
  },
  {
    name: 'Source adapter parity contract',
    command: ['pnpm', 'source:check'],
    issues: ['#11'],
    adrs: ['ADR-0003', 'ADR-0004', 'ADR-0009'],
    proves: [
      'Codex and Pi transcript records map to normalized Loopwatch Events',
      'source-native payloads and source-qualified session identity are preserved',
      'Cockpit capability badges distinguish available data from unavailable data',
    ],
  },
  {
    name: 'Flue file-backed persistence',
    command: ['pnpm', 'persistence:check'],
    issues: ['#1'],
    adrs: ['ADR-0004', 'ADR-0007'],
    proves: [
      'local Flue Node uses file-backed SQLite instead of in-memory state',
      'normalized events survive engine restart with unknown fields intact',
      'Durable Streams log can be replayed after restart',
    ],
  },
  {
    name: 'Claude adapter ingest path',
    command: ['pnpm', 'ingest:check'],
    issues: ['#7'],
    adrs: ['ADR-0003', 'ADR-0004', 'ADR-0007'],
    proves: [
      'adapter batches reach the record-events workflow',
      'identity and cwd/gitBranch context persist through the store',
      'live transcript appends surface without server restart',
    ],
  },
  {
    name: 'Cockpit live replay path',
    command: ['pnpm', 'cockpit:check'],
    issues: ['#7'],
    adrs: ['ADR-0007', 'ADR-0012'],
    proves: [
      'Cockpit discovers Loopwatch event runs through the local engine',
      'completed runs back-fill session rail and timeline state',
      'active run appends stream into the same session projection',
    ],
  },
  {
    name: 'Convergence watcher contract',
    command: ['pnpm', 'convergence:check'],
    issues: ['#8', '#14', '#15', '#16'],
    adrs: ['ADR-0002', 'ADR-0010', 'ADR-0011'],
    proves: [
      'active sessions infer and maintain a goal/done/validation/concerns summary',
      'event-driven judge cadence is rate-capped and gated by liveness',
      'hard convergence signals escalate cheap judge checks to the strong judge with spend accounted',
      'opening prompts above the Loop confidence bar anchor a Loop and expose its stop condition',
      'anchored completion claims without stop-condition evidence raise weak-validation evidence',
      'mid-session user redirections produce Pivot fresh-session nudges without classifying agent Drift as Pivot',
      'ended sessions turn convergence evidence into grounded post-session Coaching insights',
    ],
  },
  {
    name: 'Scoped git watcher contract',
    command: ['pnpm', 'git:check'],
    issues: ['#12'],
    adrs: ['ADR-0002', 'ADR-0003', 'ADR-0010'],
    proves: [
      'only active-session repositories are sampled for git evidence',
      'git evidence carries branch, diff, changed files, latest commit, and validation status',
      'dirty completion claims cite git evidence until a passing validation is observed',
    ],
  },
  {
    name: 'Loop Library recommendation contract',
    command: ['pnpm', 'loop:check'],
    issues: ['#13'],
    adrs: ['ADR-0010'],
    proves: [
      'starter and user-added Loops carry trigger, action, verification, memory, and observable stop conditions',
      'task recommendations return a relevant copy-to-use Coaching Card without executing loop commands',
      'app-owned Loop Library endpoints use the same local recommendation-only contract',
    ],
  },
  {
    name: 'Upgrades inbox contract',
    command: ['pnpm', 'upgrades:check'],
    issues: ['#17'],
    adrs: ['ADR-0005', 'ADR-0004'],
    proves: [
      'single blind spots remain below the Upgrade Card evidence threshold',
      'repeated capability gaps produce propose-only Upgrade Cards with source, count, and acceptance criteria',
      'repeated unknown event kinds produce propose-only Upgrade Cards that preserve source-native evidence',
    ],
  },
  {
    name: 'Layered alerting contract',
    command: ['pnpm', 'alerting:check'],
    issues: ['#10'],
    adrs: ['ADR-0007'],
    proves: [
      'native Pulse aggregates active-session convergence state',
      'intervention notifications are actionable only when evidence has a recommended action',
      'notification memory deduplicates evidence keys and throttles per session',
      'visible Cockpit suppression does not consume notification memory before hidden delivery',
    ],
  },
];

const results = await runVerificationChecks(baselineChecks);
const reportPath = process.env.LOOPWATCH_V1_BASELINE_REPORT;
if (reportPath) {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), checks: results }, null, 2)}\n`,
  );
  console.log(`\nWrote baseline report: ${reportPath}`);
}
summarizeVerificationResults(results);
