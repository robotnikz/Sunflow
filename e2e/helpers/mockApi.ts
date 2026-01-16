import type { Page, Route } from '@playwright/test';

import type {
  AwattarComparisonResponse,
  BatteryHealthData,
  Expense,
  ForecastData,
  HistoryData,
  InverterData,
  RoiData,
  SystemConfig,
  Tariff,
} from '../../types';

type JsonValue = any;

type MockApiState = {
  config: SystemConfig;
  tariffs: Required<Tariff>[];
  expenses: Required<Expense>[];
  history: HistoryData;
  roi: RoiData;
  batteryHealth: BatteryHealthData;
  forecast: ForecastData;
  inverterData: InverterData;
  awattar: AwattarComparisonResponse;
};

export type MockApiOptions = Partial<{
  config: Partial<SystemConfig>;
  tariffs: Tariff[];
  expenses: Expense[];
}>;

const json = (data: JsonValue, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(data),
});

const todayIso = () => new Date().toISOString().split('T')[0];

const buildDefaultHistory = (): HistoryData => {
  const now = Date.now();
  const points = Array.from({ length: 24 }, (_, i) => {
    const t = new Date(now - (23 - i) * 60 * 60 * 1000).toISOString();
    return {
      timestamp: t,
      production: 1200 + i * 10,
      consumption: 900 + i * 8,
      soc: 50 + (i % 10),
      grid: i % 2 === 0 ? 200 : -150,
      battery: i % 2 === 0 ? 100 : -80,
      autonomy: 70,
      selfConsumption: 65,
      status: 1,
    };
  });

  return {
    chart: points,
    stats: {
      production: 12.3,
      consumption: 10.8,
      imported: 2.1,
      exported: 1.4,
      batteryCharged: 1.2,
      batteryDischarged: 1.0,
      autonomy: 75,
      selfConsumption: 68,
      costSaved: 3.45,
      earnings: 1.23,
    },
  };
};

const buildDefaultSimulationData = () => {
  // Provide a full local day (yesterday) with hourly points.
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 1);

  return Array.from({ length: 24 }, (_, h) => {
    const t = new Date(start);
    t.setHours(h, 0, 0, 0);
    return {
      t: t.getTime(),
      p: h >= 8 && h <= 17 ? 2200 : 0,
      l: 900,
      s: 55,
      gi: 150,
      ge: 50,
      bc: 120,
      bd: 100,
    };
  });
};

const buildDefaultWeatherResponse = () => {
  const d = new Date();
  const today = d.toISOString().split('T')[0];
  return {
    current: {
      temperature_2m: 21.5,
      weather_code: 1,
      is_day: 1,
    },
    daily: {
      sunrise: [`${today}T07:30`],
      sunset: [`${today}T17:10`],
    },
  };
};

const defaultState = (): MockApiState => {
  const config: SystemConfig = {
    inverterIp: '192.168.1.10',
    currency: 'EUR',
    systemStartDate: todayIso(),
    latitude: '52.52',
    longitude: '13.40',
    systemCapacity: 10,
    batteryCapacity: 10,
    appliances: [],
    notifications: {
      enabled: false,
      discordWebhook: '',
      triggers: {
        errors: false,
        batteryFull: false,
        batteryEmpty: false,
        batteryHealth: false,
        smartAdvice: false,
      },
      smartAdviceCooldownMinutes: 120,
      sohThreshold: 75,
      minCyclesForSoh: 50,
    },
  };

  const tariffs: Required<Tariff>[] = [
    { id: 1, validFrom: todayIso(), costPerKwh: 0.33, feedInTariff: 0.08 },
  ];

  const expenses: Required<Expense>[] = [
    { id: 1, name: 'Initial Installation', amount: 12000, type: 'one_time', date: todayIso() },
  ];

  const history = buildDefaultHistory();

  const roi: RoiData = {
    totalInvested: 12000,
    totalReturned: 1234,
    netValue: -10766,
    roiPercent: 10.28,
    breakEvenDate: null,
    projectedBreakEvenCost: undefined,
    expenses,
  };

  const batteryHealth: BatteryHealthData = {
    dataPoints: [
      { date: todayIso(), efficiency: 92, estimatedCapacity: 9.1, chargeCycles: 51 },
    ],
    averageEfficiency: 92,
    latestCapacityEst: 9.1,
    totalCycles: 51,
  };

  const forecast: ForecastData = {
    forecasts: [
      { period_end: new Date(Date.now() + 30 * 60 * 1000).toISOString(), pv_estimate: 2.5 },
      { period_end: new Date(Date.now() + 60 * 60 * 1000).toISOString(), pv_estimate: 3.1 },
    ],
  };

  const inverterData: InverterData = {
    power: { pv: 2400, load: 1300, grid: -200, battery: -900 },
    battery: { soc: 55, state: 'charging' },
    energy: { today: { production: 12.3, consumption: 10.8 } },
    autonomy: 75,
    selfConsumption: 68,
  };

  const awattar: AwattarComparisonResponse = {
    provider: 'awattar',
    country: 'DE',
    postalCode: '10115',
    period: 'week',
    range: { from: '2026-01-01T00:00:00Z', to: '2026-01-07T23:00:00Z' },
    assumptions: {
      marketPriceUnit: 'EUR/MWh',
      marketToKwhFactor: 0.001,
      surchargeCt: 0,
      vatPercent: 0,
    },
    coverage: {
      hoursWithEnergy: 168,
      hoursWithPrices: 168,
      hoursUsed: 168,
    },
    totals: {
      fixed: { importCost: 20.0, exportRevenue: 3.0, net: 17.0 },
      dynamic: { importCost: 18.0, exportRevenue: 3.0, net: 15.0 },
      delta: { net: -2.0 },
    },
    seriesDaily: [
      { date: '2026-01-01', fixedNet: 2.4, dynamicNet: 2.2, importKwh: 8, exportKwh: 3 },
      { date: '2026-01-02', fixedNet: 2.3, dynamicNet: 2.1, importKwh: 7.5, exportKwh: 2.8 },
    ],
  };

  return {
    config,
    tariffs,
    expenses,
    history,
    roi,
    batteryHealth,
    forecast,
    inverterData,
    awattar,
  };
};

async function fulfillJson(route: Route, data: JsonValue, status = 200) {
  await route.fulfill(json(data, status));
}

async function handleCollection<T extends { id?: number }>(
  route: Route,
  list: T[],
  nextId: () => number,
) {
  const req = route.request();
  const method = req.method().toUpperCase();

  if (method === 'GET') {
    return fulfillJson(route, list);
  }

  if (method === 'POST') {
    const body = req.postDataJSON() as Partial<T>;
    const item = { ...body, id: nextId() } as T;
    list.unshift(item);
    return fulfillJson(route, { success: true });
  }

  return fulfillJson(route, { error: 'Method not allowed' }, 405);
}

export async function installApiMocks(page: Page, opts: MockApiOptions = {}) {
  const state = defaultState();

  state.config = { ...state.config, ...(opts.config || {}) };
  if (opts.tariffs) {
    state.tariffs = opts.tariffs.map((t, idx) => ({
      id: t.id ?? (idx + 1),
      validFrom: t.validFrom,
      costPerKwh: t.costPerKwh,
      feedInTariff: t.feedInTariff,
    }));
  }
  if (opts.expenses) {
    state.expenses = opts.expenses.map((e, idx) => ({
      id: e.id ?? (idx + 1),
      name: e.name,
      amount: e.amount,
      type: e.type,
      date: e.date,
    }));
  }

  let nextTariffId = Math.max(0, ...state.tariffs.map(t => t.id)) + 1;
  let nextExpenseId = Math.max(0, ...state.expenses.map(e => e.id)) + 1;

  // Core app calls
  await page.route('**/api/info', async route => fulfillJson(route, { version: '1.11.0', updateAvailable: false, latestVersion: '1.11.0', releaseUrl: '' }));

  await page.route('**/api/config', async route => {
    const req = route.request();
    const method = req.method().toUpperCase();
    if (method === 'GET') return fulfillJson(route, state.config);
    if (method === 'POST') {
      const patch = req.postDataJSON() as Partial<SystemConfig>;
      state.config = { ...state.config, ...patch };
      return fulfillJson(route, { success: true });
    }
    return fulfillJson(route, { error: 'Method not allowed' }, 405);
  });

  await page.route('**/api/data', async route => fulfillJson(route, state.inverterData));

  await page.route('**/api/history?*', async route => fulfillJson(route, state.history));
  await page.route('**/api/roi', async route => fulfillJson(route, state.roi));
  await page.route('**/api/battery-health', async route => fulfillJson(route, state.batteryHealth));
  await page.route('**/api/forecast', async route => fulfillJson(route, state.forecast));

  await page.route('**/api/simulation-data', async route => fulfillJson(route, buildDefaultSimulationData()));

  // Dynamic pricing
  await page.route('**/api/dynamic-pricing/awattar/compare?*', async route => fulfillJson(route, state.awattar));

  // Tariffs & expenses
  await page.route('**/api/tariffs', async route =>
    handleCollection(route, state.tariffs, () => nextTariffId++),
  );

  await page.route(/.*\/api\/tariffs\/(\d+)$/, async route => {
    const idStr = /\/api\/tariffs\/(\d+)$/.exec(route.request().url())?.[1];
    const id = idStr ? Number(idStr) : NaN;

    if (!Number.isFinite(id)) return fulfillJson(route, { error: 'Bad id' }, 400);

    // Simulate backend constraint: must have at least 1 tariff.
    if (state.tariffs.length <= 1) return fulfillJson(route, { error: 'Must keep at least one tariff' }, 400);

    state.tariffs = state.tariffs.filter(t => t.id !== id);
    return fulfillJson(route, { success: true });
  });

  await page.route('**/api/expenses', async route =>
    handleCollection(route, state.expenses, () => nextExpenseId++),
  );

  await page.route(/.*\/api\/expenses\/(\d+)$/, async route => {
    const idStr = /\/api\/expenses\/(\d+)$/.exec(route.request().url())?.[1];
    const id = idStr ? Number(idStr) : NaN;
    if (!Number.isFinite(id)) return fulfillJson(route, { error: 'Bad id' }, 400);

    state.expenses = state.expenses.filter(e => e.id !== id);
    return fulfillJson(route, { success: true });
  });

  // CSV import endpoints (UI-only coverage)
  await page.route('**/api/preview-csv', async route =>
    fulfillJson(route, { headers: ['timestamp', 'power_pv'], preview: [{ timestamp: '2026-01-01T00:00:00Z', power_pv: 123 }] }),
  );
  await page.route('**/api/import-csv', async route => fulfillJson(route, { success: true, imported: 1, failed: 0 }));

  // Notifications test endpoint
  await page.route('**/api/test-notification', async route => fulfillJson(route, { success: true }));

  // Open-Meteo (Dashboard fetches directly)
  await page.route('https://api.open-meteo.com/**', async route => fulfillJson(route, buildDefaultWeatherResponse()));

  return state;
}
