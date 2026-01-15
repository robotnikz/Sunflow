
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsModal from '../components/SettingsModal';
import { SystemConfig } from '../types';
import * as api from '../services/api';

// Mock API calls inside modal
vi.mock('../services/api');

describe('SettingsModal Interaction', () => {
  const mockConfig: SystemConfig = {
    inverterIp: '1.2.3.4',
    currency: 'EUR',
    systemStartDate: '2023-01-01',
    notifications: { 
        enabled: true, // Enabled for this test to access triggers
        discordWebhook: 'https://discord.com', 
        triggers: { errors: true, batteryFull: false, batteryEmpty: false, batteryHealth: false, smartAdvice: false }, 
        smartAdviceCooldownMinutes: 60,
        sohThreshold: 75,
        minCyclesForSoh: 50
    }
  };

  const onSaveMock = vi.fn();
  const onCloseMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getTariffs as any).mockResolvedValue([]);
    (api.getExpenses as any).mockResolvedValue([]);
  });

  it('lädt mit korrekten Initialwerten', async () => {
    render(<SettingsModal currentConfig={mockConfig} onSave={onSaveMock} onClose={onCloseMock} />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('1.2.3.4')).toBeInTheDocument();
    });
    expect(screen.getByText(/Notifications/i)).toBeInTheDocument();
  });

  it('wechselt Tabs korrekt', async () => {
    render(<SettingsModal currentConfig={mockConfig} onSave={onSaveMock} onClose={onCloseMock} />);
    const notifTab = screen.getByText(/Notifications/i);
    fireEvent.click(notifTab);
    await waitFor(() => {
        expect(screen.getByText(/Discord Integration/i)).toBeInTheDocument();
    });
  });

  it('ruft onSave mit aktualisierten Daten auf', async () => {
    render(<SettingsModal currentConfig={mockConfig} onSave={onSaveMock} onClose={onCloseMock} />);
    const ipInput = screen.getByDisplayValue('1.2.3.4');
    fireEvent.change(ipInput, { target: { value: '192.168.1.100' } });
    const saveBtn = screen.getByRole('button', { name: /Save Settings/i });
    fireEvent.click(saveBtn);
    await waitFor(() => {
        expect(onSaveMock).toHaveBeenCalledTimes(1);
    });
    expect(onSaveMock.mock.calls[0][0].inverterIp).toBe('192.168.1.100');
  });


  it('konfiguriert Battery Health Notification korrekt', async () => {
    render(<SettingsModal currentConfig={mockConfig} onSave={onSaveMock} onClose={onCloseMock} />);
    
    // 1. Zu Notifications wechseln
    fireEvent.click(screen.getByText(/Notifications/i));

    // 2. Checkbox für Battery Health finden und aktivieren
    const checkboxes = screen.getAllByRole('checkbox');
    // Die Battery Health Checkbox ist die 4. in der Liste (Errors, Full, Empty, Health, Smart)
    const healthCheckbox = checkboxes[3]; 
    
    fireEvent.click(healthCheckbox);

    // 3. Prüfen ob die Zusatzfelder erscheinen (Alert Threshold)
    await waitFor(() => {
        expect(screen.getByText(/Alert Threshold/i)).toBeInTheDocument();
    });

    // 4. Werte ändern
    const thresholdInput = screen.getByDisplayValue('75');
    fireEvent.change(thresholdInput, { target: { value: '80' } });

    // 5. Speichern
    fireEvent.click(screen.getByRole('button', { name: /Save Notifications/i }));

    // 6. Validierung
    expect(onSaveMock).toHaveBeenCalled();
    const savedConfig = onSaveMock.mock.calls[0][0];
    expect(savedConfig.notifications.triggers.batteryHealth).toBe(true);
    expect(savedConfig.notifications.sohThreshold).toBe(80);
  });

  it('zeigt Calibration Tab und berechnet Summen korrekt', async () => {
      // Config mit DB Totals
      const configWithDb = {
          ...mockConfig,
          initialValues: { production: 1000, import: 500, export: 200, financialReturn: 50 },
          dbTotals: { production: 5000, import: 200, export: 4000, financialReturn: 100 }
      };

      const { container } = render(<SettingsModal currentConfig={configWithDb} onSave={onSaveMock} onClose={onCloseMock} />);
      
      // Suche den Tab für History/Calibration. 
      // Der Text im Button ist "Calibration" (Zeile 413), nicht "History" (Icon)!
      const calibTab = screen.getAllByRole('button', { name: /Calibration/i })[0]; 
      fireEvent.click(calibTab);

      await waitFor(() => {
          expect(screen.getByText(/Pre-App History/i)).toBeInTheDocument();
      });

      // Prüfen ob Summen korrekt angezeigt werden (Initial + DB)
      // Production: 1000 + 5000 = 6,000
      // Note: Value is inside a div along with a span "kWh", so strict string match fails. Use Regex.
      // Locale might vary, so we match 6 followed by any separator and 000
      expect(screen.getByText(/6[,.\s]?000/)).toBeInTheDocument();
      
      // Eingabewert ändern (Manual Offset)
      const prodInputs = container.querySelectorAll('input[type="number"]');
      // Es gibt viele Inputs, wir suchen den für Production Offset (Value = 1000)
      const offsetInput = Array.from(prodInputs).find(i => (i as HTMLInputElement).value === '1000');
      
      if(offsetInput) {
          fireEvent.change(offsetInput, { target: { value: '2000' } });
          fireEvent.click(screen.queryAllByRole('button', { name: /Save Calibration/i })[0]); // Manchmal mehrfach gematcht
          
          await waitFor(() => {
              expect(onSaveMock).toHaveBeenCalled();
          });
          
          // Check ob neuer Wert (2000) im Save-Call war
          expect(onSaveMock.mock.calls[0][0].initialValues.production).toBe(2000);
      } else {
          throw new Error("Offset Input not found");
      }
  });

  it('navigiert zum Import Tab', async () => {
      render(<SettingsModal currentConfig={mockConfig} onSave={onSaveMock} onClose={onCloseMock} />);
      const importTab = screen.getByRole('button', { name: /Data Import/i });
      fireEvent.click(importTab);
      
      await waitFor(() => {
          // Prüft ob CsvImporter gerendert wird (Key Text)
          expect(screen.getAllByText(/Click to upload/i).length).toBeGreaterThan(0);
      });
  });
});
