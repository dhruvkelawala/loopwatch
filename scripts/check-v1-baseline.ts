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
    issues: ['#8'],
    adrs: ['ADR-0002', 'ADR-0010', 'ADR-0011'],
    proves: [
      'active sessions infer and maintain a goal/done/validation/concerns summary',
      'event-driven judge cadence is rate-capped and gated by liveness',
      'hard convergence signals escalate cheap judge checks to the strong judge with spend accounted',
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
