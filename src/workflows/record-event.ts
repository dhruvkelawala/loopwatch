import type { FlueContext, WorkflowRouteHandler } from '@flue/runtime';

export const route: WorkflowRouteHandler = async (_c, next) => next();

type RecordEventPayload = {
  note?: string;
};

export async function run({ payload }: FlueContext<RecordEventPayload>) {
  return {
    kind: 'loopwatch.persistence.probe',
    note: payload.note ?? 'persistence smoke event',
    recordedAt: new Date().toISOString(),
  };
}
