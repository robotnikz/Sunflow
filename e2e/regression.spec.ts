import { expect, test } from '@playwright/test';

const SETTINGS_HEADING = 'System Settings';

async function ensureSettingsOpen(page: any) {
  const heading = page.getByRole('heading', { name: SETTINGS_HEADING });

  try {
    await heading.waitFor({ state: 'visible', timeout: 1500 });
    return;
  } catch {
    // fall through
  }

  await page.getByTitle('Settings').click();
  await expect(heading).toBeVisible();
}

test.describe('regression: settings & notifications', () => {
  // These tests share a single backend + DATA_DIR; keep them serial to avoid flakiness.
  test.describe.configure({ mode: 'serial' });

  test('settings modal closes via Close button', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('SunFlow')).toBeVisible();

    await ensureSettingsOpen(page);

    const heading = page.getByRole('heading', { name: SETTINGS_HEADING });
    await expect(heading).toBeVisible();

    await page.getByLabel('Close settings').click();
    await expect(heading).toBeHidden();
  });

  test('can save inverter IP and see it persisted after reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('SunFlow')).toBeVisible();

    await ensureSettingsOpen(page);

    const dialog = page.getByRole('dialog', { name: SETTINGS_HEADING });
    await expect(dialog).toBeVisible();

    const inverterIp = dialog.getByPlaceholder('e.g. 192.168.1.50');
    await inverterIp.fill('192.168.1.10');

    const commissioningDate = dialog.locator('input[type="date"]');
    await commissioningDate.fill(new Date().toISOString().split('T')[0]);

    await dialog.getByRole('button', { name: /save settings/i }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(page.getByText('SunFlow')).toBeVisible();

    await ensureSettingsOpen(page);
    const inverterIpAfter = page
      .getByRole('dialog', { name: SETTINGS_HEADING })
      .getByPlaceholder('e.g. 192.168.1.50');

    await expect(inverterIpAfter).toHaveValue('192.168.1.10');
  });

  test('notifications Test enforces "save first" for changed webhook', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('SunFlow')).toBeVisible();

    await ensureSettingsOpen(page);

    const dialog = page.getByRole('dialog', { name: SETTINGS_HEADING });
    await dialog.getByRole('button', { name: /notifications/i }).click();

    // Enable to allow interacting with the webhook field and Test button.
    await dialog.getByRole('switch', { name: /enable notifications/i }).click();

    const webhookRow = dialog.locator('label:has-text("Webhook URL")').locator('..');
    const webhookField = webhookRow.locator('input[type="text"]');

    const differentWebhook = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDE_FG';
    await webhookField.fill(differentWebhook);

    let seenMessage: string | null = null;
    page.once('dialog', async (d) => {
      seenMessage = d.message();
      await d.accept();
    });

    // If the click triggers an alert(), Playwright will wait for the dialog to be handled.
    // Accept the dialog in the handler above to avoid deadlocks/timeouts.
    await webhookRow.locator('button[type="button"]').click({ force: true });
    expect(seenMessage).toContain('Please save settings first');
  });

  test('data import tab renders uploader UI', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('SunFlow')).toBeVisible();

    await ensureSettingsOpen(page);

    const dialog = page.getByRole('dialog', { name: SETTINGS_HEADING });
    await dialog.getByRole('button', { name: /data import/i }).click();

    await expect(dialog.getByText('Click to upload CSV')).toBeVisible();
  });
});
