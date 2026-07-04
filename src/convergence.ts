import { gitSnapshotFromEvent, type GitEvidenceSnapshot } from './git-watch.js';
import { DEFAULT_LOOP_ANCHOR_SCORE_THRESHOLD, STARTER_LOOPS, detectLoop, type Loop } from './loops.js';
import { sessionKey, type LoopwatchEvent } from './events.js';

export type ConvergenceStatus = 'calm' | 'watch' | 'intervention';
export type ConvergenceLiveness = 'active' | 'idle' | 'ended';
export type JudgeTier = 'cheap' | 'strong';
export type ConvergenceSignal = 'drift' | 'burn' | 'weak_validation' | 'churn' | 'completion_without_evidence';
export type PivotMode = 'calm' | 'loud';

export interface ConvergenceEvidenceRef {
  eventId: string;
  timestamp: string;
  kind: string;
  severity: ConvergenceStatus;
  signal: ConvergenceSignal;
  title: string;
  detail: string;
  recommendedAction?: string;
}

export interface RunningSummary {
  goal: string;
  done: string[];
  validation: string[];
  concerns: string[];
}

export interface LoopAnchor {
  loopId: string;
  title: string;
  source: 'opening_prompt';
  confidence: number;
  threshold?: number;
  reason: string;
  stopCondition: {
    evidence: string;
    observable: boolean;
  };
}

export interface PivotNudge {
  id: string;
  eventId: string;
  timestamp: string;
  mode: PivotMode;
  source: 'user_redirection';
  title: string;
  detail: string;
  recommendedAction: string;
  fromGoal: string;
  toGoal: string;
}

export interface ConvergenceSpend {
  cheapCalls: number;
  strongCalls: number;
  totalCalls: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
}

export interface JudgeCadence {
  provider: 'deterministic-fake-v1';
  lastTier?: JudgeTier;
  lastRunAt?: string;
  nextEligibleAt?: string;
  lastReason?: string;
  rateCapMs: number;
}

export interface SessionConvergenceState {
  id: string;
  source: string;
  sessionId: string;
  status: ConvergenceStatus;
  liveness: ConvergenceLiveness;
  summary: RunningSummary;
  evidence: ConvergenceEvidenceRef[];
  judge: JudgeCadence;
  spend: ConvergenceSpend;
  eventCount: number;
  meaningfulEventCount: number;
  lastEventAt: string;
  git?: GitEvidenceSnapshot;
  loopAnchor?: LoopAnchor;
  pivotNudge?: PivotNudge;
}

export interface ConvergenceSnapshot {
  sessions: SessionConvergenceState[];
  spend: ConvergenceSpend;
  nextPollMs: number;
}

export interface ConvergenceConfig {
  nowMs?: number;
  minJudgeIntervalMs?: number;
  idleAfterMs?: number;
  endedAfterMs?: number;
  burnTokenThreshold?: number;
  registry?: ConvergenceWatcherRegistry;
  loops?: Loop[];
  loopAnchorScoreThreshold?: number;
  loopAnchoring?: {
    loops?: Loop[];
    confidenceThreshold?: number;
  };
  pivotMode?: PivotMode;
}

interface ConvergenceWatcherMemory {
  lastJudgedCursor: string;
  lastJudgedAtMs?: number;
  lastTier?: JudgeTier;
  lastReason?: string;
  status: ConvergenceStatus;
  evidence: ConvergenceEvidenceRef[];
  spend: ConvergenceSpend;
}

export interface ConvergenceWatcherRegistry {
  sessions: Map<string, ConvergenceWatcherMemory>;
  retiredSpendBySession: Map<string, ConvergenceSpend>;
}

const DEFAULT_MIN_JUDGE_INTERVAL_MS = 30_000;
const DEFAULT_IDLE_AFTER_MS = 5 * 60_000;
const DEFAULT_ENDED_AFTER_MS = 30 * 60_000;
const DEFAULT_BURN_TOKEN_THRESHOLD = 20_000;
const NEXT_POLL_MS = 2_000;
const CHEAP_TOKENS_PER_CALL = 350;
const STRONG_TOKENS_PER_CALL = 1_400;
const CHEAP_COST_USD_PER_CALL = 0.00007;
const STRONG_COST_USD_PER_CALL = 0.0014;
const MAX_SUMMARY_ITEMS = 5;

const completionPattern = /\b(done|complete(?:d)?|finished|implemented|fixed|shipped|ready)\b/i;
const driftPattern = /\b(unrelated|different task|off[- ]?track|wrong goal|instead of)\b/i;
const validationCommandPattern = /\b(test|verify|lint|typecheck|tsc|build|cargo\s+test|go\s+test|pytest|vitest|jest|playwright|cypress|harness|check)\b/i;
const fileToolNames: Record<string, true> = { edit: true, write: true, multiedit: true, patch: true };

const recommendedActions: Record<ConvergenceSignal, string> = {
  drift: 'Restate the active goal, or explicitly pivot before continuing.',
  burn: 'Pause the run, summarize the current state, and choose a smaller next step before spending more judge calls.',
  weak_validation: 'Produce the missing or failing validation evidence, then rerun or cite the exact check before claiming convergence.',
  churn: 'Stop retrying the same failing path; explain the repeated failure and pick a different repair strategy.',
  completion_without_evidence: 'Run or cite the expected verification evidence before closing the session.',
};

const defaultRegistry: ConvergenceWatcherRegistry = createConvergenceWatcherRegistry();

export function createConvergenceWatcherRegistry(): ConvergenceWatcherRegistry {
  return {
    sessions: new Map(),
    retiredSpendBySession: new Map(),
  };
}

export function buildConvergenceSnapshot(events: LoopwatchEvent[], config: ConvergenceConfig = {}): ConvergenceSnapshot {
  const nowMs = config.nowMs ?? Date.now();
  const rateCapMs = config.minJudgeIntervalMs ?? DEFAULT_MIN_JUDGE_INTERVAL_MS;
  const registry = config.registry ?? defaultRegistry;
  const grouped = groupEvents(events);
  const liveSessionIds = new Set(grouped.keys());
  const sessions: SessionConvergenceState[] = [];
  for (const [id, sessionEvents] of grouped) {
    sessions.push(buildSessionConvergence(id, sessionEvents, nowMs, rateCapMs, registry, config));
  }

  retireAbsentSessions(registry, liveSessionIds);
  sessions.sort((a, b) => Date.parse(b.lastEventAt) - Date.parse(a.lastEventAt));
  return {
    sessions,
    spend: sumSpend([...registry.retiredSpendBySession.values(), ...sessions.map((session) => session.spend)]),
    nextPollMs: NEXT_POLL_MS,
  };
}

export function convergenceConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Pick<ConvergenceConfig, 'minJudgeIntervalMs' | 'idleAfterMs' | 'endedAfterMs' | 'burnTokenThreshold' | 'pivotMode'> {
  return {
    minJudgeIntervalMs: positiveIntEnv(env.LOOPWATCH_CONVERGENCE_MIN_JUDGE_INTERVAL_MS),
    idleAfterMs: positiveIntEnv(env.LOOPWATCH_CONVERGENCE_IDLE_AFTER_MS),
    endedAfterMs: positiveIntEnv(env.LOOPWATCH_CONVERGENCE_ENDED_AFTER_MS),
    burnTokenThreshold: positiveIntEnv(env.LOOPWATCH_CONVERGENCE_BURN_TOKENS),
    pivotMode: pivotModeFromEnv(env.LOOPWATCH_PIVOT_MODE),
  };
}

function buildSessionConvergence(
  id: string,
  events: LoopwatchEvent[],
  nowMs: number,
  rateCapMs: number,
  registry: ConvergenceWatcherRegistry,
  config: ConvergenceConfig,
): SessionConvergenceState {
  const orderedEvents = [...events].sort(compareEvents);
  const meaningfulEvents = orderedEvents.filter(isMeaningfulEvent);
  const baseSummary = summarizeSession(orderedEvents);
  const pivotNudge = detectPivotNudge(orderedEvents, config, baseSummary.goal);
  const summary = pivotNudge ? { ...baseSummary, goal: pivotNudge.toGoal } : baseSummary;
  const loop = pivotNudge ? undefined : detectSessionLoop(orderedEvents, config);
  const liveness = livenessForEvent(orderedEvents.at(-1), nowMs, config);
  const memory = activeOrRetiredMemory(registry, id);
  const meaningfulCursor = meaningfulEvents.map(eventId).join('|');
  const shouldJudge = liveness === 'active' && meaningfulCursor.length > 0 && meaningfulCursor !== memory.lastJudgedCursor && judgeRateCapAllows(memory, nowMs, rateCapMs);
  if (shouldJudge) {
    const judgement = judgeSession(summary, orderedEvents, config, loop);
    memory.spend.cheapCalls += 1;
    memory.spend.estimatedTokens += CHEAP_TOKENS_PER_CALL;
    memory.spend.estimatedCostUsd += CHEAP_COST_USD_PER_CALL;

    if (judgement.requiresStrongModel) {
      memory.spend.strongCalls += 1;
      memory.spend.estimatedTokens += STRONG_TOKENS_PER_CALL;
      memory.spend.estimatedCostUsd += STRONG_COST_USD_PER_CALL;
      memory.lastTier = 'strong';
    } else {
      memory.lastTier = 'cheap';
    }

    memory.spend.totalCalls = memory.spend.cheapCalls + memory.spend.strongCalls;
    memory.status = judgement.status;
    memory.evidence = judgement.evidence;
    memory.lastReason = judgement.reason;
    memory.lastJudgedAtMs = nowMs;
    memory.lastJudgedCursor = meaningfulCursor;
  }

  registry.sessions.set(id, memory);
  const [source, sessionId] = splitSessionId(id, orderedEvents[0]);
  const git = latestGitSnapshot(orderedEvents);
  return {
    id,
    source,
    sessionId,
    status: memory.status,
    liveness,
    summary: { ...summary, concerns: memory.evidence.map((evidence) => evidence.title).slice(0, MAX_SUMMARY_ITEMS) },
    evidence: memory.evidence,
    judge: {
      provider: 'deterministic-fake-v1',
      lastTier: memory.lastTier,
      lastRunAt: memory.lastJudgedAtMs === undefined ? undefined : new Date(memory.lastJudgedAtMs).toISOString(),
      nextEligibleAt: memory.lastJudgedAtMs === undefined ? undefined : new Date(memory.lastJudgedAtMs + rateCapMs).toISOString(),
      lastReason: memory.lastReason,
      rateCapMs,
    },
    spend: roundSpend(memory.spend),
    eventCount: orderedEvents.length,
    meaningfulEventCount: meaningfulEvents.length,
    lastEventAt: orderedEvents.at(-1)?.timestamp ?? '',
    ...(git ? { git } : {}),
    ...(loop ? { loopAnchor: loop } : {}),
    ...(pivotNudge ? { pivotNudge } : {}),
  };
}

function judgeSession(summary: RunningSummary, events: LoopwatchEvent[], config: ConvergenceConfig, loop?: LoopAnchor): { status: ConvergenceStatus; evidence: ConvergenceEvidenceRef[]; requiresStrongModel: boolean; reason: string } {
  const evidence: ConvergenceEvidenceRef[] = [];
  const failedValidations = events.filter((event) => isValidationEvent(event) && validationExitCode(event) !== undefined && validationExitCode(event) !== 0);
  const successfulValidations = events.filter((event) => isValidationEvent(event) && validationExitCode(event) === 0);
  const requiredValidationEvidenceFound = requiredValidationEvidenceObserved(successfulValidations, loop);
  const completionClaim = [...events].reverse().find((event) => event.kind === 'message' && event.actor.type === 'agent' && completionPattern.test(textFromEvent(event) ?? ''));
  const driftEvent = events.find((event) => event.kind === 'message' && event.actor.type === 'agent' && driftPattern.test(textFromEvent(event) ?? ''));
  const burnEvent = events.find((event) => tokenTotal(event) >= (config.burnTokenThreshold ?? DEFAULT_BURN_TOKEN_THRESHOLD));
  const latestGit = latestGitEvidence(events);
  const repeatedFailure = repeatedFailingCommand(failedValidations);

  if (driftEvent) {
    evidence.push(evidenceRef(driftEvent, 'intervention', 'drift', 'Possible drift from the inferred goal', compact(textFromEvent(driftEvent) ?? 'agent message suggests a different task', 180)));
  }

  if (completionClaim && !requiredValidationEvidenceFound && loop?.stopCondition.observable !== false) {
    const missingLoopEvidence = loop !== undefined;
    const signal: ConvergenceSignal = missingLoopEvidence ? 'weak_validation' : 'completion_without_evidence';
    const title = missingLoopEvidence ? 'Loop stop-condition evidence is missing' : 'Completion claim has no supporting validation evidence';
    const detail = missingLoopEvidence ? `Expected evidence for ${loop.title}: ${loop.stopCondition.evidence}` : compact(textFromEvent(completionClaim) ?? 'agent claimed completion', 180);
    if (latestGit && latestGit.snapshot.dirty) {
      evidence.push(
        evidenceRef(
          latestGit.event,
          'intervention',
          signal,
          missingLoopEvidence ? 'Git evidence does not satisfy the loop stop condition' : 'Git evidence contradicts the completion claim',
          missingLoopEvidence ? `${detail}; ${gitEvidenceDetail(latestGit.snapshot)}` : gitEvidenceDetail(latestGit.snapshot),
        ),
      );
    } else {
      evidence.push(
        evidenceRef(
          completionClaim,
          'intervention',
          signal,
          title,
          detail,
        ),
      );
    }
  }

  if (repeatedFailure) {
    evidence.push(
      evidenceRef(
        repeatedFailure.event,
        'intervention',
        'churn',
        'Repeated validation failure before convergence',
        `${repeatedFailure.command} failed ${repeatedFailure.count} times`,
      ),
    );
  } else if (failedValidations.length > 0) {
    const failed = failedValidations.at(-1)!;
    evidence.push(evidenceRef(failed, 'watch', 'weak_validation', 'Validation failed before the session converged', validationSummary(failed)));
  }

  if (burnEvent) {
    evidence.push(evidenceRef(burnEvent, 'watch', 'burn', 'Token burn spike needs attention', `${tokenTotal(burnEvent)} observed tokens crossed the configured burn threshold`));
  }

  const status = maxStatus(evidence.map((item) => item.severity));
  return {
    status,
    evidence,
    requiresStrongModel: evidence.some((item) => item.severity !== 'calm'),
    reason: evidence.length === 0 ? judgeReason(summary, loop) : evidence.map((item) => item.signal).join(','),
  };
}

function summarizeSession(events: LoopwatchEvent[]): RunningSummary {
  const goal = compact(events.find((event) => event.kind === 'message' && event.actor.type === 'user' && !isToolResultMessage(event)) ? textFromEvent(events.find((event) => event.kind === 'message' && event.actor.type === 'user' && !isToolResultMessage(event))!) ?? '' : '', 220) || 'No opening request inferred yet.';
  const done: string[] = [];
  const validation: string[] = [];

  for (const event of events) {
    const text = textFromEvent(event);
    const command = commandFromEvent(event);
    if (event.kind === 'message' && event.actor.type === 'agent' && text) done.push(compact(text, 180));
    if (event.kind === 'tool_call' && command) done.push(compact(command, 180));
    if (isValidationEvent(event)) validation.push(validationSummary(event));
  }

  return {
    goal,
    done: done.slice(-MAX_SUMMARY_ITEMS),
    validation: validation.slice(-MAX_SUMMARY_ITEMS),
    concerns: [],
  };
}

function detectSessionLoop(events: LoopwatchEvent[], config: ConvergenceConfig): LoopAnchor | undefined {
  const opening = openingUserMessage(events);
  if (!opening) return undefined;

  const { loops, threshold } = loopAnchoringOptions(config);
  if (loops.length === 0) return undefined;

  const detection = detectLoop(opening, loops, threshold * 12);
  if (!detection.anchored || !detection.match) return undefined;

  const { loop, score, reason } = detection.match;
  const confidence = scoreToConfidence(score);
  return {
    loopId: loop.id,
    title: loop.title,
    source: 'opening_prompt',
    confidence,
    threshold,
    reason,
    stopCondition: loop.stopCondition,
  };
}

function openingUserMessage(events: LoopwatchEvent[]): string | undefined {
  const opening = events.find((event) => event.kind === 'message' && event.actor.type === 'user' && !isToolResultMessage(event));
  return opening ? textFromEvent(opening) : undefined;
}

function judgeReason(summary: RunningSummary, loop: LoopAnchor | undefined): string {
  if (loop) return `cheap judge found no concerns against ${loop.title} stop condition: ${loop.stopCondition.evidence}`;
  return `cheap judge found no concerns for ${summary.goal}`;
}

function loopAnchoringOptions(config: ConvergenceConfig): { loops: Loop[]; threshold: number } {
  if (config.loopAnchoring) {
    return {
      loops: config.loopAnchoring.loops ?? STARTER_LOOPS,
      threshold: config.loopAnchoring.confidenceThreshold ?? scoreToConfidence(DEFAULT_LOOP_ANCHOR_SCORE_THRESHOLD),
    };
  }
  if (config.loops || config.loopAnchorScoreThreshold !== undefined) {
    return {
      loops: config.loops ?? STARTER_LOOPS,
      threshold: scoreToConfidence(config.loopAnchorScoreThreshold ?? DEFAULT_LOOP_ANCHOR_SCORE_THRESHOLD),
    };
  }
  return { loops: [], threshold: scoreToConfidence(DEFAULT_LOOP_ANCHOR_SCORE_THRESHOLD) };
}

function scoreToConfidence(score: number): number {
  return Math.max(0, Math.min(1, score / 12));
}

function requiredValidationEvidenceObserved(successfulValidations: LoopwatchEvent[], loop: LoopAnchor | undefined): boolean {
  if (!loop) return successfulValidations.length > 0;
  if (!loop.stopCondition.observable) return successfulValidations.length > 0;
  return successfulValidations.some((event) => validationEvidenceMatchesStopCondition(event, loop));
}

function validationEvidenceMatchesStopCondition(event: LoopwatchEvent, loop: LoopAnchor): boolean {
  const terms = significantTerms(loop.stopCondition.evidence);
  if (terms.length === 0) return true;
  const evidence = normalizeEvidenceText(validationEvidenceText(event));
  const matched = terms.filter((term) => evidence.includes(term));
  return matched.length >= Math.min(4, Math.ceil(terms.length * 0.35));
}

function validationEvidenceText(event: LoopwatchEvent): string {
  const payload = payloadRecord(event);
  const parts = [
    commandFromEvent(event),
    textFromEvent(event),
    stringValue(payload?.output),
    stringValue(recordValue(payload?.validation)?.detail),
  ];
  return parts.filter((part): part is string => part !== undefined).join(' ');
}

function significantTerms(value: string): string[] {
  const stopWords = new Set(['and', 'the', 'with', 'that', 'this', 'when', 'then', 'from', 'into', 'only', 'every', 'stated', 'condition', 'evidence']);
  return [
    ...new Set(
      normalizeEvidenceText(value)
        .split(/\s+/)
        .filter((term) => term.length >= 4 && !stopWords.has(term)),
    ),
  ];
}

function normalizeEvidenceText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function detectPivotNudge(events: LoopwatchEvent[], config: ConvergenceConfig, openingGoal: string): PivotNudge | undefined {
  const userMessages = events.filter((event) => event.kind === 'message' && event.actor.type === 'user' && !isToolResultMessage(event));
  if (userMessages.length < 2) return undefined;

  const opening = userMessages[0]!;
  for (const candidate of userMessages.slice(1)) {
    const text = textFromEvent(candidate);
    if (!text) continue;
    if (!hasPriorAgentWork(events, candidate)) continue;
    if (!isPivotRedirection(text, textFromEvent(opening) ?? openingGoal)) continue;

    const toGoal = compact(text, 220);
    return {
      id: `pivot:${eventId(candidate)}`,
      eventId: eventId(candidate),
      timestamp: candidate.timestamp,
      mode: config.pivotMode ?? 'calm',
      source: 'user_redirection',
      title: 'Pivot detected — consider a fresh session',
      detail: `The user changed the active goal from "${compact(openingGoal, 110)}" to "${compact(toGoal, 130)}".`,
      recommendedAction: 'Start a fresh agent session for the new goal; Loopwatch will keep observing this session if you continue here.',
      fromGoal: openingGoal,
      toGoal,
    };
  }

  return undefined;
}

function hasPriorAgentWork(events: LoopwatchEvent[], pivotEvent: LoopwatchEvent): boolean {
  const pivotAt = Date.parse(pivotEvent.timestamp);
  return events.some((event) => {
    if (Date.parse(event.timestamp) >= pivotAt) return false;
    if (event.kind === 'tool_call' || event.kind === 'tool_result') return true;
    return event.kind === 'message' && event.actor.type === 'agent';
  });
}

function isPivotRedirection(text: string, openingGoal: string): boolean {
  const normalized = text.toLowerCase();
  if (benignClarificationPattern.test(normalized)) return false;
  const hasPivotMarker = pivotPattern.test(normalized);
  if (!hasPivotMarker) return false;
  return topicOverlap(text, openingGoal) < 0.45 || explicitFreshTopicPattern.test(normalized);
}

const pivotPattern = /\b(actually|instead|new task|different task|change(?:ing)? (?:the )?(?:topic|goal|plan)|switch(?:ing)? to|pivot(?:ing)? to|forget (?:that|the previous)|start over|new goal|separate task|now (?:let'?s|please|can you))\b/i;
const explicitFreshTopicPattern = /\b(new task|different task|separate task|new goal|switch(?:ing)? to|pivot(?:ing)? to|forget (?:that|the previous)|start over)\b/i;
const benignClarificationPattern = /\b(to clarify|clarification|what i meant|i mean|same task|same goal|small tweak|minor tweak|one more detail|acceptance criteri(?:a|on)|could you explain|can you explain|why did|what does)\b/i;

function topicOverlap(nextGoal: string, openingGoal: string): number {
  const nextTokens = new Set(topicTokens(nextGoal));
  const openingTokens = new Set(topicTokens(openingGoal));
  if (nextTokens.size === 0 || openingTokens.size === 0) return 0;
  let shared = 0;
  for (const token of nextTokens) {
    if (openingTokens.has(token)) shared += 1;
  }
  return shared / Math.min(nextTokens.size, openingTokens.size);
}

function topicTokens(value: string): string[] {
  const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'please', 'can', 'you', 'now', 'actually', 'instead', 'task', 'goal']);
  return normalizeEvidenceText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !stopWords.has(token));
}

function latestGitSnapshot(events: LoopwatchEvent[]): GitEvidenceSnapshot | undefined {
  return latestGitEvidence(events)?.snapshot;
}

function latestGitEvidence(events: LoopwatchEvent[]): { event: LoopwatchEvent; snapshot: GitEvidenceSnapshot } | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    const snapshot = gitSnapshotFromEvent(event);
    if (snapshot) return { event, snapshot };
  }
  return undefined;
}

function gitEvidenceDetail(snapshot: GitEvidenceSnapshot): string {
  const diff = `${snapshot.diff.files} files, +${snapshot.diff.insertions}/-${snapshot.diff.deletions}`;
  const files = snapshot.changedFiles.slice(0, 5).join(', ') || 'no changed files';
  const overflow = snapshot.changedFiles.length > 5 ? `, +${snapshot.changedFiles.length - 5} more` : '';
  return `${snapshot.repo}@${snapshot.branch}: dirty working tree (${diff}); ${snapshot.validation.detail}; files: ${files}${overflow}`;
}

function groupEvents(events: LoopwatchEvent[]): Map<string, LoopwatchEvent[]> {
  const grouped = new Map<string, LoopwatchEvent[]>();
  for (const event of events) {
    const key = sessionKey(event);
    const group = grouped.get(key) ?? [];
    group.push(event);
    grouped.set(key, group);
  }
  return grouped;
}

function retireAbsentSessions(registry: ConvergenceWatcherRegistry, liveSessionIds: Set<string>): void {
  for (const [id, memory] of registry.sessions) {
    if (liveSessionIds.has(id)) continue;
    registry.retiredSpendBySession.set(id, sumSpend([registry.retiredSpendBySession.get(id) ?? emptySpend(), memory.spend]));
    registry.sessions.delete(id);
  }
}

function activeOrRetiredMemory(registry: ConvergenceWatcherRegistry, id: string): ConvergenceWatcherMemory {
  const active = registry.sessions.get(id);
  if (active) return active;
  const retiredSpend = registry.retiredSpendBySession.get(id);
  registry.retiredSpendBySession.delete(id);
  return newWatcherMemory(retiredSpend);
}


function emptySpend(): ConvergenceSpend {
  return { cheapCalls: 0, strongCalls: 0, totalCalls: 0, estimatedTokens: 0, estimatedCostUsd: 0 };
}

function newWatcherMemory(spend: ConvergenceSpend = emptySpend()): ConvergenceWatcherMemory {
  return {
    lastJudgedCursor: '',
    status: 'calm',
    evidence: [],
    spend: cloneSpend(spend),
  };
}

function cloneSpend(spend: ConvergenceSpend): ConvergenceSpend {
  return { ...spend };
}

function judgeRateCapAllows(memory: ConvergenceWatcherMemory, nowMs: number, rateCapMs: number): boolean {
  return memory.lastJudgedAtMs === undefined || nowMs - memory.lastJudgedAtMs >= rateCapMs;
}

function isMeaningfulEvent(event: LoopwatchEvent): boolean {
  if (event.kind === 'message') return true;
  if (event.kind === 'usage') return true;
  if (isValidationEvent(event)) return true;
  const command = commandFromEvent(event);
  if (gitSnapshotFromEvent(event)) return true;
  if (command && /^\s*git\s+(commit|diff|status|push)\b/i.test(command)) return true;
  const tool = toolNameFromEvent(event)?.toLowerCase();
  return tool !== undefined && fileToolNames[tool] === true;
}

function isValidationEvent(event: LoopwatchEvent): boolean {
  const command = commandFromEvent(event) ?? '';
  if (validationCommandPattern.test(command)) return true;
  const payload = payloadRecord(event);
  if (recordValue(payload?.validation) !== undefined) return true;
  return validationExitCode(event) !== undefined && contentBlocks(event).some((block) => block.type === 'tool_result');
}

function isToolResultMessage(event: LoopwatchEvent): boolean {
  if (event.kind !== 'message') return false;
  return contentBlocks(event).some((block) => block.type === 'tool_result');
}

function validationExitCode(event: LoopwatchEvent): number | undefined {
  const payload = payloadRecord(event);
  const direct = numberValue(payload?.exitCode) ?? numberValue(recordValue(payload?.tool)?.exit_code) ?? numberValue(recordValue(payload?.validation)?.exitCode);
  if (direct !== undefined) return direct;
  const resultBlock = contentBlocks(event).find((block) => block.type === 'tool_result');
  if (typeof resultBlock?.is_error === 'boolean') return resultBlock.is_error ? 1 : 0;
  return undefined;
}

function validationSummary(event: LoopwatchEvent): string {
  const command = commandFromEvent(event) ?? 'validation result';
  const exitCode = validationExitCode(event);
  if (exitCode === undefined) return compact(command, 180);
  return `${compact(command, 150)} exited ${exitCode}`;
}

function repeatedFailingCommand(failedValidations: LoopwatchEvent[]): { command: string; count: number; event: LoopwatchEvent } | undefined {
  const counts = new Map<string, { count: number; event: LoopwatchEvent }>();
  for (const event of failedValidations) {
    const command = commandFromEvent(event) ?? 'validation result';
    const current = counts.get(command) ?? { count: 0, event };
    current.count += 1;
    current.event = event;
    counts.set(command, current);
  }

  for (const [command, value] of counts) {
    if (value.count >= 2) return { command, ...value };
  }
  return undefined;
}

function evidenceRef(event: LoopwatchEvent, severity: ConvergenceStatus, signal: ConvergenceSignal, title: string, detail: string): ConvergenceEvidenceRef {
  const recommendedAction = severity === 'intervention' ? recommendedActions[signal] : undefined;
  return {
    eventId: eventId(event),
    timestamp: event.timestamp,
    kind: event.kind,
    severity,
    signal,
    title,
    detail,
    ...(recommendedAction ? { recommendedAction } : {}),
  };
}

function eventId(event: LoopwatchEvent): string {
  const payload = payloadRecord(event);
  const record = event as Record<string, unknown>;
  return stringValue(payload?.id) ?? stringValue(record.id) ?? stringValue(record.uuid) ?? `${event.source}:${event.sessionId}:${event.timestamp}:${event.kind}`;
}

function textFromEvent(event: LoopwatchEvent): string | undefined {
  const payload = payloadRecord(event);
  if (!payload) return undefined;
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.content === 'string') return payload.content;
  const message = recordValue(payload.message);
  if (typeof message?.content === 'string') return message.content;
  return textFromContent(message?.content ?? payload.content);
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;

  const parts: string[] = [];
  for (const item of content) {
    const block = recordValue(item);
    if (!block) continue;
    if (typeof block.text === 'string') parts.push(block.text);
    else if (typeof block.content === 'string') parts.push(block.content);
    else if (block.type === 'tool_use') {
      const name = typeof block.name === 'string' ? block.name : 'tool';
      const input = recordValue(block.input);
      const command = typeof input?.command === 'string' ? input.command : undefined;
      parts.push(command ? `${name}: ${command}` : `${name} call`);
    }
  }
  return parts.filter(Boolean).join('\n') || undefined;
}

function commandFromEvent(event: LoopwatchEvent): string | undefined {
  const payload = payloadRecord(event);
  if (typeof payload?.command === 'string') return payload.command;
  const tool = recordValue(payload?.tool);
  const argumentsRecord = recordValue(tool?.arguments);
  if (typeof argumentsRecord?.command === 'string') return argumentsRecord.command;
  const validation = recordValue(payload?.validation);
  if (typeof validation?.command === 'string') return validation.command;
  const toolUse = contentBlocks(event).find((block) => block.type === 'tool_use');
  const input = recordValue(toolUse?.input);
  if (typeof input?.command === 'string') return input.command;
  return undefined;
}

function toolNameFromEvent(event: LoopwatchEvent): string | undefined {
  const payload = payloadRecord(event);
  if (typeof payload?.toolName === 'string') return payload.toolName;
  const tool = recordValue(payload?.tool);
  if (typeof tool?.name === 'string') return tool.name;
  const toolUse = contentBlocks(event).find((block) => block.type === 'tool_use');
  if (typeof toolUse?.name === 'string') return toolUse.name;
  return undefined;
}

function contentBlocks(event: LoopwatchEvent): Record<string, unknown>[] {
  const payload = payloadRecord(event);
  const message = recordValue(payload?.message);
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    const record = recordValue(block);
    return record ? [record] : [];
  });
}

function tokenTotal(event: LoopwatchEvent): number {
  const payload = payloadRecord(event);
  if (!payload) return 0;
  const usage = recordValue(payload.usage) ?? payload;
  return (
    numberValue(usage.totalTokens) ??
    numberValue(usage.total_tokens) ??
    numberValue(usage.tokens) ??
    (numberValue(usage.inputTokens) ?? numberValue(usage.input_tokens) ?? 0) + (numberValue(usage.outputTokens) ?? numberValue(usage.output_tokens) ?? 0)
  );
}

function livenessForEvent(event: LoopwatchEvent | undefined, nowMs: number, config: ConvergenceConfig): ConvergenceLiveness {
  if (!event) return 'ended';
  const ageMs = nowMs - Date.parse(event.timestamp);
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'active';
  if (ageMs >= (config.endedAfterMs ?? DEFAULT_ENDED_AFTER_MS)) return 'ended';
  if (ageMs >= (config.idleAfterMs ?? DEFAULT_IDLE_AFTER_MS)) return 'idle';
  return 'active';
}

function splitSessionId(id: string, firstEvent: LoopwatchEvent | undefined): [string, string] {
  if (firstEvent) return [firstEvent.source, firstEvent.sessionId];
  const index = id.indexOf(':');
  return index === -1 ? ['unknown', id] : [id.slice(0, index), id.slice(index + 1)];
}

function maxStatus(statuses: ConvergenceStatus[]): ConvergenceStatus {
  if (statuses.includes('intervention')) return 'intervention';
  if (statuses.includes('watch')) return 'watch';
  return 'calm';
}

function sumSpend(spends: ConvergenceSpend[]): ConvergenceSpend {
  return roundSpend(
    spends.reduce(
      (total, spend) => ({
        cheapCalls: total.cheapCalls + spend.cheapCalls,
        strongCalls: total.strongCalls + spend.strongCalls,
        totalCalls: total.totalCalls + spend.totalCalls,
        estimatedTokens: total.estimatedTokens + spend.estimatedTokens,
        estimatedCostUsd: total.estimatedCostUsd + spend.estimatedCostUsd,
      }),
      { cheapCalls: 0, strongCalls: 0, totalCalls: 0, estimatedTokens: 0, estimatedCostUsd: 0 },
    ),
  );
}

function roundSpend(spend: ConvergenceSpend): ConvergenceSpend {
  return {
    ...spend,
    totalCalls: spend.cheapCalls + spend.strongCalls,
    estimatedCostUsd: Number(spend.estimatedCostUsd.toFixed(6)),
  };
}

function payloadRecord(event: LoopwatchEvent): Record<string, unknown> | undefined {
  return recordValue(event.payload);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveIntEnv(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function pivotModeFromEnv(value: string | undefined): PivotMode | undefined {
  if (value === 'calm' || value === 'loud') return value;
  return undefined;
}

function compareEvents(a: LoopwatchEvent, b: LoopwatchEvent): number {
  const byTime = Date.parse(a.timestamp) - Date.parse(b.timestamp);
  if (byTime !== 0) return byTime;
  return eventId(a).localeCompare(eventId(b));
}

function compact(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
