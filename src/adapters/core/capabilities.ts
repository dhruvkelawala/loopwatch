/**
 * Source Capabilities — the declared evidence each Source Adapter can reliably
 * provide (issue #11, ADR-0004 "normalization is capability-aware").
 *
 * Capabilities exist to keep Loopwatch honest: we never fake parity across
 * sources. A source declares only what it genuinely provides; the Cockpit shows
 * a badge for each declared capability and renders a capability the source does
 * NOT declare as "unavailable" rather than blank or faked. A declared
 * capability whose data a particular session hasn't produced yet is also shown
 * as "unavailable" — declared ≠ observed.
 *
 * @see docs/adr/0004-normalized-event-shared-core-plus-extras.md
 * @see CONTEXT.md ("Capability")
 */

/**
 * The capability vocabulary. Deliberately small and stable — it mirrors the
 * badges the Cockpit prototype established (`prototype/cockpit-ui.html`):
 *   - `transcript`  — conversational messages (user / agent turns)
 *   - `tools`       — tool calls and their results
 *   - `tokens`      — token-usage samples
 *   - `cost`        — direct monetary cost ($)
 *   - `diagnostics` — source-emitted diagnostics / lifecycle signals
 */
export const CAPABILITIES = ['transcript', 'tools', 'tokens', 'cost', 'diagnostics'] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Declared capabilities per source. Known asymmetries (issue #11):
 *   - **Pi** exposes a direct `$` cost and token usage, plus diagnostics, but
 *     records no git branch in its transcript (inferred from git instead).
 *   - **Codex** records token counts, but buries usage in its payload and
 *     exposes no direct cost.
 *   - **Claude** gives transcript + tool calls; it does not surface cost, and
 *     its token usage is not declared here (no-fake-parity).
 *
 * A source not present here defaults to the universal `transcript` + `tools`.
 */
export const SOURCE_CAPABILITIES: Record<string, Capability[]> = {
  claude: ['transcript', 'tools'],
  codex: ['transcript', 'tools', 'tokens'],
  pi: ['transcript', 'tools', 'tokens', 'cost', 'diagnostics'],
};

/** Declared capabilities for a source, or the universal default. */
export function capabilitiesFor(source: string): Capability[] {
  return SOURCE_CAPABILITIES[source.toLowerCase()] ?? ['transcript', 'tools'];
}

/** Whether a source declares it can provide a given capability. */
export function sourceProvides(source: string, capability: Capability): boolean {
  return capabilitiesFor(source).includes(capability);
}
