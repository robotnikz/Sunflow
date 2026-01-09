import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import * as api from '../services/api';

// 1. Wir mocken das ganze API-Modul, damit wir keine echten Netzwerk-Requests machen
vi.mock('../services/api');

describe('SunFlow App Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('zeigt den Ladebildschirm beim Start', async () => {
    // Wir lassen die Promises ungelöst oder lösen sie langsam auf,
    // um den initialen Zustand zu sehen
    (api.getConfig as any).mockResolvedValue({}); 
    (api.getSystemInfo as any).mockResolvedValue({});

    render(<App />);
    
    // Prüfen auf Text, der nur im Ladezustand da ist
    expect(await screen.findByText(/Connecting to Fronius Inverter/i)).toBeInTheDocument();
  });

  it('lädt das Dashboard, wenn Konfiguration vorhanden ist', async () => {
    // 2. Wir definieren Test-Daten, die die API zurückgeben soll
    const mockConfig = { 
        inverterIp: '192.168.0.50', 
        currency: 'EUR', 
        systemStartDate: '2023-01-01' 
    };

    const mockRealtimeData = {
        power: { pv: 2500, load: 500, grid: -2000, battery: 0 },
        battery: { soc: 85, state: 'idle' },
        energy: { today: { production: 15, consumption: 5 } },
        autonomy: 100,
        selfConsumption: 20
    };

    // 3. Mocks verbinden
    (api.getConfig as any).mockResolvedValue(mockConfig);
    (api.getSystemInfo as any).mockResolvedValue({ version: '1.0.0', updateAvailable: false });
    (api.getRealtimeData as any).mockResolvedValue(mockRealtimeData);
    
    // Leere Dummies für die Charts, damit nichts crasht
    (api.getHistory as any).mockResolvedValue({ chart: [], stats: { production: 0, consumption: 0, imported: 0, exported: 0, costSaved: 0, earnings: 0 } });
    (api.getRoiData as any).mockResolvedValue({ totalInvested: 0, roiPercent: 0 });
    (api.getForecast as any).mockResolvedValue({ forecasts: [] });

    render(<App />);

    // 4. Warten, bis der Titel "SunFlow" erscheint (Laden beendet)
    await waitFor(() => {
        expect(screen.getByText(/SunFlow/i)).toBeInTheDocument();
    });

    // Prüfen, ob der Settings-Button gerendert wurde (Teil des Dashboards)
    expect(screen.getByTitle(/Settings/i)).toBeInTheDocument();
  });
});