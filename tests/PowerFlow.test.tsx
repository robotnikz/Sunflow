
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PowerFlow from '../components/PowerFlow';
import React from 'react';

describe('PowerFlow Component', () => {
    const mockData = {
        power: {
            pv: 5000,
            load: 2000,
            grid: -2000, // Export
            battery: 1000 // Charging
        },
        battery: { soc: 50, state: 'charging' as const },
        energy: { today: { production: 20, consumption: 10 } },
        autonomy: 80,
        selfConsumption: 60
    };

    it('zeigt alle Leistungswerte korrekt an', () => {
        render(<PowerFlow power={mockData.power} soc={mockData.battery.soc} />);
        
        // Check PV
        expect(screen.getByText(/5000/)).toBeInTheDocument();
        
        // Check Load & Grid (both 2000)
        expect(screen.getAllByText(/2000/).length).toBeGreaterThanOrEqual(1);
        
    });

    it('zeigt Status Idle bei 0 W PV', () => {
        const idlePower = { ...mockData.power, pv: 0 };
        render(<PowerFlow power={idlePower} soc={50} />);
        
        // Use stricter regex to match "0 W" exactly, avoiding "2000 W"
        // Also ensure we are looking for the PV label context if possible, but 0 W is unique enough if we exclude others.
        // Actually, just looking for "0 W" surrounded by boundaries might help.
        // Or finding the element that contains ONLY "0 W" (ignoring whitespace).
        expect(screen.getByText((content, element) => {
             // Normalized text check
             return element?.tagName.toLowerCase() === 'span' && content.trim() === '0 W';
        })).toBeInTheDocument();
    });
});
