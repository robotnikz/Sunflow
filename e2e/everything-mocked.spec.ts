import { expect, test } from '@playwright/test';

import { installApiMocks } from './helpers/mockApi';

test.describe('mocked UI E2E (broad coverage)', () => {
  test('dashboard renders core sections with mocked APIs', async ({ page }) => {
    await installApiMocks(page);

    await page.goto('/');
    await expect(page.getByText('SunFlow')).toBeVisible();

    // Dashboard analysis controls
    await expect(page.getByRole('heading', { name: 'Statistics & Analysis' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Day' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Week' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Month' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Year' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Custom' })).toBeVisible();

    // Feature entrypoints
    await expect(page.getByText('Scenario Planner')).toBeVisible();
    await expect(page.getByText('Dynamic Tariff Comparison (aWATTar)')).toBeVisible();

    // Weather widget should render (we stub open-meteo)
    await expect(page.getByText('Local Weather')).toBeVisible();
  });

  test('export CSV triggers a download', async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/');

    const downloadPromise = page.waitForEvent('download');
    await page.getByTitle('Export CSV').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain('sunflow_data_');
    expect(download.suggestedFilename()).toContain('.csv');
  });

  test('switching time range triggers history fetch and UI stays responsive', async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/');

    await page.getByRole('button', { name: 'Week' }).click();
    await expect(page.getByText('Statistics & Analysis')).toBeVisible();

    await page.getByRole('button', { name: 'Custom' }).click();
    // Custom picker appears (two date inputs)
    await expect(page.locator('input[type="date"]').first()).toBeVisible();
  });

  test('scenario planner opens and shows simulator UI', async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/');

    await page.getByRole('button', { name: /scenario planner/i }).click();
    await expect(page.getByRole('heading', { name: 'Upgrade Simulator' })).toBeVisible();
    // Avoid strict-mode ambiguity on repeated labels by asserting specific controls.
    await expect(page.getByRole('button', { name: 'Last week' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Last month' })).toBeVisible();
    await expect(page.getByText('ADD PV Power')).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Upgrade Simulator')).toBeHidden();
  });

  test('dynamic tariff comparison runs against mocked backend', async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/');

    await page.getByRole('button', { name: /dynamic tariff comparison \(awattar\)/i }).click();
    const runButton = page.getByRole('button', { name: /run comparison/i });
    await expect(runButton).toBeVisible();

    await runButton.click();

    // Assert on visible result summary cards (tooltip text like "Delta (dyn-fixed)" is not always rendered).
    await expect(page.getByText('Fixed net cost')).toBeVisible();
    await expect(page.getByText('Dynamic net cost')).toBeVisible();
    await expect(page.getByText('Difference')).toBeVisible();
  });

  test('settings: tariffs and expenses CRUD with confirms', async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/');

    // Ensure the app shell is rendered before opening Settings.
    await expect(page.getByText('SunFlow')).toBeVisible();

    await page.getByTitle('Settings').click();
    const dialog = page.getByRole('dialog', { name: 'System Settings' });
    await expect(dialog).toBeVisible();

    // Tariffs: add second tariff and delete it.
    await dialog.getByRole('button', { name: /prices/i }).click();
    await expect(dialog.getByText('Add Price Change')).toBeVisible();

    const tariffDate = dialog.locator('label:has-text("Valid From")').locator('..').locator('input[type="date"]');
    await tariffDate.fill(new Date().toISOString().split('T')[0]);

    await dialog.locator('label:has-text("Grid Cost / kWh")').locator('..').locator('input[type="number"]').fill('0.31');
    await dialog.locator('label:has-text("Feed-in / kWh")').locator('..').locator('input[type="number"]').fill('0.07');

    await dialog.getByRole('button', { name: 'Add Price Entry' }).click();
    await expect(dialog.getByText('Price History')).toBeVisible();

    const tariffRows = dialog.locator('table tbody tr');
    await expect(tariffRows).toHaveCount(2);

    // Delete one entry: accept confirm.
    {
      page.once('dialog', async d => d.accept());
      await tariffRows.first().locator('button[type="button"]').click();
      await expect(tariffRows).toHaveCount(1);
    }

    // Attempt to delete the final remaining tariff: confirm accept; expect alert.
    // (Our mock simulates backend constraint and SettingsModal shows alert.)
    {
      let alertMsg: string | null = null;
      const handler = async (d: any) => {
        if (d.type() === 'confirm') {
          await d.accept();
          return;
        }
        if (d.type() === 'alert') {
          alertMsg = d.message();
          await d.accept();
          page.off('dialog', handler);
          return;
        }
        await d.accept();
      };
      page.on('dialog', handler);

      await tariffRows.first().locator('button[type="button"]').click();
      await expect.poll(() => alertMsg, { timeout: 5000 }).toContain('Could not delete tariff');
      await expect(tariffRows).toHaveCount(1);
    }

    // Expenses: add then delete.
    await dialog.getByRole('button', { name: /roi/i }).click();
    await expect(dialog.getByRole('heading', { name: 'Add Expense' })).toBeVisible();

    await dialog.getByPlaceholder('e.g. Initial Installation').fill('Maintenance');
    await dialog.locator('label:has-text("Amount")').locator('..').locator('input[type="number"]').fill('99.99');
    await dialog.getByRole('button', { name: 'Add Expense' }).click();

    // Delete last expense (trash button), accept confirm.
    {
      page.once('dialog', async d => d.accept());
      await dialog.locator('table').locator('button[type="button"]').last().click();
    }
  });

  test('settings: appliances list can be saved', async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/');

    await expect(page.getByText('SunFlow')).toBeVisible();

    await page.getByTitle('Settings').click();
    const dialog = page.getByRole('dialog', { name: 'System Settings' });

    await dialog.getByRole('button', { name: /appliances/i }).click();
    await dialog.getByRole('button', { name: /add new device/i }).click();

    await dialog.locator('label:has-text("Device Name")').locator('..').locator('input[type="text"]').fill('Dishwasher');

    // Enter kWh per run (default input mode)
    await dialog.locator('label:has-text("kWh per run")').locator('..').locator('input[type="number"]').fill('1.2');

    await dialog.getByRole('button', { name: /save device/i }).click();
    await expect(dialog.getByText('Dishwasher')).toBeVisible();

    // Persist via Save List (posts config)
    await dialog.getByRole('button', { name: /save list/i }).click();
  });

  test('settings: CSV import flow reaches mapping step', async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/');

    await expect(page.getByText('SunFlow')).toBeVisible();

    await page.getByTitle('Settings').click();
    const dialog = page.getByRole('dialog', { name: 'System Settings' });
    await dialog.getByRole('button', { name: /data import/i }).click();

    // Upload a simple CSV (server endpoints are mocked).
    const csv = 'timestamp,power_pv\n2026-01-01T00:00:00Z,123\n';
    await dialog
      .locator('input[type="file"]')
      .setInputFiles({ name: 'test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });

    // After preview is returned, the component advances to step 2.
    await expect(dialog.getByText(/file:/i)).toBeVisible();
  });
});
