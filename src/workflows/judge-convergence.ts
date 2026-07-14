import { defineWorkflow, type JsonValue, type WorkflowRouteHandler, type WorkflowRunsHandler } from '@flue/runtime';
import * as v from 'valibot';

import { loopwatchWorkflowAgent } from '../workflow-agent.js';

export const route: WorkflowRouteHandler = async (_c, next) => next();
export const runs: WorkflowRunsHandler = async (_c, next) => next();

const EvidenceSignalSchema = v.object({
  eventId: v.string(),
  timestamp: v.string(),
  kind: v.string(),
  severity: v.picklist(['calm', 'watch', 'intervention']),
  signal: v.picklist(['drift', 'burn', 'weak_validation', 'churn', 'completion_without_evidence']),
  title: v.string(),
  detail: v.string(),
  recommendedAction: v.optional(v.string()),
});

const JudgeResultSchema = v.object({
  status: v.picklist(['calm', 'watch', 'intervention']),
  evidence: v.array(EvidenceSignalSchema),
  reason: v.string(),
});

const JudgeInputSchema = v.looseObject({
  packet: v.looseObject({}),
  model: v.optional(v.string()),
  thinkingLevel: v.optional(v.picklist(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])),
});

/**
 * Real convergence judge.
 *
 * The deterministic watcher builds a small, redacted evidence packet first; this
 * workflow asks the configured model to adjudicate that packet and returns the
 * exact model selected by Flue. Keep the prompt narrow: no raw transcript unless
 * the packet explicitly contains consented snippets, and no tool access is
 * needed for this judgement.
 */
export default defineWorkflow({
  agent: loopwatchWorkflowAgent,
  input: JudgeInputSchema,
  async run({ input, harness }) {
    const model = typeof input.model === 'string' && input.model.trim().length > 0 ? input.model.trim() : defaultJudgeModel();
    const thinkingLevel = typeof input.thinkingLevel === 'string' ? input.thinkingLevel : defaultThinkingLevel();
    const session = await harness.session('convergence-judge');
    const response = await session.prompt(judgePrompt(input.packet), {
      model,
      thinkingLevel,
      result: JudgeResultSchema,
    });

    return {
      ...response.data,
      model: `${response.model.provider}/${response.model.id}`,
      usage: response.usage,
    } as unknown as JsonValue;
  },
});

function defaultJudgeModel(): string {
  return process.env.LOOPWATCH_JUDGE_MODEL ?? process.env.LOOPWATCH_WORKFLOW_MODEL ?? 'openai-codex/gpt-5.5';
}

function defaultThinkingLevel(): 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' {
  const value = process.env.LOOPWATCH_JUDGE_THINKING;
  if (value === 'off' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') return value;
  return 'low';
}

function judgePrompt(packet: unknown): string {
  return `You are the Loopwatch convergence judge. Decide whether the observed agent session is still converging on the user's intended outcome.

Rules:
- Return only the structured result requested by the runtime.
- Use only the redacted evidence packet below. Do not infer facts that are not present.
- Prefer calm when evidence is insufficient for a warning.
- Preserve provided evidence eventId values when raising evidence.
- Use severity "watch" for weak/uncertain concerns and "intervention" for clear drift, churn, burn, or completion without evidence.
- Allowed signals: drift, burn, weak_validation, churn, completion_without_evidence.
- recommendedAction must be concrete and based on the packet.

Redacted evidence packet:
${JSON.stringify(packet, null, 2)}`;
}
