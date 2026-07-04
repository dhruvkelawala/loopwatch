export function healthEndpoint(baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/health`;
}

export function loopwatchRunsEndpoint(baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/loopwatch/runs?limit=120`;
}

export function loopwatchConvergenceEndpoint(baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/loopwatch/convergence`;
}
