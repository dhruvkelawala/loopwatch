#!/usr/bin/env python3
"""
Loopwatch freshness / cadence spike  (PRD §12.1, §13 step 1).

The open risk: Loopwatch's "real-time" promise is only as fresh as each agent
flushes its JSONL to disk. This probe characterizes that.

Two modes:

  (default)   Analyze the newest existing session file per source to characterize
              event timing / burstiness — a proxy for how fresh passive observation
              can be, and a direct input to tuning the judge's debounce / rate cap.

  --watch F   LIVE mode: tail file F and print wall-clock latency between appends.
              Run this WHILE an agent session is active to measure true flush lag
              (the number that actually validates or breaks the freshness assumption).

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


def watch(path):
    path = os.path.expanduser(path)
    print(f'watching {path} for append latency (Ctrl-C to stop)')
    last = os.path.getsize(path) if os.path.exists(path) else 0
    t0 = time.time()
    while True:
        time.sleep(0.25)
        if not os.path.exists(path):
            continue
        sz = os.path.getsize(path)
        if sz > last:
            now = time.time()
            print(f'  +{sz - last} bytes after {now - t0:.2f}s idle')
            last, t0 = sz, now


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--watch':
        watch(sys.argv[2])
    else:
        analyze()
