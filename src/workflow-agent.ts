import { defineAgent } from '@flue/runtime';

/**
 * Shared execution policy for Loopwatch's deterministic ingest workflows.
 *
 * These workflows validate and persist observed events; they do not prompt a
 * model. Flue's latest workflow API still requires an agent definition, so keep
 * the default on the provider family this repo is dogfooding while leaving the
 * ingest path model-free.
 */
export const loopwatchWorkflowAgent = defineAgent(() => ({
  model: process.env.LOOPWATCH_WORKFLOW_MODEL ?? 'openai-codex/gpt-5.5',
  instructions: 'Run Loopwatch deterministic ingest workflows. Do not perform model work unless a workflow explicitly asks for it.',
}));
