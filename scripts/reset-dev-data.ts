import { rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';

const args = process.argv.slice(2).filter((arg) => arg !== '--');

const { values } = parseArgs({
  args,
  options: {
    'confirm-delete-dev-data': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

const targets = ['data', '.loopwatch/test-results', '.loopwatch/playwright-report'].map((target) => join(process.cwd(), target));

console.log('Loopwatch developer data reset targets:');
for (const target of targets) console.log(`  - ${relative(process.cwd(), target)}`);

if (values['dry-run']) {
  console.log('\nDry run only; no files were deleted.');
  process.exit(0);
}

if (!values['confirm-delete-dev-data']) {
  console.error('\nRefusing to delete developer data without --confirm-delete-dev-data.');
  process.exit(1);
}

for (const target of targets) {
  await rm(target, { recursive: true, force: true });
}
console.log('\nDeveloper data reset complete.');
