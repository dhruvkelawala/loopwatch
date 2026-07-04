import { z } from 'zod';
import assert from 'node:assert/strict';

import { LoopwatchEventSchema } from '../../src/events.js';
import { readJsonFixture } from './fixtures.js';

const JudgeFindingSchema = z.object({
  severity: z.enum(['info', 'watch', 'intervention']),
  title: z.string().min(1),
  evidenceEventIds: z.array(z.string().min(1)),
});

export const DeterministicJudgeOutputSchema = z
  .object({
    judge: z.literal('deterministic-fake-v1'),
    caseId: z.string().min(1),
    verdict: z.enum(['pass', 'fail']),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1),
    findings: z.array(JudgeFindingSchema),
  })
  .strict();

export const PromptContractFixtureSchema = z
  .object({
    caseId: z.string().min(1),
    description: z.string().min(1),
    prompt: z
      .object({
        system: z.string().min(1),
        user: z.string().min(1),
      })
      .strict(),
    evidence: z
      .object({
        events: z.array(LoopwatchEventSchema).min(1),
      })
      .strict(),
    expectedJudgeOutput: DeterministicJudgeOutputSchema,
  })
  .strict();

export type PromptContractFixture = z.infer<typeof PromptContractFixtureSchema>;
export type DeterministicJudgeOutput = z.infer<typeof DeterministicJudgeOutputSchema>;

export async function loadPromptContractFixture(...segments: string[]): Promise<PromptContractFixture> {
  return PromptContractFixtureSchema.parse(await readJsonFixture(...segments));
}

export function runDeterministicFakeJudge(contract: PromptContractFixture): DeterministicJudgeOutput {
  const failedValidation = contract.evidence.events.find((event) => {
    if (event.kind !== 'tool_result') return false;
    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    return typeof payload.exitCode === 'number' && payload.exitCode !== 0;
  });
  const failedPayload = failedValidation?.payload as Record<string, unknown> | undefined;
  const failedEvidenceId =
    failedPayload && typeof failedPayload.id === 'string' && failedPayload.id.length > 0
      ? failedPayload.id
      : failedValidation?.timestamp;


  const output: DeterministicJudgeOutput = failedValidation
    ? {
        judge: 'deterministic-fake-v1',
        caseId: contract.caseId,
        verdict: 'fail',
        confidence: 0.82,
        rationale: 'A validation tool_result reported a non-zero exit code.',
        findings: [
          {
            severity: 'watch',
            title: 'Validation failed before the session converged',
            evidenceEventIds: [String(failedEvidenceId)],
          },
        ],
      }
    : {
        judge: 'deterministic-fake-v1',
        caseId: contract.caseId,
        verdict: 'pass',
        confidence: 0.74,
        rationale: 'No failing validation tool_result is present in the evidence packet.',
        findings: [],
      };

  return DeterministicJudgeOutputSchema.parse(output);
}

export function assertDeterministicPromptContract(contract: PromptContractFixture): DeterministicJudgeOutput {
  const actual = runDeterministicFakeJudge(contract);
  assert.deepEqual(actual, contract.expectedJudgeOutput, `${contract.caseId} deterministic judge output drifted`);
  return actual;
}
