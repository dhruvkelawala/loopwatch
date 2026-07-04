import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export type VerificationCheck = {
  name: string;
  command: string[];
  issues: string[];
  adrs: string[];
  proves: string[];
};

export type VerificationResult = {
  name: string;
  issues: string[];
  adrs: string[];
  proves: string[];
  status: 'passed' | 'failed';
  durationMs: number;
  exitCode: number | null;
};


export async function runVerificationChecks(checks: VerificationCheck[]): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  for (const check of checks) {
    const startedAt = performance.now();
    console.log(`\n▶ ${check.name}`);
    console.log(`  command: ${check.command.map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')}`);
    console.log(`  issues:  ${check.issues.join(', ')}`);
    console.log(`  ADRs:    ${check.adrs.join(', ')}`);
    for (const proof of check.proves) console.log(`  proves:  ${proof}`);

    const [bin, ...args] = check.command;
    const exitCode = await new Promise<number | null>((resolve) => {
      let settled = false;
      const child = spawn(bin, args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit',
      });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        console.error(`\nCould not start ${bin}: ${error.message}`);
        resolve(null);
      });
      child.on('exit', (code) => {
        if (settled) return;
        settled = true;
        resolve(code);
      });
    });

    const durationMs = Math.round(performance.now() - startedAt);
    const status = exitCode === 0 ? 'passed' : 'failed';
    results.push({
      name: check.name,
      issues: check.issues,
      adrs: check.adrs,
      proves: check.proves,
      status,
      durationMs,
      exitCode,
    });

    if (status === 'failed') {
      console.error(`\n✗ ${check.name} failed after ${durationMs}ms (exit ${exitCode ?? 'signal/error'})`);
      break;
    }

    console.log(`✓ ${check.name} passed in ${durationMs}ms`);
  }

  return results;
}

export function summarizeVerificationResults(results: VerificationResult[]): void {
  console.log('\nVerification summary');
  for (const result of results) {
    const marker = result.status === 'passed' ? '✓' : '✗';
    console.log(`  ${marker} ${result.name} (${result.durationMs}ms)`);
  }

  const failed = results.find((result) => result.status === 'failed');
  if (failed) {
    process.exitCode = 1;
    return;
  }

  console.log('\nAll verification checks passed.');
}
