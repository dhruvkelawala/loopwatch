import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  cockpitEngineFixture,
  interventionCockpitEngineFixture,
  noActionInterventionCockpitEngineFixture,
  securedCockpitEngineFixture,
} from '../support/cockpit-fixture.js';

type CockpitFixture = {
  health: unknown;
  runs: { ok: true; runs: readonly { runId: string }[]; nextPollMs: number };
  convergence: unknown;
  runEvents?: readonly unknown[];
};

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
  await page.route('**/api/loopwatch/convergence', async (route) => {
    routed.push('/api/loopwatch/convergence');
    await route.fulfill({ json: fixture.convergence });
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
  await page.route('**/api/loopwatch/convergence', async (route) => {
    routed.push('/api/loopwatch/convergence');
    await route.fulfill({ json: cockpitEngineFixture.convergence });
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
  await page.route('**/api/loopwatch/convergence', async (route) => {
    securedRequests.push({ path: '/api/loopwatch/convergence', authorization: route.request().headers().authorization ?? null });
    await route.fulfill({ json: securedCockpitEngineFixture.convergence });
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
    expect.arrayContaining(['/api/health', '/api/loopwatch/runs', '/api/loopwatch/convergence', '/api/runs/run-secured-completed']),
  );

  for (const path of ['/api/health', '/api/loopwatch/runs', '/api/loopwatch/convergence', '/api/runs/run-secured-completed']) {
    expect(securedRequests.find((request) => request.path === path), `${path} carries the runtime bearer token`).toMatchObject({
      authorization: expectedAuthorization,
    });
  }

  await expect(page.getByText(/\bwatch\b/i).first()).toBeVisible();
  await expect(page.getByText('$0.001470').first()).toBeVisible();
  await expect(page.getByText(/cheap\s+1/i).first()).toBeVisible();
  await expect(page.getByText(/strong\s+1/i).first()).toBeVisible();
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
  await expect.poll(() => routed.filter((path) => path === '/api/loopwatch/convergence').length).toBeGreaterThan(1);
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
