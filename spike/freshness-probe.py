#!/usr/bin/env python3
"""
Loopwatch freshness / cadence spike  (PRD §12.1, §13 step 1; ADR-0009).

The open risk: Loopwatch's "real-time" promise is only as fresh as each agent
flushes its JSONL to disk. This probe characterizes that.

Two modes:

  (default)   Analyze the newest existing session file per source to characterize
              event timing / burstiness — a proxy for how fresh passive observation
              can be, and a direct input to tuning the judge's debounce / rate cap.

  --watch F   LIVE mode: tail file F and measure TRUE FLUSH LAG — the wall-clock
              delay between an event's own timestamp (when the agent created it)
              and the moment its bytes become visible to an outside reader. This
              is the number that actually validates or breaks the freshness
              assumption. Run this WHILE an agent session is active.

              Optionally: --duration SECONDS (auto-stop) and --out FILE (append a
              machine-readable summary block).

Reads only record timestamps and byte counts — never message / tool content.
"""
import os, sys, json, glob, time, statistics
from datetime import datetime

SOURCES = {'codex': '~/.codex/sessions', 'claude': '~/.claude/projects', 'pi': '~/.pi/agent/sessions'}


def parse_ts(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v) / 1000.0 if v > 1e12 else float(v)
    s = str(v).strip().replace('Z', '+00:00')
    try:
        return datetime.fromisoformat(s).timestamp()
    except Exception:
        return None


def newest(root):
    root = os.path.expanduser(root)
    fs = [f for f in glob.glob(os.path.join(root, '**', '*.jsonl'), recursive=True) if os.path.isfile(f)]
    fs.sort(key=os.path.getmtime)
    return fs[-1] if fs else None


def timestamps(path, limit=5000):
    ts = []
    for i, line in enumerate(open(path, errors='replace')):
        if i > limit:
            break
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except Exception:
            continue
        if isinstance(rec, dict):
            t = parse_ts(rec.get('timestamp'))
            if t:
                ts.append(t)
    return sorted(ts)


def analyze():
    for name, root in SOURCES.items():
        f = newest(root)
        print('=' * 60)
        print(name.upper())
        if not f:
            print('  (no session file found)')
            continue
        ts = timestamps(f)
        print(f'  file: {os.path.basename(f)} | {len(ts)} timestamped records')
        if len(ts) < 2:
            print('  (not enough timestamps to measure gaps)')
            continue
        gaps = [b - a for a, b in zip(ts, ts[1:]) if b >= a]
        span = ts[-1] - ts[0]
        p90 = sorted(gaps)[int(len(gaps) * 0.9)]
        print(f'  span: {span / 60:.1f} min | median gap: {statistics.median(gaps):.1f}s | '
              f'p90 gap: {p90:.1f}s | max gap: {max(gaps):.1f}s')
        print(f'  gaps >30s: {sum(g > 30 for g in gaps)} | >60s: {sum(g > 60 for g in gaps)} | '
              f'>300s: {sum(g > 300 for g in gaps)}')


def guess_source(path):
    p = os.path.expanduser(path)
    for name, root in SOURCES.items():
        if os.path.expanduser(root) in p:
            return name
    return 'unknown'


def _pct(sorted_vals, pct):
    if not sorted_vals:
        return float('nan')
    return sorted_vals[min(len(sorted_vals) - 1, int(len(sorted_vals) * pct))]


def summarize(path, src, t_start, t_end, appends, lags):
    dur = t_end - t_start
    n_appends = len(appends)
    n_bytes = sum(a[0] for a in appends)
    n_recs = sum(a[1] for a in appends)
    slags = sorted(lags)
    lines = []
    lines.append('=== FLUSH-LAG-SUMMARY ===')
    lines.append(f'source={src}')
    lines.append(f'file={os.path.basename(path)}')
    lines.append(f'wall_duration_s={dur:.1f}')
    lines.append(f'appends={n_appends}')
    lines.append(f'bytes_appended={n_bytes}')
    lines.append(f'records_with_ts={n_recs}')
    if slags:
        lines.append(f'lag_min_s={slags[0]:.3f}')
        lines.append(f'lag_median_s={statistics.median(slags):.3f}')
        lines.append(f'lag_p90_s={_pct(slags, 0.9):.3f}')
        lines.append(f'lag_p99_s={_pct(slags, 0.99):.3f}')
        lines.append(f'lag_max_s={slags[-1]:.3f}')
        lines.append(f'lag_gt_1s={sum(x > 1 for x in slags)}')
        lines.append(f'lag_gt_5s={sum(x > 5 for x in slags)}')
        lines.append(f'lag_gt_30s={sum(x > 30 for x in slags)}')
    else:
        lines.append('lag=NO_TIMESTAMPED_RECORDS')
    lines.append('=== END ===')
    return '\n'.join(lines)


def watch(path, duration=None, out=None, poll=0.1):
    path = os.path.expanduser(path)
    src = guess_source(path)
    print(f'watching {path}')
    dur_lbl = 'unlimited' if not duration else f'{duration}s'
    print(f'source={src}  duration={dur_lbl}  out={out or "-"}  (Ctrl-C to stop)')
    def _size():
        # Tolerate transient ENOENT: some sources momentarily drop the path
        # during atomic write-rename. Retry briefly before treating as gone.
        for _ in range(10):
            try:
                return os.path.getsize(path)
            except OSError:
                time.sleep(0.02)
        return None

    last = _size() or 0
    lags = []
    appends = []
    t_start = time.time()
    deadline = t_start + duration if duration else None
    try:
        while True:
            time.sleep(poll)
            now = time.time()
            if deadline and now >= deadline:
                break
            sz = _size()
            if sz is None:
                continue
            if sz < last:
                # file truncated / rotated (new session) -> re-anchor at 0
                last = 0
                continue
            if sz > last:
                rec_ts = []
                try:
                    with open(path, 'rb') as fh:
                        fh.seek(last)
                        chunk = fh.read(sz - last)
                except OSError:
                    chunk = b''
                wall = time.time()  # the moment these bytes are visible to us
                for line in chunk.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except Exception:
                        continue
                    if isinstance(rec, dict):
                        t = parse_ts(rec.get('timestamp'))
                        if t:
                            rec_ts.append(t)
                new_lags = [wall - t for t in rec_ts if (wall - t) >= 0]
                lags.extend(new_lags)
                appends.append((sz - last, len(rec_ts), wall))
                if new_lags:
                    print(f'  +{sz - last}B  {len(rec_ts)}rec  '
                          f'lag med={statistics.median(new_lags):.2f}s '
                          f'min={min(new_lags):.2f}s max={max(new_lags):.2f}s')
                else:
                    print(f'  +{sz - last}B  {len(rec_ts)}rec (no usable timestamps)')
                last = sz
    except KeyboardInterrupt:
        pass

    summary = summarize(path, src, t_start, time.time(), appends, lags)
    print('\n' + summary)
    if out:
        with open(out, 'a') as fh:
            fh.write(summary + '\n')
    return summary


def _flag(name):
    return name in sys.argv


def _val(name, cast=float, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            try:
                return cast(sys.argv[i + 1])
            except Exception:
                return default
    return default


if __name__ == '__main__':
    if '--watch' in sys.argv:
        # python3 freshness-probe.py --watch <file> [--duration N] [--out FILE] [--poll S]
        wf = [a for a in sys.argv if not a.startswith('-') and a != sys.argv[0] and a != _val('--duration', str, '') and a != _val('--out', str, '') and a != _val('--poll', str, '')]
        # robustly find the file arg = first non-flag token after --watch
        idx = sys.argv.index('--watch')
        path = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else None
        if not path:
            print('usage: freshness-probe.py --watch <file> [--duration N] [--out FILE] [--poll S]')
            sys.exit(2)
        watch(path,
              duration=(int(_val('--duration')) if _val('--duration') else None),
              out=_val('--out', str),
              poll=(float(_val('--poll')) if _val('--poll') else 0.1))
    else:
        analyze()
