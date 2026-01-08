export interface Tariff {
  id?: number;
  validFrom: string; // ISO Date string (YYYY-MM-DD)
  costPerKwh: number;
  feedInTariff: number;
}

export interface SystemConfig {
  inverterIp: string;
  currency: string;
}

export type TimeRange = 'hour' | 'day' | 'week' | 'month' | 'year';

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
}

export interface HistoryData {
  chart: Array<{
    timestamp: string;
    production: number;
    consumption: number;
    soc: number;
    status: number; // 0=Offline, 1=Running, 2=Error
  }>;
  stats: EnergyStats;
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