import { z } from 'zod';

import type { ConvergenceEvidenceRef, ConvergenceLiveness, ConvergenceStatus, RunningSummary } from './convergence.js';
import type { LoopwatchEvent } from './events.js';

export type RedactionCategory = 'api_key' | 'bearer_token' | 'auth_header' | 'private_key' | 'env_secret' | 'credential_url';

export const RedactionReportSchema = z.object({
  count: z.number().int().nonnegative(),
  categories: z.array(z.enum(['api_key', 'bearer_token', 'auth_header', 'private_key', 'env_secret', 'credential_url'])),
});
export type RedactionReport = z.infer<typeof RedactionReportSchema>;

export type RedactionResult<T> = {
  value: T;
  report: RedactionReport;
};

const EvidenceSignalSchema = z.object({
  eventId: z.string().min(1),
  timestamp: z.string().min(1),
  kind: z.string().min(1),
  severity: z.enum(['calm', 'watch', 'intervention']),
  signal: z.enum(['drift', 'burn', 'weak_validation', 'churn', 'completion_without_evidence']),
  title: z.string().min(1),
  detail: z.string().min(1),
  recommendedAction: z.string().optional(),
});

export const EvidencePacketSchema = z.object({
  version: z.literal(1),
  mode: z.enum(['structured', 'deep_analyze']),
  consent: z.object({
    deepAnalyze: z.boolean(),
  }),
  session: z.object({
    id: z.string().min(1),
    source: z.string().min(1),
    sessionId: z.string().min(1),
    status: z.enum(['calm', 'watch', 'intervention']),
    liveness: z.enum(['active', 'idle', 'ended']),
  }),
  summary: z.object({
    goal: z.string(),
    done: z.array(z.string()),
    validation: z.array(z.string()),
    concerns: z.array(z.string()),
  }),
  signals: z.array(EvidenceSignalSchema),
  card: z.object({ evidence: EvidenceSignalSchema }).optional(),
  omittedRawTranscript: z.boolean(),
  redactions: RedactionReportSchema,
  transcript: z
    .object({
      scope: z.literal('selected_evidence'),
      events: z.array(
        z.object({
          id: z.string().min(1),
          timestamp: z.string().min(1),
          kind: z.string().min(1),
          actorType: z.string().min(1),
          snippet: z.string(),
        }),
      ),
    })
    .optional(),
});
export type EvidencePacket = z.infer<typeof EvidencePacketSchema>;
type EvidencePacketDraft = Omit<EvidencePacket, 'redactions'>;

export interface BuildEvidencePacketInput {
  session: {
    id: string;
    source: string;
    sessionId: string;
    status?: ConvergenceStatus;
    liveness?: ConvergenceLiveness;
  };
  summary: RunningSummary;
  evidence: readonly ConvergenceEvidenceRef[];
  events?: readonly LoopwatchEvent[];
  deepAnalyzeConsent?: boolean;
  requestedEvidenceEventId?: string;
}

export function buildEvidencePacket(input: BuildEvidencePacketInput): EvidencePacket {
  const deepAnalyzeConsent = input.deepAnalyzeConsent === true;
  const packet: EvidencePacketDraft = {
    version: 1 as const,
    mode: deepAnalyzeConsent ? ('deep_analyze' as const) : ('structured' as const),
    consent: { deepAnalyze: deepAnalyzeConsent },
    session: {
      id: input.session.id,
      source: input.session.source,
      sessionId: input.session.sessionId,
      status: input.session.status ?? 'watch',
      liveness: input.session.liveness ?? 'active',
    },
    summary: input.summary,
    signals: [...input.evidence],
    ...(input.evidence[0] ? { card: { evidence: input.evidence[0] } } : {}),
    omittedRawTranscript: !deepAnalyzeConsent,
    ...(deepAnalyzeConsent ? { transcript: selectedTranscriptContext(input) } : {}),
  };

  const redacted = redactSecrets(packet);
  const compacted = compactTranscriptSnippets(redacted.value);
  return EvidencePacketSchema.parse({ ...compacted, redactions: redacted.report });
}

export function redactSecrets<T>(value: T): RedactionResult<T> {
  const report = newRedactionReport();
  // The recursive redactor preserves the input container shape while replacing secret string leaves.
  const redactedValue = redactUnknown(value, report) as T;
  return { value: redactedValue, report: finalizeReport(report) };
}

type MutableRedactionReport = {
  count: number;
  categories: Set<RedactionCategory>;
};

function selectedTranscriptContext(input: BuildEvidencePacketInput): EvidencePacket['transcript'] {
  const events = input.events ?? [];
  const eventIds = new Set(input.requestedEvidenceEventId ? [input.requestedEvidenceEventId] : input.evidence.map((item) => item.eventId));
  return {
    scope: 'selected_evidence',
    events: events
      .filter((event) => eventIds.has(eventId(event)))
      .map((event) => ({
        id: eventId(event),
        timestamp: event.timestamp,
        kind: event.kind,
        actorType: event.actor.type,
        snippet: eventSnippet(event),
      })),
  };
}

function eventId(event: LoopwatchEvent): string {
  return typeof event.id === 'string' && event.id.length > 0 ? event.id : `${event.source}:${event.sessionId}:${event.timestamp}:${event.kind}`;
}

function eventSnippet(event: LoopwatchEvent): string {
  return textFromUnknown(event.payload) ?? event.kind;
}

function compactTranscriptSnippets(packet: EvidencePacketDraft): EvidencePacketDraft {
  if (!packet.transcript) return packet;
  return {
    ...packet,
    transcript: {
      scope: packet.transcript.scope,
      events: packet.transcript.events.map((event) => ({ ...event, snippet: compact(event.snippet, 500) })),
    },
  };
}

function textFromUnknown(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromUnknown).filter((part): part is string => part !== undefined).join('\n') || undefined;
  if (!isRecord(value)) return undefined;

  const preferredKeys = ['content', 'text', 'message', 'output', 'stdout', 'stderr', 'detail', 'command'];
  for (const key of preferredKeys) {
    if (!(key in value)) continue;
    const text = textFromUnknown(value[key]);
    if (text) return text;
  }

  return undefined;
}

function redactUnknown(value: unknown, report: MutableRedactionReport, keyHint?: string): unknown {
  if (typeof value === 'string') {
    return keyHint && isSensitiveKey(keyHint) ? redactEntireSecretValue(keyHint, report) : redactString(value, report);
  }
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item, report));
  if (!isRecord(value)) return value;

  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, redactUnknown(nested, report, key)]));
}

function redactString(value: string, report: MutableRedactionReport): string {
  let output = value;
  output = replaceSecret(output, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED:private_key]', 'private_key', report);
  output = replaceSecret(output, /([a-z][a-z0-9+.-]*:\/\/)([^@/\s]+)@/gi, '$1[REDACTED:credential_url]@', 'credential_url', report);
  output = replaceSecret(output, /\b((?:authorization|proxy-authorization)\s*[:=]\s*)[^\n\r,;]+/gi, '$1[REDACTED:auth_header]', 'auth_header', report);
  output = replaceSecret(output, /\b((?:x-api-key|api-key)\s*[:=]\s*)[^\s,;\n\r]+/gi, '$1[REDACTED:auth_header]', 'auth_header', report);
  output = replaceSecret(output, /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED:bearer_token]', 'bearer_token', report);
  output = replaceSecret(output, /\b(?:sk|pk|rk|ak)-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED:api_key]', 'api_key', report);
  output = replaceSecret(output, /\b((?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key)\s*[:=]\s*["']?)[^"'\s,;]+/gi, '$1[REDACTED:api_key]', 'api_key', report);
  output = replaceSecret(output, /\b((?:token|secret|password|pass|credential)\s*[:=]\s*["']?)[^"'\s,;]+/gi, '$1[REDACTED:env_secret]', 'env_secret', report);
  output = replaceSecret(output, /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL)[A-Z0-9_]*\s*=\s*["']?)[^"'\s,;]+/g, '$1[REDACTED:env_secret]', 'env_secret', report);
  return output;
}

function redactEntireSecretValue(key: string, report: MutableRedactionReport): string {
  const category = sensitiveKeyCategory(key);
  recordRedaction(report, category);
  return `[REDACTED:${category}]`;
}

function replaceSecret(input: string, pattern: RegExp, replacement: string, category: RedactionCategory, report: MutableRedactionReport): string {
  let replaced = 0;
  const output = input.replace(pattern, (_match: string, ...captures: unknown[]) => {
    replaced += 1;
    return expandReplacement(replacement, captures);
  });
  for (let index = 0; index < replaced; index += 1) recordRedaction(report, category);
  return output;
}

function expandReplacement(template: string, captures: readonly unknown[]): string {
  return template.replace(/\$(\d+)/g, (_match, group) => {
    const capture = captures[Number(group) - 1];
    return typeof capture === 'string' ? capture : '';
  });
}

function isSensitiveKey(key: string): boolean {
  return /(?:authorization|proxy-authorization|api[_-]?key|apikey|token|secret|password|pass|credential|private[_-]?key)/i.test(key);
}

function sensitiveKeyCategory(key: string): RedactionCategory {
  if (/(?:authorization|proxy-authorization)/i.test(key)) return 'auth_header';
  if (/(?:api[_-]?key|apikey|access[_-]?key)/i.test(key)) return 'api_key';
  if (/private[_-]?key/i.test(key)) return 'private_key';
  if (/token/i.test(key)) return 'bearer_token';
  return 'env_secret';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function newRedactionReport(): MutableRedactionReport {
  return { count: 0, categories: new Set() };
}

function recordRedaction(report: MutableRedactionReport, category: RedactionCategory): void {
  report.count += 1;
  report.categories.add(category);
}

function finalizeReport(report: MutableRedactionReport): RedactionReport {
  return { count: report.count, categories: [...report.categories].sort() };
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
