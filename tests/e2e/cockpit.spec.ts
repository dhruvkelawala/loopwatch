import { expect, test } from '@playwright/test';

import { cockpitEngineFixture, securedCockpitEngineFixture } from '../support/cockpit-fixture.js';

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

  await page.goto('/');

  await expect(page.getByText('Loopwatch Cockpit · Watchtower')).toBeVisible();
  await expect(page.getByText('Session rail')).toBeVisible();
  await expect(page.getByText('Start the Flue engine and Claude Source Adapter.')).toBeVisible();
  await expect(page.getByText('0 Flue batch runs replayed')).toBeVisible();
  expect(routed).toEqual(expect.arrayContaining(['/api/health', '/api/loopwatch/runs']));
});

test('Cockpit sends the runtime bearer token on direct engine fetches and Flue SDK replay fetches', async ({ page }) => {
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
    expect.arrayContaining(['/api/health', '/api/loopwatch/runs', '/api/runs/run-secured-completed']),
  );

  for (const path of ['/api/health', '/api/loopwatch/runs', '/api/runs/run-secured-completed']) {
    expect(securedRequests.find((request) => request.path === path), `${path} carries the runtime bearer token`).toMatchObject({
      authorization: expectedAuthorization,
    });
  }
});
