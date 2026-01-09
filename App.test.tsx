
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from './App';
import * as api from './services/api';

// Mock das API-Modul
vi.mock('./services/api');

describe('SunFlow App Integration', () => {
  // Standard Mock-Daten für erfolgreiche Tests
  const mockConfigValid = { 
      inverterIp: '192.168.0.50', 
      currency: 'EUR', 
      systemStartDate: '2023-01-01',
      notifications: { enabled: false, triggers: {} }
  };

  const mockRealtimeData = {
      power: { pv: 2500, load: 500, grid: -2000, battery: 0 },
      battery: { soc: 85, state: 'idle' },
      energy: { today: { production: 15, consumption: 5 } },
      autonomy: 100,
      selfConsumption: 20
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default Mocks, damit nicht jeder Test alles neu definieren muss
    (api.getSystemInfo as any).mockResolvedValue({ version: '1.0.0', updateAvailable: false });
    (api.getHistory as any).mockResolvedValue({ chart: [], stats: { production: 0, consumption: 0, imported: 0, exported: 0, costSaved: 0, earnings: 0 } });
    (api.getRoiData as any).mockResolvedValue({ totalInvested: 0, roiPercent: 0 });
    (api.getForecast as any).mockResolvedValue({ forecasts: [] });
    // Standardmäßig Config laden
    (api.getConfig as any).mockResolvedValue(mockConfigValid);
    // Standardmäßig Daten laden
    (api.getRealtimeData as any).mockResolvedValue(mockRealtimeData);
  });

  it('zeigt initial den Ladebildschirm', () => {
    // Wir verzögern die Antwort künstlich, um den Loading State zu sehen
    (api.getConfig as any).mockReturnValue(new Promise(() => {})); 
    render(<App />);
    expect(screen.getByText(/Connecting to Fronius Inverter/i)).toBeInTheDocument();
  });

  it('zeigt den Onboarding-Screen, wenn keine Inverter-IP konfiguriert ist', async () => {
    // Scenario: Config ist leer oder hat keine IP
    (api.getConfig as any).mockResolvedValue({ inverterIp: '', currency: 'EUR' });

    render(<App />);

    // Warten bis Loading weg ist
    await waitFor(() => {
        expect(screen.queryByText(/Connecting/i)).not.toBeInTheDocument();
    });

    // Erwartung: Aufforderung zur Konfiguration
    expect(screen.getByText(/Please configure your Inverter IP/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Settings/i })).toBeInTheDocument();
  });

  it('lädt das Dashboard erfolgreich mit Daten', async () => {
    render(<App />);

    // Warten auf Dashboard
    await waitFor(() => {
        expect(screen.getByText(/SunFlow/i)).toBeInTheDocument();
    });

    // Prüfen ob Daten korrekt "durchgereicht" werden (Smoke Test für Rendering)
    // Wir suchen nach Textfragmenten, die nur auftauchen, wenn Dashboard rendert
    expect(screen.getByText(/Live Power Flow/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Settings/i)).toBeInTheDocument();
  });

  it('zeigt einen Fehlerstatus an, wenn die API fehlschlägt', async () => {
    // Scenario: Config da, aber Inverter nicht erreichbar
    (api.getConfig as any).mockResolvedValue(mockConfigValid);
    (api.getRealtimeData as any).mockRejectedValue(new Error("Network Error"));

    render(<App />);

    // Warten bis App "settled" ist
    await waitFor(() => {
        expect(screen.getByText(/System Offline/i)).toBeInTheDocument();
    });
    
    // Prüfen, ob der Fehler auch visuell dargestellt wird (Text aus App.tsx Error State)
    expect(screen.getByText(/Failed to connect to backend or inverter/i)).toBeInTheDocument();
  });

  it('öffnet das Settings-Modal beim Klick auf den Button', async () => {
    render(<App />);

    // Warten bis Dashboard da ist
    await waitFor(() => screen.getByTitle(/Settings/i));

    // Klick auf Settings
    const settingsBtn = screen.getByTitle(/Settings/i);
    fireEvent.click(settingsBtn);

    // Erwartung: Modal Title ist sichtbar
    await waitFor(() => {
        expect(screen.getByText(/System Settings/i)).toBeInTheDocument();
    });
    
    // Prüfen ob Tabs da sind (Indiz, dass Modal Content geladen wurde)
    expect(screen.getByText(/Notifications/i)).toBeInTheDocument();
  });
});
