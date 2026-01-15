
export interface Tariff {
  id?: number;
  validFrom: string; // ISO Date string (YYYY-MM-DD)
  costPerKwh: number;
  feedInTariff: number;
}

export interface Expense {
  id?: number;
  name: string;
  amount: number;
  type: 'one_time' | 'yearly';
  date: string; // Date incurred or start date for yearly
}

export interface Appliance {
  id: string;
  name: string;
  watts: number;
  kwhEstimate: number; // calculated from watts * duration or manual
  iconName: string;    // String reference to Lucide icon key
  color: string;       // Tailwind text color class
}

export interface NotificationConfig {
  enabled: boolean;
  discordWebhook: string;
  triggers: {
    errors: boolean;
    batteryFull: boolean;
    batteryEmpty: boolean; // Triggers at <= 7%
    batteryHealth: boolean; // New: Triggers if SOH drops below threshold
    smartAdvice: boolean;
  };
  smartAdviceCooldownMinutes: number;
  // SOH Config
  sohThreshold?: number; // Default 75%
  minCyclesForSoh?: number; // Default 50 cycles
}

export interface SystemConfig {
  inverterIp: string;
  currency: string;
  systemStartDate?: string; // For calculating recurring costs duration
  latitude?: string;
  longitude?: string;
  systemCapacity?: number; // kWp
  batteryCapacity?: number; // kWh (Total capacity of the stack)
  degradationRate?: number; // % per year (default 0.5)
  inflationRate?: number; // % per year (default 2.0)
  solcastApiKey?: string;
  solcastSiteId?: string;
  initialValues?: {
    production?: number; // kWh
    import?: number; // kWh
    export?: number; // kWh
    financialReturn?: number; // Money amount already saved/earned before app installation
  };
  dbTotals?: {
    production?: number;
    import?: number;
    export?: number;
    financialReturn?: number;
  };
  appliances?: Appliance[]; // Custom list of user devices
  notifications?: NotificationConfig;

  // Optional: defaults for dynamic tariff comparisons (used by backend if query params are omitted)
  dynamicTariff?: {
    awattar?: {
      country?: 'DE' | 'AT';
      postalCode?: string;
      surchargeCt?: number; // ct/kWh (all-in add-on)
      vatPercent?: number; // %
    };
  };
}

export type AwattarComparePeriod = 'week' | 'month' | 'halfyear' | 'year';

export interface AwattarComparisonDaily {
  date: string; // YYYY-MM-DD
  fixedNet: number;
  dynamicNet: number;
  importKwh: number;
  exportKwh: number;
}

export interface AwattarComparisonResponse {
  provider: 'awattar';
  country: 'DE' | 'AT' | string;
  postalCode: string;
  period: AwattarComparePeriod | string;
  range: {
    from: string; // hour key
    to: string;   // hour key
  };
  assumptions: {
    marketPriceUnit: string;
    marketToKwhFactor: number;
    surchargeCt: number;
    vatPercent: number;
  };
  coverage: {
    hoursWithEnergy: number;
    hoursWithPrices: number;
    hoursUsed: number;
  };
  totals: {
    fixed: {
      importCost: number;
      exportRevenue: number;
      net: number;
    };
    dynamic: {
      importCost: number;
      exportRevenue: number;
      net: number;
    };
    delta: {
      net: number; // dynamic - fixed
    };
  };
  seriesDaily: AwattarComparisonDaily[];
}

export interface SystemInfo {
  version: string;
  updateAvailable: boolean;
  latestVersion: string;
  releaseUrl?: string;
}

export type TimeRange = 'hour' | 'day' | 'week' | 'month' | 'year' | 'custom';

export interface EnergyStats {
  production: number;    // kWh
  consumption: number;   // kWh
  imported: number;      // kWh
  exported: number;      // kWh
  batteryCharged: number; // kWh
  batteryDischarged: number; // kWh
  autonomy: number;      // %
  selfConsumption: number; // %
  costSaved: number;     // Currency
  earnings: number;      // Currency
}

export interface InverterData {
  power: {
    pv: number;
    load: number;
    grid: number;
    battery: number;
  };
  battery: {
    soc: number;
    state: 'charging' | 'discharging' | 'idle';
  };
  energy: {
    today: {
      production: number;
      consumption: number;
    };
  };
  autonomy: number;      // Realtime %
  selfConsumption: number; // Realtime %
}

export type SimulationDataPoint = {
    t: number; // timestamp
    p: number; // pv power
    l: number; // load power
  s?: number | null; // battery SoC (%) if available
  // Optional measured flows (W averaged over the hour or Wh per hour)
  gi?: number | null; // grid import
  ge?: number | null; // grid export
  bc?: number | null; // battery charge (positive)
  bd?: number | null; // battery discharge (positive)
};

export interface HistoryData {
  chart: Array<{
    timestamp: string;
    production: number;
    consumption: number;
    soc: number;
    grid: number;   // Positive = Import, Negative = Export
    battery: number; // Positive = Discharging, Negative = Charging
    autonomy: number; // %
    selfConsumption: number; // %
    status: number; // 0=Offline, 1=Running, 2=Error, 3=Idle
  }>;
  stats: EnergyStats;
}

export interface RoiData {
  totalInvested: number;
  totalReturned: number;
  netValue: number;
  roiPercent: number;
  breakEvenDate: string | null; // ISO Date or null if calculated in past/infinite
  projectedBreakEvenCost?: number; // Total cost calculated at the future date
  expenses: Expense[];
}

export interface ForecastData {
  forecasts: Array<{
    period_end: string;
    pv_estimate: number; // kW
  }>;
}

export interface BatteryHealthData {
  dataPoints: Array<{
    date: string;
    efficiency: number; // % (Discharged / Charged)
    estimatedCapacity: number; // kWh
    chargeCycles: number; // Partial cycles approximated
  }>;
  averageEfficiency: number;
  latestCapacityEst: number;
  totalCycles: number;
}

export interface FroniusRealtimeResponse {
  Head: {
    Status: {
      Code: number;
      Reason?: string;
    };
  };
  Body: {
    Data: {
      Site: {
        P_Grid: number | null;
        P_Load: number | null;
        P_Akku: number | null;
        P_PV: number | null;
        rel_SelfConsumption: number | null;
        rel_Autonomy: number | null;
        E_Day?: number;
        E_Year?: number;
        E_Total?: number;
      };
      Inverters: {
        [key: string]: {
          SOC: number;
        }
      }
    }
  }
}
