import { CAPABILITY_LABEL, type Capability } from './capabilities';
import type { Liveness, Severity } from '../loopwatch-events';

const CAPABILITY_ORDER: Capability[] = ['transcript', 'tools', 'tokens', 'cost', 'diagnostics'];

export function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" fill="none" opacity=".5" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" fill="none" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" fill="currentColor" r="1.4" />
      <path d="M16.5 7.5a9 9 0 1 0 3 7.7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      <path d="M17.5 4.5l2 2-2 2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

export function StatusPing({ severity, active }: { severity: Severity; active: boolean }) {
  const colorClass = pingColorClass[severity];
  const pulseClass = active ? 'after:absolute after:inset-0 after:animate-watchtower-ping after:rounded-full after:border after:border-current' : '';

  return (
    <span className={`relative h-[9px] w-[9px] ${colorClass} ${pulseClass}`}>
      <span className="absolute inset-px rounded-full bg-current shadow-watch-ping" />
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`rounded px-1.5 py-[1.5px] font-mono text-[9.5px] font-medium uppercase tracking-[.05em] ${severityBadgeClass[severity]}`}>
      {severityLabel[severity]}
    </span>
  );
}

/** Compact, honest capability badges — one chip per declared capability (no fake parity). */
export function CapabilityBadges({ capabilities }: { capabilities: Capability[] }) {
  const declared = new Set(capabilities);
  const ordered = CAPABILITY_ORDER.filter((capability) => declared.has(capability));
  if (ordered.length === 0) return null;

  return (
    <span className="flex flex-wrap items-center gap-1">
      {ordered.map((capability) => (
        <span
          key={capability}
          className="rounded-[4px] bg-watch-code px-1.5 py-[1.5px] font-mono text-[9px] uppercase tracking-[.04em] text-watch-ink-2"
          title={`${capability} provided by this source`}
        >
          {CAPABILITY_LABEL[capability]}
        </span>
      ))}
    </span>
  );
}

/**
 * Usage meter for a session row: prefers the source's headline metric (Pi's
 * direct cost), else token count. Renders the real value, or "n/a" when the
 * capability is declared but no data has arrived yet — never a faked zero.
 */
export function UsageMeter({
  capabilities,
  tokens,
  cost,
}: {
  capabilities: Capability[];
  tokens: number | null;
  cost: number | null;
}) {
  const declared = new Set(capabilities);
  if (declared.has('cost')) {
    return <span className="font-mono text-[10px] text-watch-accent" title="direct cost">{cost === null ? 'n/a' : formatCost(cost)}</span>;
  }
  if (declared.has('tokens')) {
    return <span className="font-mono text-[10px] text-watch-ink-2" title="token usage">{tokens === null ? 'n/a' : `${formatTokens(tokens)} tok`}</span>;
  }
  return null;
}

/** Compact token count, e.g. `33.5k`, `1.2M`. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens));
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/** Direct cost in USD, e.g. `$1.84`, `$0.0123`. */
export function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function LivenessPill({ liveness }: { liveness: Liveness }) {
  return (
    <span className={`rounded border px-1.5 py-[1.5px] font-mono text-[9px] font-medium uppercase tracking-[.02em] ${livenessClass[liveness]}`}>
      .liv {liveness}
    </span>
  );
}

export function ConvergenceDial({ severity, label }: { severity: Severity; label: string }) {
  const contact = dialContact[severity];
  return (
    <div className="w-[76px] shrink-0 text-center">
      <svg className="mx-auto block text-watch-accent" height="56" viewBox="0 0 56 56" width="56" aria-hidden="true">
        <circle cx="28" cy="28" fill="none" opacity="0.35" r="24" stroke="currentColor" strokeWidth="1" />
        <circle cx="28" cy="28" fill="none" opacity="0.25" r="15" stroke="currentColor" strokeWidth="1" />
        <circle cx="28" cy="28" fill="currentColor" opacity="0.18" r="5" />
        <path className="animate-watchtower-sweep" d="M28 28 L28 5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
        <circle className={contact.className} cx={contact.x} cy={contact.y} r="3.2" />
      </svg>
      <span className={`mt-1 block font-mono text-[8.5px] font-medium uppercase tracking-[.14em] ${valueToneClass[severity]}`}>{label}</span>
    </div>
  );
}

export function formatClock(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export const valueToneClass: Record<Severity, string> = {
  intervention: 'text-status-intervention',
  watch: 'text-status-watch',
  calm: 'text-status-calm',
};

export const chipToneClass: Record<Severity | 'neutral', string> = {
  intervention: 'bg-severity-intervention/14 text-status-intervention',
  watch: 'bg-severity-watch/16 text-status-watch',
  calm: 'bg-severity-calm/14 text-status-calm',
  neutral: 'bg-watch-code text-watch-ink-2',
};

export const statusLightClass = {
  checking: 'bg-severity-watch shadow-watch-warn-glow',
  connected: 'bg-watch-accent shadow-watch-accent-glow',
  empty: 'bg-liveness-idle',
  offline: 'bg-severity-intervention shadow-watch-danger-glow',
} as const;

const severityLabel: Record<Severity, string> = {
  intervention: 'intervene',
  watch: 'watch',
  calm: 'calm',
};

const severityBadgeClass: Record<Severity, string> = {
  intervention: 'bg-severity-intervention/14 text-severity-intervention',
  watch: 'bg-severity-watch/16 text-severity-watch',
  calm: 'bg-severity-calm/14 text-severity-calm',
};

const livenessClass: Record<Liveness, string> = {
  active: 'border-severity-calm/40 bg-severity-calm/14 text-severity-calm',
  idle: 'border-liveness-idle/30 bg-liveness-idle/8 text-liveness-idle',
  ended: 'border-liveness-ended/25 bg-liveness-ended/6 text-liveness-ended',
};

const pingColorClass: Record<Severity, string> = {
  intervention: 'text-severity-intervention',
  watch: 'text-severity-watch',
  calm: 'text-severity-calm',
};

const dialContact: Record<Severity, { x: number; y: number; className: string }> = {
  calm: { x: 28, y: 28, className: 'fill-severity-calm animate-watchtower-blip' },
  watch: { x: 38, y: 21, className: 'fill-severity-watch animate-watchtower-blip' },
  intervention: { x: 46, y: 14, className: 'fill-severity-intervention animate-watchtower-blip' },
};
