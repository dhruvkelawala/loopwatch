import { codexAuth, type AuthCheck, type CodexAuth, type CodexAuthStatus } from 'flue-codex-oauth';

export type CodexOAuthMode = 'auto' | 'enabled' | 'disabled';

export interface LoopwatchCodexOAuthIntegration {
  auth: CodexAuth;
  enabled: boolean;
  mode: CodexOAuthMode;
  providerId: 'openai-codex';
  modelExample: 'openai-codex/gpt-5.5';
}

export interface LoopwatchCodexOAuthSnapshot {
  enabled: boolean;
  mode: CodexOAuthMode;
  providerId: 'openai-codex';
  modelExample: 'openai-codex/gpt-5.5';
  status: CodexAuthStatus;
  checks: AuthCheck[];
}

const PROVIDER_ID = 'openai-codex' as const;
const MODEL_EXAMPLE = 'openai-codex/gpt-5.5' as const;

/**
 * Optional Codex subscription OAuth registration for dogfooding Flue provider setup.
 *
 * Default behaviour is intentionally non-invasive: if no auth file exists, Loopwatch
 * starts normally. If an auth file exists, or LOOPWATCH_CODEX_OAUTH=1 is set, the
 * integration registers the `openai-codex` provider at startup and refreshes it via
 * middleware on later requests. LOOPWATCH_CODEX_OAUTH=0 always disables it.
 */
export function createLoopwatchCodexOAuthIntegration(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): LoopwatchCodexOAuthIntegration {
  const auth = codexAuth({
    ...(env.FLUE_CODEX_AUTH_PATH ? { authPath: env.FLUE_CODEX_AUTH_PATH } : {}),
    forbiddenPaths: [cwd],
    env,
  });
  const requested = booleanFlag(env.LOOPWATCH_CODEX_OAUTH);
  const status = auth.status();

  return {
    auth,
    enabled: requested ?? status.configured,
    mode: requested === undefined ? 'auto' : requested ? 'enabled' : 'disabled',
    providerId: PROVIDER_ID,
    modelExample: MODEL_EXAMPLE,
  };
}

export async function configureLoopwatchCodexOAuth(integration: LoopwatchCodexOAuthIntegration): Promise<CodexAuthStatus | undefined> {
  if (!integration.enabled) return undefined;
  return integration.auth.configure();
}

export function loopwatchCodexOAuthSnapshot(integration: LoopwatchCodexOAuthIntegration): LoopwatchCodexOAuthSnapshot {
  return {
    enabled: integration.enabled,
    mode: integration.mode,
    providerId: integration.providerId,
    modelExample: integration.modelExample,
    status: integration.auth.status(),
    checks: integration.auth.checks(),
  };
}

function booleanFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'no'].includes(normalized)) return false;
  return undefined;
}
