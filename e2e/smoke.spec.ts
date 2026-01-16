import { expect, test } from '@playwright/test';

test('loads app and shows settings modal', async ({ page }) => {
  await page.goto('/');

  // Header renders immediately.
  await expect(page.getByText('SunFlow')).toBeVisible();

  const settingsDialog = page.getByRole('dialog', { name: 'System Settings' });
  const settingsHeading = page.getByRole('heading', { name: 'System Settings' });

  // Fresh data dir => app usually opens settings automatically.
  // Wait briefly for auto-open; only click if it didn't appear.
  try {
    await settingsHeading.waitFor({ state: 'visible', timeout: 2000 });
  } catch {
    await page.getByTitle('Settings').click();
    await settingsHeading.waitFor({ state: 'visible', timeout: 10_000 });
  }

  await expect(settingsDialog).toBeVisible();
  await expect(settingsHeading).toBeVisible();
  await expect(page.getByRole('button', { name: /save settings/i })).toBeVisible();

  // Accessibility smoke: close button is reachable and named.
  const closeBtn = page.getByLabel('Close settings');
  await expect(closeBtn).toBeVisible();
  await closeBtn.focus();
  await expect(closeBtn).toBeFocused();

  // Light interaction smoke: switch tabs and ensure UI is still responsive.
  await page.getByRole('button', { name: /notifications/i }).click();
  await expect(page.getByText('Discord Integration')).toBeVisible();

  // Accessibility smoke: notifications toggle exposes a switch role/state.
  const toggle = page.getByRole('switch', { name: /enable notifications/i });
  await expect(toggle).toBeVisible();

  await page.getByRole('button', { name: /general/i }).click();
  await expect(page.getByPlaceholder('e.g. 192.168.1.50')).toBeVisible();

  // Accessibility smoke: Escape closes the modal.
  await page.keyboard.press('Escape');
  await expect(settingsHeading).toBeHidden();

  // Re-open via the Settings button.
  await page.getByTitle('Settings').click();
  await expect(settingsHeading).toBeVisible();
});
