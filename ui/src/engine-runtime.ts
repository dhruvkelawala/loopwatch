import { z } from 'zod';

const DEFAULT_RUNTIME_PATH = '/loopwatch-runtime.json';

const WindowEngineRuntimeSchema = z
  .object({
    baseUrl: z.string().min(1).optional(),
    bearerToken: z.string().min(1).optional(),
  })
  .strict();

const FileEngineRuntimeSchema = z
  .object({
    engineBaseUrl: z.string().min(1).optional(),
    engineToken: z.string().min(1).optional(),
    baseUrl: z.string().min(1).optional(),
    bearerToken: z.string().min(1).optional(),
  })
  .strict();

export type EngineRuntime = {
  flueBaseUrl: string;
  bearerToken?: string;
};

declare global {
  interface Window {
    __LOOPWATCH_ENGINE_CONFIG__?: unknown;
  }
}

export async function loadEngineRuntime(): Promise<EngineRuntime> {
  const fromWindow = parseWindowRuntime(window.__LOOPWATCH_ENGINE_CONFIG__);
  if (fromWindow) return fromWindow;

  const fromFile = await loadRuntimeFile();
  return {
    flueBaseUrl: fromFile?.flueBaseUrl ?? defaultFlueBaseUrl(),
    bearerToken: fromFile?.bearerToken,
  };
}

export function createEngineFetch(runtime: EngineRuntime): typeof fetch {
  return (input, init) => fetch(input, withEngineAuth(init, runtime.bearerToken));
}

export function withEngineAuth(init: RequestInit | undefined, bearerToken: string | undefined): RequestInit | undefined {
  if (!bearerToken) return init;

  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${bearerToken}`);
  return { ...init, headers };
}

function parseWindowRuntime(value: unknown): EngineRuntime | undefined {
  if (value === undefined) return undefined;
  const parsed = WindowEngineRuntimeSchema.parse(value);
  return {
    flueBaseUrl: parsed.baseUrl ?? defaultFlueBaseUrl(),
    bearerToken: parsed.bearerToken,
  };
}

async function loadRuntimeFile(): Promise<EngineRuntime | undefined> {
  const response = await fetch(DEFAULT_RUNTIME_PATH, { cache: 'no-store' });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Loopwatch runtime config failed with HTTP ${response.status}`);

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) return undefined;

  const parsed = FileEngineRuntimeSchema.parse(await response.json());
  return {
    flueBaseUrl: parsed.engineBaseUrl ?? parsed.baseUrl ?? defaultFlueBaseUrl(),
    bearerToken: parsed.engineToken ?? parsed.bearerToken,
  };
}

function defaultFlueBaseUrl(): string {
  return import.meta.env.VITE_LOOPWATCH_FLUE_URL ?? (import.meta.env.DEV ? '/api' : 'http://127.0.0.1:3583');
}
