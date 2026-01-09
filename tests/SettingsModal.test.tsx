
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
    expect(screen.getByDisplayValue('1.2.3.4')).toBeInTheDocument();
    expect(screen.getByText(/Notifications/i)).toBeInTheDocument();
  });

  it('wechselt Tabs korrekt', async () => {
    render(<SettingsModal currentConfig={mockConfig} onSave={onSaveMock} onClose={onCloseMock} />);
    const notifTab = screen.getByText(/Notifications/i);
    fireEvent.click(notifTab);
    expect(screen.getByText(/Discord Integration/i)).toBeInTheDocument();
  });

  it('ruft onSave mit aktualisierten Daten auf', async () => {
    render(<SettingsModal currentConfig={mockConfig} onSave={onSaveMock} onClose={onCloseMock} />);
    const ipInput = screen.getByDisplayValue('1.2.3.4');
    fireEvent.change(ipInput, { target: { value: '192.168.1.100' } });
    const saveBtn = screen.getByRole('button', { name: /Save Settings/i });
    fireEvent.click(saveBtn);
    expect(onSaveMock).toHaveBeenCalledTimes(1);
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
});
