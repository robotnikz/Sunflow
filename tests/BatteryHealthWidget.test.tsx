
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BatteryHealthWidget from '../components/BatteryHealthWidget';
import { BatteryHealthData } from '../types';
import React from 'react';

// Mock Recharts to avoid rendering complex SVG in tests
vi.mock('recharts', async () => {
    const Original = await vi.importActual('recharts');
    return {
        ...Original,
        ResponsiveContainer: ({ children }: any) => <div style={{ width: 500, height: 300 }}>{children}</div>,
        AreaChart: () => <div>Mocked Chart</div>, // Prevents rendering of SVG children
        Area: () => null,
        XAxis: () => null,
        YAxis: () => null,
        CartesianGrid: () => null,
        Tooltip: () => null,
        ReferenceLine: () => null
    };
});

describe('BatteryHealthWidget', () => {
  const nominalCapacity = 10; // 10 kWh

  it('zeigt "Not enough data" wenn keine Datenpunkte vorhanden sind', () => {
    render(<BatteryHealthWidget data={null} nominalCapacity={nominalCapacity} />);
    expect(screen.getByText(/Not enough data yet/i)).toBeInTheDocument();
  });

  it('zeigt Status "Excellent" bei hohem SOH (>90%)', () => {
    const mockData: BatteryHealthData = {
        dataPoints: [{ date: '2023-01-01', efficiency: 95, estimatedCapacity: 9.8, chargeCycles: 1 }],
        averageEfficiency: 95,
        latestCapacityEst: 9.8, // 98% SOH
        totalCycles: 10
    };
    render(<BatteryHealthWidget data={mockData} nominalCapacity={nominalCapacity} />);
    
    expect(screen.getByText('Excellent')).toBeInTheDocument();
    expect(screen.getByText('9.8')).toBeInTheDocument(); // Capacity Display
  });

  it('zeigt Status "Degrading" bei mittlerem SOH (<80%)', () => {
    const mockData: BatteryHealthData = {
        dataPoints: [{ date: '2023-01-01', efficiency: 90, estimatedCapacity: 7.5, chargeCycles: 1 }],
        averageEfficiency: 90,
        latestCapacityEst: 7.5, // 75% SOH
        totalCycles: 500
    };
    render(<BatteryHealthWidget data={mockData} nominalCapacity={nominalCapacity} />);
    
    expect(screen.getByText('Degrading')).toBeInTheDocument();
  });

  it('zeigt Status "Poor" bei kritischem SOH (<70%)', () => {
    const mockData: BatteryHealthData = {
        dataPoints: [{ date: '2023-01-01', efficiency: 80, estimatedCapacity: 6.0, chargeCycles: 1 }],
        averageEfficiency: 80,
        latestCapacityEst: 6.0, // 60% SOH
        totalCycles: 1000
    };
    render(<BatteryHealthWidget data={mockData} nominalCapacity={nominalCapacity} />);
    
    expect(screen.getByText('Poor')).toBeInTheDocument();
  });
});
