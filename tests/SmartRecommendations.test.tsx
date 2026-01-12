
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SmartRecommendations from '../components/SmartRecommendations';
import { Appliance } from '../types';

describe('SmartRecommendations Logic', () => {
  // Freeze time to avoid flakiness around midnight in CI (forecast logic is "remaining today").
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mockAppliances: Appliance[] = [
    { id: 'washing', name: 'Washing Machine', watts: 2000, kwhEstimate: 1.0, iconName: 'shirt', color: 'text-blue-400' },
    { id: 'phone', name: 'Phone Charger', watts: 15, kwhEstimate: 0.02, iconName: 'smartphone', color: 'text-gray-400' }
  ];

  // Base props helper
  const defaultProps = {
    forecast: null,
    solcastRateLimited: false,
    todayProduction: 10,
    isDay: true,
    batteryCapacity: 10,
    appliances: mockAppliances,
    hasSolcastKey: false
  };

  it('empfiehlt Gerät NICHT, wenn kein Überschuss da ist', () => {
    render(<SmartRecommendations 
        {...defaultProps}
        power={{ grid: 500, battery: 0, pv: 500, load: 1000 }} // Grid Import (Positive)
        soc={50}
    />);
    
    expect(screen.getByText(/No surplus available/i)).toBeInTheDocument();
    expect(screen.queryByText('Washing Machine')).not.toBeInTheDocument();
  });

  it('empfiehlt Gerät, wenn genug Grid Export vorhanden ist', () => {
    render(<SmartRecommendations 
        {...defaultProps}
        power={{ grid: -2500, battery: 0, pv: 3000, load: 500 }} // 2500W Export
        soc={80} // Batterie fast voll
    />);
    
    // Header sollte "Smart Usage" zeigen
    expect(screen.getByText(/Smart Usage/i)).toBeInTheDocument();
    // Waschmaschine (2000W) passt in 2500W Export
    expect(screen.getByText('Washing Machine')).toBeInTheDocument();
  });

  it('blockiert Empfehlung im "Battery Priority" Modus (SOC niedrig, kein Forecast)', () => {
    render(<SmartRecommendations 
        {...defaultProps}
        power={{ grid: -2500, battery: 0, pv: 3000, load: 500 }} 
        soc={20} // Batterie leer!
        // hasSolcastKey=false triggert Fallback-Logik
    />);

    // Sollte nicht empfohlen werden, da SOC < 80% (Fallback Logic) und kein Forecast Key
    // Die Logic besagt: if !hasAnyForecastData -> if soc > 80 allow divert.
    expect(screen.queryByText('Washing Machine')).not.toBeInTheDocument();
    expect(screen.getByText(/Battery Priority/i)).toBeInTheDocument();
  });

  it('erlaubt Empfehlung bei niedrigem SOC, WENN Forecast extrem positiv ist', () => {
    render(<SmartRecommendations 
        {...defaultProps}
        hasSolcastKey={true}
        forecast={{ forecasts: [{ period_end: new Date(Date.now() + 3600000).toISOString(), pv_estimate: 50 }] }} // Riesiger Forecast
        power={{ grid: -2500, battery: 0, pv: 3000, load: 500 }}
        soc={20} 
    />);

    // Hier greift die Logik: forecastRemainingKwh > kwhToFill
    // 50 kW Forecast >> 8 kWh needed to fill. => Safe.
    expect(screen.getByText('Washing Machine')).toBeInTheDocument();
    expect(screen.getByText(/Battery Safe/i)).toBeInTheDocument();
  });
});
