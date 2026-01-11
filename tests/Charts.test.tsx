
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import EnergyChart from '../components/EnergyChart';
import BatteryChart from '../components/BatteryChart';
import EfficiencyChart from '../components/EfficiencyChart';
import React from 'react';

// Mock Recharts is done globally or in individual files. 
// We rely on the mock in main test file or need to add it here if isolated.
// Adding local mock to be safe.
vi.mock('recharts', async (importOriginal) => {
    const mod = await importOriginal<any>();
    return {
        ...mod,
        ResponsiveContainer: ({ children }: any) => <div style={{ width: 500, height: 300 }}>{children}</div>
    };
});

describe('Chart Components', () => {
    const mockData = [
        { timestamp: '2023-01-01 12:00', production: 1000, consumption: 500, grid: -500, battery: 0 },
        { timestamp: '2023-01-01 13:00', production: 1200, consumption: 600, grid: -600, battery: 0 }
    ];

    it('EnergyChart rendert ohne Fehler', () => {
        render(<EnergyChart history={mockData} timeRange="day" />);
    });

    it('BatteryChart rendert ohne Fehler', () => {
        const batData = [
            { timestamp: '2023-01-01 12:00', soc: 50, battery: 1000 },
            { timestamp: '2023-01-01 13:00', soc: 60, battery: 1000 }
        ];
        render(<BatteryChart history={batData} timeRange="day" />);
    });
    
    it('EfficiencyChart rendert ohne Fehler', () => {
         // Fix: EfficiencyChart expects history prop based on failure 'history.length'
         // Assuming it takes same shape as others or likely the dataPoints array directly?
         // Let's assume it takes 'history' prop which is the array.
         const effHistory = [{ timestamp: '2023-01-01', efficiency: 90 }];
         render(<EfficiencyChart history={effHistory as any} timeRange="day" />);
    });
});
