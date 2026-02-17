
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BatteryWidget from '../components/BatteryWidget';
import React from 'react';

// Mock Lucide icons that are used
describe('BatteryWidget Component', () => {
    it('zeigt SOC korrekt an', () => {
        // Power=0 -> Idle
        render(<BatteryWidget soc={75} power={0} state="idle" capacity={10} />);
        expect(screen.getByText('75')).toBeInTheDocument();
    });

    it('zeigt Status Text an (Charging)', () => {
        // Power < -10 (Charging)
        render(<BatteryWidget soc={50} power={-500} state="charging" capacity={10} />);
        // Text might be dynamic or inside component, checking based on "Charging" text presence
        // If the component relies on prop purely it might be different, 
        // but reading code suggests it triggers on 'power' logic often.
        // If the component renders "Charging" explicitly, this passes.
        // Based on failure output "Charging" text was missing. 
        // Let's assume the text is derived from power. 
        // If it still fails, I'll rely on the snapshot or just generic check.
        // Wait, failure log showed "IDLE". With power=-500, it SHOULD be charging.
        expect(screen.getByText(/Charging/i)).toBeInTheDocument();
    });

    it('zeigt Status Text an (Discharging)', () => {
        // Power > 10 (Discharging)
        render(<BatteryWidget soc={50} power={500} state="discharging" capacity={10} />);
        expect(screen.getByText(/Discharging/i)).toBeInTheDocument();
    });

    it('reagiert auf leeren SOC', () => {
        render(<BatteryWidget soc={0} power={0} state="idle" capacity={10} />);
        expect(screen.getByText(/0/)).toBeInTheDocument();
    });

    it('berechnet Entladezeit mit Reserve-SOC', () => {
        render(<BatteryWidget soc={20} power={1000} state="discharging" capacity={10} reserveSocPct={10} />);
        expect(screen.getByText(/Empty in/i)).toBeInTheDocument();
        expect(screen.getByText('1h 0m')).toBeInTheDocument();
        expect(screen.getByText(/incl\. 10% reserve/i)).toBeInTheDocument();
    });

    it('zeigt Temperaturwerte an, wenn verfügbar', () => {
        render(
            <BatteryWidget
                soc={55}
                power={0}
                state="idle"
                capacity={10}
                temperatures={{ battery: 28.4 }}
            />
        );

        expect(screen.getByText(/Battery:/i)).toBeInTheDocument();
        expect(screen.getByText('28.4°C')).toBeInTheDocument();
        expect(screen.queryByText(/Inverter:/i)).not.toBeInTheDocument();
    });

    it('zeigt Hinweis, wenn keine Batterietemperatur verfügbar ist', () => {
        render(
            <BatteryWidget
                soc={55}
                power={0}
                state="idle"
                capacity={10}
                temperatures={{ battery: null }}
            />
        );

        expect(screen.getByText(/Battery temperature unavailable/i)).toBeInTheDocument();
    });
});
