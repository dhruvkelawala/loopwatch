import type { LoopwatchEvent } from '../schemas/loopwatch.js';

/**
 * Source Capabilities, Cockpit side (issue #11). Mirrors the adapter registry
 * in `src/adapters/core/capabilities.ts` — kept as a deliberate, small mirror
 * the way `ui/src/schemas/loopwatch.ts` mirrors `src/events.ts`, so the webview
 * needs no engine round-trip to render badges.
 *
 * Honest badges, no fake parity: a source shows a badge only for a capability
 * it declares, and a value-bearing capability (tokens / cost) renders its real
 * value or "unavailable" — never blank or faked (ADR-0004).
 */
export const CAPABILITIES = ['transcript', 'tools', 'tokens', 'cost', 'diagnostics'] as const;
export type Capability = (typeof CAPABILITIES)[number];

const SOURCE_CAPABILITIES: Record<string, Capability[]> = {
  claude: ['transcript', 'tools'],
  codex: ['transcript', 'tools', 'tokens'],
  pi: ['transcript', 'tools', 'tokens', 'cost', 'diagnostics'],
};

/** Short, fixed labels for the capability chips. */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  transcript: 'transcript',
  tools: 'tools',
  tokens: 'tokens',
  cost: 'cost',
  diagnostics: 'diag',
};

/** Declared capabilities for a source key (case-insensitive), else the universal default. */
export function capabilitiesFor(source: string): Capability[] {
  return SOURCE_CAPABILITIES[source.toLowerCase()] ?? ['transcript', 'tools'];
}

export function sourceProvides(source: string, capability: Capability): boolean {
  return capabilitiesFor(source).includes(capability);
}

export interface SessionUsage {
  /** Total tokens, or null when the source can't provide them (render "unavailable"). */
  tokens: number | null;
  /** Direct cost in USD, or null when unavailable. */
  cost: number | null;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Extract usage (tokens + cost) for a session from its events, source-aware and
 * honest — a source that can't provide a value yields null so the UI shows
 * "unavailable" rather than a fabricated zero.
 *
 *   - **Pi** reports a direct `$` cost per assistant message (`usage.cost.total`)
 *     and per-message token usage; cost is summed, tokens summed as new
 *     (input + output) tokens, excluding cache reuse.
 *   - **Codex** buries cumulative usage in `token_count.info.total_token_usage`;
 *     the latest non-null sample is the session total. No direct cost.
 *   - **Claude** declares neither here — both stay null (no fake parity).
 */
export function extractUsage(source: string, events: LoopwatchEvent[]): SessionUsage {
  const key = source.toLowerCase();
  if (key === 'pi') return piUsage(events);
  if (key === 'codex') return codexUsage(events);
  return { tokens: null, cost: null };
}

function piUsage(events: LoopwatchEvent[]): SessionUsage {
  let tokens = 0;
  let cost = 0;
  let sawTokens = false;
  let sawCost = false;

  for (const event of events) {
    const usage = recordValue(recordValue(event.payload)?.message)?.usage;
    const usageRecord = recordValue(usage);
    if (!usageRecord) continue;

    const input = numberValue(usageRecord.input);
    const output = numberValue(usageRecord.output);
    if (input !== undefined || output !== undefined) {
      tokens += (input ?? 0) + (output ?? 0);
      sawTokens = true;
    }

    const total = numberValue(recordValue(usageRecord.cost)?.total);
    if (total !== undefined) {
      cost += total;
      sawCost = true;
    }
  }

  return { tokens: sawTokens ? tokens : null, cost: sawCost ? cost : null };
}

function codexUsage(events: LoopwatchEvent[]): SessionUsage {
  let tokens: number | null = null;

  for (const event of events) {
    const payload = recordValue(event.payload);
    if (payload?.type !== 'event_msg') continue;
    const info = recordValue(recordValue(payload.payload)?.info);
    const total = numberValue(recordValue(info?.total_token_usage)?.total_tokens);
    // token_count is cumulative — the latest non-null sample is the session total.
    if (total !== undefined) tokens = total;
  }

  return { tokens, cost: null };
}
