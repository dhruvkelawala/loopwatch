export function healthEndpoint(baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/health`;
}

export function loopwatchRunsEndpoint(baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/loopwatch/runs?limit=120`;
}

export function loopwatchConvergenceEndpoint(baseUrl: string, pivotMode?: 'calm' | 'loud'): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  if (!pivotMode) return `${base}/loopwatch/convergence`;
  const params = new URLSearchParams({ pivotMode });
  return `${base}/loopwatch/convergence?${params.toString()}`;
}

export function loopwatchLoopRecommendationEndpoint(baseUrl: string, task: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const params = new URLSearchParams({ task });
  return `${base}/loopwatch/loops/recommend?${params.toString()}`;
}
