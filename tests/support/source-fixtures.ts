import { z } from 'zod';

import { readJsonlFixture } from './fixtures.js';

const IsoTimestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'must be parseable as a timestamp');
const TranscriptRecordBaseSchema = z.looseObject({
  timestamp: IsoTimestampSchema,
});

export const ClaudeTranscriptRecordSchema = TranscriptRecordBaseSchema.extend({
  type: z.string().min(1),
  uuid: z.string().min(1),
  sessionId: z.string().min(1),
  message: z
    .looseObject({
      content: z.array(z.looseObject({ type: z.string().min(1) })).optional(),
    })
    .optional(),
});

export const CodexTranscriptRecordSchema = TranscriptRecordBaseSchema.extend({
  source: z.literal('codex'),
  type: z.enum(['turn', 'tool_call', 'tool_result', 'usage']),
  id: z.string().min(1),
  session_id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'tool', 'system']).optional(),
});

export const PiTranscriptRecordSchema = z.looseObject({
  source: z.literal('pi'),
  event: z.string().min(1),
  id: z.string().min(1),
  sessionId: z.string().min(1),
  ts: IsoTimestampSchema,
  actor: z.looseObject({ type: z.enum(['user', 'agent', 'tool', 'system']) }),
});

export const SourceTranscriptRecordSchemas = {
  claude: ClaudeTranscriptRecordSchema,
  codex: CodexTranscriptRecordSchema,
  pi: PiTranscriptRecordSchema,
} as const;

export const SourceTranscriptFixtures = {
  claude: ['source-transcripts', 'claude', 'projects', '-synthetic-loopwatch', 'claude-alpha-session.jsonl'],
  codex: ['source-transcripts', 'codex', 'codex-alpha-session.jsonl'],
  pi: ['source-transcripts', 'pi', 'pi-alpha-session.jsonl'],
} as const;

export type SourceFixtureName = keyof typeof SourceTranscriptFixtures;

export type LoadedSourceTranscriptFixture = {
  source: SourceFixtureName;
  relativePath: readonly string[];
  records: unknown[];
};

export async function loadSourceTranscriptFixture(source: SourceFixtureName): Promise<LoadedSourceTranscriptFixture> {
  const relativePath = SourceTranscriptFixtures[source];
  const records = await readJsonlFixture(...relativePath);
  const schema = SourceTranscriptRecordSchemas[source];
  const parsed = records.map((record) => schema.parse(record));
  return { source, relativePath, records: parsed };
}

export async function loadAllSourceTranscriptFixtures(): Promise<LoadedSourceTranscriptFixture[]> {
  return Promise.all((Object.keys(SourceTranscriptFixtures) as SourceFixtureName[]).map((source) => loadSourceTranscriptFixture(source)));
}
