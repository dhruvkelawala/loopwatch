import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  cockpitEngineFixture,
  interventionCockpitEngineFixture,
  noActionInterventionCockpitEngineFixture,
  postSessionInsightCockpitEngineFixture,
  pivotCockpitEngineFixture,
  upgradesCockpitEngineFixture,
  securedCockpitEngineFixture,
} from '../support/cockpit-fixture.js';

type CockpitFixture = {
  health: unknown;
  runs: { ok: true; runs: readonly { runId: string }[]; nextPollMs: number };
  convergence: unknown;
  loopRecommendation?: unknown;
  runEvents?: readonly unknown[];
};

type PivotMode = 'calm' | 'loud';
type PivotNudge = { mode: PivotMode };
type PivotSession = { pivotNudge?: PivotNudge };
type PivotConvergenceResponse = { sessions?: readonly PivotSession[] };


const securedDeepLinkSession = securedCockpitEngineFixture.convergence.sessions[0];
const interventionDeepLinkSession = interventionCockpitEngineFixture.convergence.sessions[0];
const deepLinkCockpitFixture = {
  health: interventionCockpitEngineFixture.health,
  runs: {
    ok: true,
    runs: [...securedCockpitEngineFixture.runs.runs, ...interventionCockpitEngineFixture.runs.runs],
    nextPollMs: 1000,
  },
  convergence: {
    ok: true,
    sessions: [securedDeepLinkSession, interventionDeepLinkSession],
    spend: {
      cheapCalls: 3,
      strongCalls: 2,
      totalCalls: 5,
      estimatedTokens: 3_850,
      estimatedCostUsd: 0.00339,
    },
    nextPollMs: 2_000,
  },
  runEvents: [...securedCockpitEngineFixture.runEvents, ...interventionCockpitEngineFixture.runEvents],
} as const satisfies CockpitFixture;

const securedDeepLinkTitle = 'Claude session cockpit';
const interventionDeepLinkTitle = 'Ship the Slice 7 intervention surface without hiding failed validation.';


const defaultLoopRecommendation = {
  ok: true,
  card: {
    type: 'coaching',
    task: 'Ship the current Loopwatch slice with verification.',
    loop: {
      id: 'vertical-feature-slice',
      title: 'Vertical Feature Slice',
      summary: 'Build one user-visible increment from contract through verification and review.',
      trigger: 'Use for an issue slice or acceptance-criteria-driven change.',
      action: 'Implement the smallest complete user outcome.',
      verification: 'Run the focused deterministic check and reviewer gate.',
      memory: 'Record issue, ADRs, commands, and evidence.',
      stopCondition: {
        evidence: 'All acceptance criteria pass with deterministic harness output.',
        observable: true,
      },
      tags: ['feature', 'slice', 'verification'],
    },
    score: 8,
    reason: 'Matched Vertical Feature Slice from task terms: slice.',
    copyPrompt: 'Use the \"Vertical Feature Slice\" Loop for this task.\\n\\nTask: Ship the current Loopwatch slice with verification.\\n\\nStop condition: All acceptance criteria pass with deterministic harness output.\\n\\nRecommendation only: Loopwatch does not execute this loop.',
    recommendationOnly: true,
  },
  loops: [],
  userLoopsPath: '/tmp/loopwatch-user-loops.json',
} as const;
async function expectSelectedCockpitSession(page: Page, session: { title: string; goal: string }): Promise<void> {
  const selectedRow = page.getByRole('button', { name: session.title });

  await expect(selectedRow).toHaveClass(/bg-watch-selected/);
  await expect(page.getByRole('heading', { name: session.title })).toBeVisible();
  await expect(page.getByText(session.goal).first()).toBeVisible();
}

async function routeCockpitFixture(page: Page, fixture: CockpitFixture, routed: string[] = []): Promise<string[]> {
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 404, json: { error: 'unexpected fixture endpoint' } });
  });
  await page.route('**/api/health', async (route) => {
    routed.push('/api/health');
    await route.fulfill({ json: fixture.health });
  });
  await page.route('**/api/loopwatch/runs?limit=120', async (route) => {
    routed.push('/api/loopwatch/runs');
    await route.fulfill({ json: fixture.runs });
  });
  await page.route(/\/api\/loopwatch\/convergence(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const pivotMode = url.searchParams.get('pivotMode') === 'loud' ? 'loud' : 'calm';
    routed.push(`/api/loopwatch/convergence${url.search}`);
    await route.fulfill({ json: convergenceWithPivotMode(fixture.convergence, pivotMode) });
  });
  await page.route('**/api/loopwatch/loops/recommend**', async (route) => {
    routed.push('/api/loopwatch/loops/recommend');
    await route.fulfill({ json: fixture.loopRecommendation ?? defaultLoopRecommendation });
  });
  for (const run of fixture.runs.runs) {
    await page.route(`**/api/runs/${run.runId}**`, async (route) => {
      routed.push(`/api/runs/${run.runId}`);
      await route.fulfill({
        json: fixture.runEvents ?? [],
        headers: {
          'Stream-Next-Offset': String(fixture.runEvents?.length ?? 0),
          'Stream-Up-To-Date': 'true',
          'Stream-Closed': 'true',
        },
      });
    });
  }
  return routed;
}

function convergenceWithPivotMode(convergence: unknown, mode: PivotMode): unknown {
  if (!convergence || typeof convergence !== 'object' || Array.isArray(convergence)) return convergence;
  const response = convergence as PivotConvergenceResponse;
  if (!response.sessions) return convergence;

  return {
    ...response,
    sessions: response.sessions.map((session) => {
      if (!session.pivotNudge) return session;
      return {
        ...session,
        pivotNudge: {
          ...session.pivotNudge,
          mode,
        },
      };
    }),
  };
}

test('loopwatch:focus-session selects the matching existing Cockpit session', async ({ page }) => {
  await routeCockpitFixture(page, deepLinkCockpitFixture);

  await page.goto('/');

  await page.getByRole('button', { name: interventionDeepLinkTitle }).click();
  await expectSelectedCockpitSession(page, {
    title: interventionDeepLinkTitle,
    goal: interventionDeepLinkSession.summary.goal,
  });

  await page.evaluate((sessionId) => {
    window.dispatchEvent(new CustomEvent('loopwatch:focus-session', { detail: { sessionId } }));
  }, securedDeepLinkSession.id);

  await expectSelectedCockpitSession(page, {
    title: securedDeepLinkTitle,
    goal: securedDeepLinkSession.summary.goal,
  });
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#session=${encodeURIComponent(securedDeepLinkSession.id)}`);
});

test('initial #session hash selects the matching existing Cockpit session', async ({ page }) => {
  await routeCockpitFixture(page, deepLinkCockpitFixture);

  await page.goto(`/#session=${encodeURIComponent(securedDeepLinkSession.id)}`);

  await expectSelectedCockpitSession(page, {
    title: securedDeepLinkTitle,
    goal: securedDeepLinkSession.summary.goal,
  });
});

test('Cockpit renders against mocked engine endpoints without Tauri', async ({ page }) => {
  const routed: string[] = [];

  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 404, json: { error: 'unexpected fixture endpoint' } });
  });
  await page.route('**/api/health', async (route) => {
    routed.push('/api/health');
    await route.fulfill({ json: cockpitEngineFixture.health });
  });
  await page.route('**/api/loopwatch/runs?limit=120', async (route) => {
    routed.push('/api/loopwatch/runs');
    await route.fulfill({ json: cockpitEngineFixture.runs });
  });
  await page.route(/\/api\/loopwatch\/convergence(?:\?.*)?$/, async (route) => {
    routed.push('/api/loopwatch/convergence');
    await route.fulfill({ json: cockpitEngineFixture.convergence });
  });
  await page.route('**/api/loopwatch/loops/recommend**', async (route) => {
    routed.push('/api/loopwatch/loops/recommend');
    await route.fulfill({ json: defaultLoopRecommendation });
  });

  await page.goto('/');

  await expect(page.getByText('Loopwatch Cockpit · Watchtower')).toBeVisible();
  await expect(page.getByText('Session rail')).toBeVisible();
  await expect(page.getByText('Start the Flue engine and Claude Source Adapter.')).toBeVisible();
  await expect(page.getByText('0 Flue batch runs replayed')).toBeVisible();
  expect(routed).toEqual(expect.arrayContaining(['/api/health', '/api/loopwatch/runs', '/api/loopwatch/convergence']));
});

test('Cockpit sends the runtime bearer token on direct engine fetches and displays convergence status and spend', async ({ page }) => {
  const securedRequests: { path: string; authorization: string | null }[] = [];
  const expectedAuthorization = `Bearer ${securedCockpitEngineFixture.token}`;

  await page.addInitScript((config) => {
    Object.assign(window, { __LOOPWATCH_ENGINE_CONFIG__: config });
  }, securedCockpitEngineFixture.runtimeConfig);

  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 404, json: { error: 'unexpected fixture endpoint' } });
  });
  await page.route('**/api/health', async (route) => {
    securedRequests.push({ path: '/api/health', authorization: route.request().headers().authorization ?? null });
    await route.fulfill({ json: securedCockpitEngineFixture.health });
  });
  await page.route('**/api/loopwatch/runs?limit=120', async (route) => {
    securedRequests.push({ path: '/api/loopwatch/runs', authorization: route.request().headers().authorization ?? null });
    await route.fulfill({ json: securedCockpitEngineFixture.runs });
  });
  await page.route(/\/api\/loopwatch\/convergence(?:\?.*)?$/, async (route) => {
    securedRequests.push({ path: '/api/loopwatch/convergence', authorization: route.request().headers().authorization ?? null });
    await route.fulfill({ json: securedCockpitEngineFixture.convergence });
  });
  await page.route('**/api/loopwatch/loops/recommend**', async (route) => {
    securedRequests.push({ path: '/api/loopwatch/loops/recommend', authorization: route.request().headers().authorization ?? null });
    await route.fulfill({ json: defaultLoopRecommendation });
  });
  await page.route('**/api/runs/run-secured-completed**', async (route) => {
    securedRequests.push({ path: '/api/runs/run-secured-completed', authorization: route.request().headers().authorization ?? null });
    await route.fulfill({
      json: securedCockpitEngineFixture.runEvents,
      headers: {
        'Stream-Next-Offset': '1',
        'Stream-Up-To-Date': 'true',
        'Stream-Closed': 'true',
      },
    });
  });

  await page.goto('/');

  await expect(page.getByText('Loopwatch Cockpit · Watchtower')).toBeVisible();
  await expect.poll(() => securedRequests.map((request) => request.path)).toEqual(
    expect.arrayContaining(['/api/health', '/api/loopwatch/runs', '/api/loopwatch/convergence', '/api/loopwatch/loops/recommend', '/api/runs/run-secured-completed']),
  );

  for (const path of ['/api/health', '/api/loopwatch/runs', '/api/loopwatch/convergence', '/api/loopwatch/loops/recommend', '/api/runs/run-secured-completed']) {
    expect(securedRequests.find((request) => request.path === path), `${path} carries the runtime bearer token`).toMatchObject({
      authorization: expectedAuthorization,
    });
  }

  await expect(page.getByText(/\bwatch\b/i).first()).toBeVisible();
  await expect(page.getByText('$0.001470').first()).toBeVisible();
  await expect(page.getByText(/cheap\s+1/i).first()).toBeVisible();
  await expect(page.getByText(/strong\s+1/i).first()).toBeVisible();

  const inspector = page.locator('aside', { hasText: 'Evidence inspector' });
  await expect(inspector).toContainText('Coaching recommendation');
  await expect(inspector).toContainText('Vertical Feature Slice');
  await expect(inspector).toContainText('All acceptance criteria pass with deterministic harness output.');
  await expect(inspector.locator('textarea')).toHaveValue(/Use the "Vertical Feature Slice" Loop/);
});

test('Intervention card exposes its evidence receipt and deep-links to the matching timeline moment', async ({ page }) => {
  await routeCockpitFixture(page, interventionCockpitEngineFixture);

  await page.goto('/');

  const interventionCard = page.getByLabel('Intervention Card');
  await expect(interventionCard).toBeVisible();
  await expect(interventionCard).toContainText('Validation repair is churning');
  await expect(interventionCard).toContainText('pnpm convergence:check exited 1 after repeated repair attempts');
  await expect(interventionCard).toContainText('Pause the repair loop, isolate the failing check, and land the smallest change that makes it pass.');

  await interventionCard.getByRole('button', { name: 'Inspect evidence' }).click();

  const timelineEvidence = page.locator('[id="timeline-claude-cockpit-intervention-session-convergence-intervention-validation-churn-churn"]');
  await expect(timelineEvidence).toBeVisible();
  await expect(timelineEvidence).toContainText('Validation repair is churning');
  await expect(timelineEvidence).toContainText('pnpm convergence:check exited 1 after repeated repair attempts');

  const inspector = page.locator('aside', { hasText: 'Evidence inspector' });
  await expect(inspector).toContainText('intervention-validation-churn');
  await expect(inspector).toContainText('churn');
  await expect(inspector).toContainText('pnpm convergence:check exited 1 after repeated repair attempts');
});

test('Cockpit renders post-session coaching as a Coaching Card separate from Intervention Cards', async ({ page }) => {
  await routeCockpitFixture(page, postSessionInsightCockpitEngineFixture);

  await page.goto('/');

  const coachingCard = page.getByLabel('Post-session Coaching Card');
  await expect(coachingCard).toBeVisible();
  await expect(coachingCard).toContainText('Post-session coaching: validation failed before convergence');
  await expect(coachingCard).toContainText('post-session-validation-fail');
  await expect(coachingCard).toContainText('weak_validation');
  await expect(coachingCard).toContainText('pnpm convergence:check exited 1');
  await expect(coachingCard).toContainText('run pnpm convergence:check until it passes');
  await expect(page.getByLabel('Intervention Card')).toHaveCount(0);
});

test('Upgrades inbox renders repeated blind spots as proposal-only cards separate from Intervention Cards', async ({ page }) => {
  await routeCockpitFixture(page, upgradesCockpitEngineFixture);

  await page.goto('/');

  const inspector = page.locator('aside', { hasText: 'Evidence inspector' });
  const upgradesInbox = inspector.getByLabel('Upgrades inbox');
  await expect(upgradesInbox).toBeVisible();
  await expect(upgradesInbox).toContainText('Upgrades inbox');

  const upgradeCards = upgradesInbox.getByLabel('Upgrade Card');
  await expect(upgradeCards).toHaveCount(2);

  const capabilityCard = upgradeCards.filter({ hasText: 'Claude cost capability gap' });
  await expect(capabilityCard).toContainText('2 sessions reported cost unavailable');
  await expect(capabilityCard).toContainText('Claude adapter does not provide direct cost');
  await expect(capabilityCard).toContainText('Add real cost evidence to the Claude Source Adapter');
  await expect(capabilityCard).toContainText('available only when real source data is present');

  const unknownKindCard = upgradeCards.filter({ hasText: 'Unknown event kind: assistant_event.delta' });
  await expect(unknownKindCard).toContainText('2 sessions preserved unknown event kind "assistant_event.delta" from Claude');
  await expect(unknownKindCard).toContainText('first-class Loopwatch Event kind');
  await expect(unknownKindCard).toContainText('still preserve source-native payload fields');

  await expect(upgradesInbox).toContainText(/propose-only|proposal only|human-approved/i);
  await expect(upgradesInbox.getByRole('button')).toHaveCount(0);
  await expect(upgradesInbox).not.toContainText(/Loopwatch will (?:edit|install|open (?:a )?PR|change settings)/i);
  await expect(page.getByLabel('Intervention Card')).toHaveCount(0);
  await expect(page.locator('main > section > section').getByLabel('Upgrade Card')).toHaveCount(0);
});

test('Pivot nudges default to a calm session marker and loud mode surfaces an interruptive Cockpit card', async ({ page }) => {
  const routed: string[] = [];
  await routeCockpitFixture(page, pivotCockpitEngineFixture, routed);

  await page.goto('/');

  await expect(page.getByText('Ship issue #15 Pivot detection with a fresh-session nudge.').first()).toBeVisible();
  await expect(page.getByText('User pivot detected').first()).toBeVisible();
  await expect(page.getByText('Start a fresh session for the onboarding email campaign.').first()).toBeVisible();
  await expect(page.getByLabel('Intervention Card')).toHaveCount(0);
  await expect(page.getByLabel('Pivot Coaching Card')).toHaveCount(0);

  const loudToggle = page.getByRole('button', { name: 'Toggle Pivot nudge mode' });
  await expect(loudToggle).toContainText('Pivot calm');

  await loudToggle.click();

  await expect(loudToggle).toContainText('Pivot loud');
  await expect.poll(() => routed.includes('/api/loopwatch/convergence?pivotMode=loud')).toBe(true);

  const pivotCard = page.getByLabel('Pivot Coaching Card');
  await expect(pivotCard).toBeVisible();
  await expect(pivotCard).toContainText('User pivot detected');
  await expect(pivotCard).toContainText('Start a fresh session for the onboarding email campaign.');
  await expect(pivotCard).toContainText('Loopwatch will not create, control, or start one for you.');
});

test('Dismissing an intervention card suppresses only that evidence key during the page session', async ({ page }) => {
  const routed: string[] = [];
  const fastPollingFixture = {
    ...interventionCockpitEngineFixture,
    convergence: {
      ...interventionCockpitEngineFixture.convergence,
      nextPollMs: 25,
    },
  };
  await routeCockpitFixture(page, fastPollingFixture, routed);

  await page.goto('/');

  const interventionCard = page.getByLabel('Intervention Card');
  await expect(interventionCard).toBeVisible();
  await expect(interventionCard).toContainText('Validation repair is churning');
  await expect(interventionCard).toContainText('Pause the repair loop, isolate the failing check, and land the smallest change that makes it pass.');
  await expect(interventionCard).not.toContainText('Completion claim lacks validation evidence');

  await interventionCard.getByRole('button', { name: 'Dismiss' }).click();

  await expect(interventionCard).toBeVisible();
  await expect(interventionCard).not.toContainText('Validation repair is churning');
  await expect(interventionCard).not.toContainText('Pause the repair loop, isolate the failing check, and land the smallest change that makes it pass.');
  await expect(interventionCard).toContainText('Completion claim lacks validation evidence');
  await expect(interventionCard).toContainText('Request the missing validation receipt before accepting the completion claim.');
  await expect.poll(() => routed.filter((path) => path.startsWith('/api/loopwatch/convergence')).length).toBeGreaterThan(1);
  await expect(interventionCard).toContainText('Completion claim lacks validation evidence');
  await expect(interventionCard).not.toContainText('Validation repair is churning');
});

test('Intervention status without a recommended action does not show an intervention card', async ({ page }) => {
  await routeCockpitFixture(page, noActionInterventionCockpitEngineFixture);

  await page.goto('/');

  await expect(page.getByText('Missing recommended action should not surface').first()).toBeVisible();
  await expect(page.getByLabel('Intervention Card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
});
