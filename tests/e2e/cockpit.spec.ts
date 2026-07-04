import { expect, test } from '@playwright/test';

import { cockpitEngineFixture } from '../support/cockpit-fixture.js';

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
