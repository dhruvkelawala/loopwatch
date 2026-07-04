import { assertDeterministicPromptContract, loadPromptContractFixture } from '../tests/support/prompt-contracts.js';

const requested = process.env.LOOPWATCH_LIVE_EVAL === '1';

if (!requested) {
  console.log('SKIP live eval: set LOOPWATCH_LIVE_EVAL=1 with LOOPWATCH_EVAL_PROVIDER=fake for the deterministic hook.');
  process.exit(0);
}

const provider = process.env.LOOPWATCH_EVAL_PROVIDER;
if (!provider) {
  console.error('LOOPWATCH_LIVE_EVAL=1 requires LOOPWATCH_EVAL_PROVIDER. Supported provider for this harness phase: fake.');
  process.exit(1);
}

if (provider !== 'fake') {
  console.error(`Unsupported LOOPWATCH_EVAL_PROVIDER=${JSON.stringify(provider)}. Supported provider for this harness phase: fake.`);
  process.exit(1);
}

const fixtureName = process.env.LOOPWATCH_EVAL_FIXTURE ?? 'convergence-failing-validation.valid.json';
const contract = await loadPromptContractFixture('prompt-contracts', fixtureName);
const output = assertDeterministicPromptContract(contract);
console.log(`Live eval hook passed through deterministic fake provider: ${output.caseId} -> ${output.verdict}.`);
