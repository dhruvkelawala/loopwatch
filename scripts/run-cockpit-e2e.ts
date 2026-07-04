import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import { chromium } from '@playwright/test';

const executable = chromium.executablePath();
const requireBrowser = process.env.LOOPWATCH_E2E_REQUIRE_BROWSER === '1';

if (!existsSync(executable)) {
  const message = `SKIP Cockpit Playwright E2E: Chromium is not installed at ${executable}. Run pnpm exec playwright install chromium to enable browser execution.`;
  if (requireBrowser) {
    console.error(message);
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
}

const child = spawn('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.config.ts'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

const exitCode = await new Promise<number | null>((resolve) => {
  child.on('error', (error) => {
    console.error(`Could not start Playwright: ${error.message}`);
    resolve(null);
  });
  child.on('exit', (code) => resolve(code));
});

process.exit(exitCode ?? 1);
