export interface SystemConfig {
  inverterIp: string;
  costPerKwh: number;
  feedInTariff: number;
  currency: string;
}

// Data structure returned by our Backend API which aggregates Fronius data
export interface InverterData {
  power: {
    pv: number;      // Watts produced by Solar
    load: number;    // Watts consumed by House (always positive in this app)
    grid: number;    // Watts (+ = import, - = export)
    battery: number; // Watts (+ = charge, - = discharge)
  };
  battery: {
    soc: number;     // State of charge %
    state: 'charging' | 'discharging' | 'idle';
  };
  energy: {
    today: {
      production: number; // kWh
      consumption: number; // kWh
    };
  };
  history: Array<{
    timestamp: string;
    production: number;
    consumption: number;
    soc: number;
  }>;
}

// Simplified version of Fronius API JSON response for internal mapping
export interface FroniusRealtimeResponse {
  Body: {
    Data: {
      Site: {
        P_Grid: number | null;
        P_Load: number | null;
        P_Akku: number | null;
        P_PV: number | null;
        rel_SelfConsumption: number | null;
        rel_Autonomy: number | null;
      };
      Inverters: {
        [key: string]: {
          SOC: number;
        }
      }
    }
  }
}
