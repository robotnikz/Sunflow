import { expect, test } from '@playwright/test';

test('loads app and shows settings modal', async ({ page }) => {
  await page.goto('/');

  // Header renders immediately.
  await expect(page.getByText('SunFlow')).toBeVisible();

  const settingsHeading = page.getByRole('heading', { name: 'System Settings' });

  // Fresh data dir => app usually opens settings automatically.
  // Wait briefly for auto-open; only click if it didn't appear.
  try {
    await settingsHeading.waitFor({ state: 'visible', timeout: 2000 });
  } catch {
    await page.getByTitle('Settings').click();
    await settingsHeading.waitFor({ state: 'visible', timeout: 10_000 });
  }

  await expect(settingsHeading).toBeVisible();
  await expect(page.getByRole('button', { name: /save settings/i })).toBeVisible();

  // Light interaction smoke: switch tabs and ensure UI is still responsive.
  await page.getByRole('button', { name: /notifications/i }).click();
  await expect(page.getByText('Discord Integration')).toBeVisible();

  await page.getByRole('button', { name: /general/i }).click();
  await expect(page.getByPlaceholder('e.g. 192.168.1.50')).toBeVisible();
});
