import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

export const LoopStopConditionSchema = z.object({
  evidence: z.string().min(1),
  observable: z.boolean().default(true),
});
export type LoopStopCondition = z.infer<typeof LoopStopConditionSchema>;

export const LoopSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'loop id must be a lowercase slug'),
  title: z.string().min(1),
  summary: z.string().min(1),
  trigger: z.string().min(1),
  action: z.string().min(1),
  verification: z.string().min(1),
  memory: z.string().min(1),
  stopCondition: LoopStopConditionSchema,
  tags: z.array(z.string().min(1)).default([]),
});
export type Loop = z.infer<typeof LoopSchema>;

export const StoredUserLoopsSchema = z.array(LoopSchema);

export const LoopLibraryResponseSchema = z.object({
  ok: z.literal(true),
  starter: z.array(LoopSchema),
  user: z.array(LoopSchema),
  loops: z.array(LoopSchema),
  userLoopsPath: z.string().min(1),
});
export type LoopLibraryResponse = z.infer<typeof LoopLibraryResponseSchema>;

export const CoachingCardSchema = z.object({
  type: z.literal('coaching'),
  task: z.string().min(1),
  loop: LoopSchema,
  score: z.number().nonnegative(),
  reason: z.string().min(1),
  copyPrompt: z.string().min(1),
  recommendationOnly: z.literal(true),
});
export type CoachingCard = z.infer<typeof CoachingCardSchema>;

export const LoopRecommendationResponseSchema = z.object({
  ok: z.literal(true),
  card: CoachingCardSchema,
  loops: z.array(LoopSchema),
  userLoopsPath: z.string().min(1),
});
export type LoopRecommendationResponse = z.infer<typeof LoopRecommendationResponseSchema>;

export interface LoopLibraryOptions {
  userLoopsPath?: string;
}

const DEFAULT_USER_LOOPS_PATH = 'data/loop-library/user-loops.json';

export const STARTER_LOOPS: Loop[] = [
  {
    id: 'vertical-feature-slice',
    title: 'Vertical Feature Slice',
    summary: 'Build one user-visible increment from contract through verification and review.',
    trigger: 'Use when a task asks to implement a product feature, issue slice, or acceptance-criteria-driven change.',
    action: 'Define the smallest complete user outcome, implement across the necessary stack, and keep every caller on the clean cutover path.',
    verification: 'Run the focused deterministic checks for the changed contract, then run the relevant smoke or E2E path and reviewer gate.',
    memory: 'Record issue number, ADRs, changed contracts, reviewer findings, and exact verification commands in the issue evidence comment.',
    stopCondition: {
      evidence: 'All stated acceptance criteria pass with deterministic harness output and reviewer sign-off; no unverified TODO or shim remains.',
      observable: true,
    },
    tags: ['feature', 'implementation', 'issue', 'slice', 'acceptance', 'verify', 'review', 'test'],
  },
  {
    id: 'diagnose-reproduce-fix',
    title: 'Diagnose → Reproduce → Fix',
    summary: 'Turn a reported bug into a reproduction, fix the source cause, and defend it with a regression check.',
    trigger: 'Use when behavior is failing, throwing, slow, flaky, or contradicted by a concrete report.',
    action: 'Reproduce the failure, isolate the source cause, make the smallest source fix, and remove obsolete workaround code.',
    verification: 'Keep the failing reproduction as a regression check and rerun the narrow command that proves the corrected behavior.',
    memory: 'Capture the symptom, root cause, regression fixture, and command output so the next maintainer can recognize the failure mode.',
    stopCondition: {
      evidence: 'The original failure reproduces before the fix or is otherwise explained, then the regression check passes on the fixed behavior.',
      observable: true,
    },
    tags: ['bug', 'debug', 'diagnose', 'regression', 'failure', 'slow', 'flaky', 'fix'],
  },
  {
    id: 'watchtower-ui-fidelity',
    title: 'Watchtower UI Fidelity',
    summary: 'Bring Cockpit UX changes to a shippable visual and interaction standard.',
    trigger: 'Use when work changes the Cockpit, Intervention card, Coaching card, timeline, rail, Pulse, or other user-facing surfaces.',
    action: 'Implement with Tailwind theme tokens, preserve dense Watchtower information hierarchy, and remove placeholder UI.',
    verification: 'Run focused UI type checks, Playwright coverage for the interaction, and a visual smoke pass when appearance changed.',
    memory: 'Record the affected screen, interaction state, viewport, and evidence that the rendered UI uses real normalized data.',
    stopCondition: {
      evidence: 'The changed UI renders real data, passes Playwright interaction coverage, and has no raw color literals or placeholder copy.',
      observable: true,
    },
    tags: ['ui', 'cockpit', 'watchtower', 'card', 'timeline', 'rail', 'visual', 'playwright'],
  },
  {
    id: 'release-hardening-gate',
    title: 'Release Hardening Gate',
    summary: 'Turn a pile of passing slices into release evidence with security, privacy, packaging, and smoke coverage.',
    trigger: 'Use when preparing to ship, harden, package, or cut a release candidate.',
    action: 'Run the release baseline, close open review findings, validate privacy/security boundaries, and package the app artifact.',
    verification: 'Run deterministic evals, security checks, Playwright, platform smoke, and release build commands with exact outputs captured.',
    memory: 'Record commit ids, issue evidence links, remaining non-blocking risks, artifact paths, and the final definition-of-done audit.',
    stopCondition: {
      evidence: 'The release baseline, security gate, UI smoke, and package build all pass, with remaining risks explicitly documented.',
      observable: true,
    },
    tags: ['release', 'ship', 'hardening', 'security', 'privacy', 'baseline', 'package', 'eval'],
  },
];

export function userLoopsPathFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.LOOPWATCH_USER_LOOPS_PATH?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_USER_LOOPS_PATH;
}

export async function loadLoopLibrary(options: LoopLibraryOptions = {}): Promise<LoopLibraryResponse> {
  const userLoopsPath = options.userLoopsPath ?? userLoopsPathFromEnv();
  const user = await readUserLoops(userLoopsPath);
  const loops = [...STARTER_LOOPS, ...user];
  return LoopLibraryResponseSchema.parse({ ok: true, starter: STARTER_LOOPS, user, loops, userLoopsPath });
}

export async function addUserLoop(input: unknown, options: LoopLibraryOptions = {}): Promise<Loop> {
  const userLoopsPath = options.userLoopsPath ?? userLoopsPathFromEnv();
  const loop = LoopSchema.parse(input);
  const current = await readUserLoops(userLoopsPath);
  const next = [...current.filter((candidate) => candidate.id !== loop.id), loop].sort((a, b) => a.id.localeCompare(b.id));
  await mkdir(dirname(userLoopsPath), { recursive: true });
  await writeFile(userLoopsPath, `${JSON.stringify(next, null, 2)}\n`);
  return loop;
}

export function recommendLoop(task: string, loops: Loop[] = STARTER_LOOPS): CoachingCard {
  const normalizedTask = task.trim();
  if (!normalizedTask) throw new Error('task is required for Loop recommendation');
  if (loops.length === 0) throw new Error('Loop Library is empty');

  const ranked = loops.map((loop) => scoreLoop(normalizedTask, loop)).sort((a, b) => b.score - a.score || a.loop.title.localeCompare(b.loop.title));
  const best = ranked[0]!;
  return CoachingCardSchema.parse({
    type: 'coaching',
    task: normalizedTask,
    loop: best.loop,
    score: best.score,
    reason: recommendationReason(best),
    copyPrompt: copyPromptForLoop(normalizedTask, best.loop),
    recommendationOnly: true,
  });
}

export async function recommendLoopFromLibrary(task: string, options: LoopLibraryOptions = {}): Promise<LoopRecommendationResponse> {
  const library = await loadLoopLibrary(options);
  const card = recommendLoop(task, library.loops);
  return LoopRecommendationResponseSchema.parse({ ok: true, card, loops: library.loops, userLoopsPath: library.userLoopsPath });
}

async function readUserLoops(userLoopsPath: string): Promise<Loop[]> {
  try {
    const raw = await readFile(userLoopsPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return StoredUserLoopsSchema.parse(parsed);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

function scoreLoop(task: string, loop: Loop): { loop: Loop; score: number; matched: string[] } {
  const taskTokens = new Set(tokenize(task));
  const tagMatches = loop.tags.filter((tag) => taskTokens.has(normalizeToken(tag)));
  const triggerTokens = tokenize(`${loop.title} ${loop.summary} ${loop.trigger}`);
  const triggerMatches = [...new Set(triggerTokens.filter((token) => taskTokens.has(token)))];
  const score = tagMatches.length * 4 + triggerMatches.length * 2 + semanticBoost(task, loop);
  return { loop, score, matched: [...new Set([...tagMatches, ...triggerMatches])] };
}

function semanticBoost(task: string, loop: Loop): number {
  const normalized = task.toLowerCase();
  if (loop.id === 'diagnose-reproduce-fix' && /\b(bug|debug|failing|failure|broken|regression|slow|flaky|throwing)\b/.test(normalized)) return 8;
  if (loop.id === 'watchtower-ui-fidelity' && /\b(ui|cockpit|visual|card|timeline|rail|playwright|layout)\b/.test(normalized)) return 8;
  if (loop.id === 'release-hardening-gate' && /\b(ship|release|hardening|security|privacy|package|baseline|eval)\b/.test(normalized)) return 8;
  if (loop.id === 'vertical-feature-slice' && /\b(feature|implement|issue|slice|acceptance|build|add)\b/.test(normalized)) return 6;
  return 0;
}

function recommendationReason(scored: { loop: Loop; score: number; matched: string[] }): string {
  if (scored.matched.length > 0) return `Matched ${scored.loop.title} from task terms: ${scored.matched.slice(0, 5).join(', ')}.`;
  return `Defaulted to ${scored.loop.title}; it is the safest starter loop when the task needs a complete verified outcome.`;
}

function copyPromptForLoop(task: string, loop: Loop): string {
  return [
    `Use the "${loop.title}" Loop for this task.`,
    '',
    `Task: ${task}`,
    '',
    `Trigger: ${loop.trigger}`,
    '',
    `Action: ${loop.action}`,
    '',
    `Verification: ${loop.verification}`,
    '',
    `Memory: ${loop.memory}`,
    '',
    `Stop condition: ${loop.stopCondition.evidence}`,
    '',
    'Recommendation only: Loopwatch does not execute this loop. You must run any verification yourself and report the evidence before claiming done.',
  ].join('\n');
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(normalizeToken)
    .filter((token) => token.length >= 3);
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/s$/, '');
}

function isNotFound(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}
