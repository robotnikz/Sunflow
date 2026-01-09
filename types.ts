
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
  appliances?: Appliance[]; // Custom list of user devices
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

export interface HistoryData {
  chart: Array<{
    timestamp: string;
    production: number;
    consumption: number;
    soc: number;
    grid: number;   // Positive = Import, Negative = Export
    autonomy: number; // %
    selfConsumption: number; // %
    status: number; // 0=Offline, 1=Running, 2=Error
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