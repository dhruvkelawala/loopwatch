import type { Liveness, Severity } from '../loopwatch-events';

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
