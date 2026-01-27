
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ScenarioPlanner from '../components/ScenarioPlanner';
import * as api from '../services/api';
import React from 'react';

vi.mock('../services/api');

// Mock Recharts
vi.mock('recharts', async (importOriginal) => {
    const mod = await importOriginal<any>();
    return {
        ...mod,
        ResponsiveContainer: ({ children }: any) => <div style={{ width: 500, height: 300 }}>{children}</div>
    };
});

describe('ScenarioPlanner Component', () => {
    const mockConfig = { inverterIp: '1.2.3.4', currency: 'EUR', batteryCapacity: 10, systemCapacity: 5 };
    const mockSimData = [
        { t: 1672563600000, p: 1000, l: 500 },
        { t: 1672567200000, p: 2000, l: 600 }
    ];

    beforeEach(() => {
        window.localStorage.clear();
        (api.getSimulationData as any).mockResolvedValue([]);
        (api.getTariffs as any).mockResolvedValue([]);
    });

    it('öffnet Modal beim Klick auf den Trigger Button', async () => {
        render(<ScenarioPlanner config={mockConfig} />);
        
        // Button klicken, um Modal zu öffnen
        const trigger = screen.getByText(/Scenario Planner/i);
        fireEvent.click(trigger);
        
        expect(screen.getByText(/Upgrade Simulator/i)).toBeInTheDocument();
        
        // Warten bis der interne API Call durch ist, um "act" Warnung zu vermeiden
        await waitFor(() => expect(api.getSimulationData).toHaveBeenCalled());
    });

    it('lädt Daten beim Öffnen', async () => {
        (api.getSimulationData as any).mockResolvedValue(mockSimData);
        (api.getTariffs as any).mockResolvedValue([]);

        render(<ScenarioPlanner config={mockConfig} />);
        
        const trigger = screen.getByText(/Scenario Planner/i);
        fireEvent.click(trigger);

        expect(screen.getByText(/Loading historical data/i)).toBeInTheDocument();

        await waitFor(() => {
            expect(api.getSimulationData).toHaveBeenCalled();
        });

        // Warten bis Ladevorgang abgeschlossen ist, um "act" Warnung zu vermeiden
        await waitFor(() => {
            expect(screen.queryByText(/Loading historical data/i)).not.toBeInTheDocument();
        });
    });

    it('berechnet Szenario wenn Daten da sind', async () => {
        (api.getSimulationData as any).mockResolvedValue(mockSimData);
        (api.getTariffs as any).mockResolvedValue([]);

        render(<ScenarioPlanner config={mockConfig} />);
        fireEvent.click(screen.getByText(/Scenario Planner/i));

        await waitFor(() => {
            expect(screen.queryByText(/Loading historical data/i)).not.toBeInTheDocument();
        });
    });

    it('zeigt Focus Toggle und ROI-Horizont Input', async () => {
        // Provide a complete (hourly) day within the active timeframe so the simulator renders results.
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        dayStart.setDate(dayStart.getDate() - 1);
        const fullDayData = Array.from({ length: 24 }).map((_, i) => ({
            t: dayStart.getTime() + (i * 60 * 60 * 1000),
            p: 1000,
            l: 500,
        }));

        (api.getSimulationData as any).mockResolvedValue(fullDayData);
        (api.getTariffs as any).mockResolvedValue([]);

        render(<ScenarioPlanner config={mockConfig} />);
        fireEvent.click(screen.getByText(/Scenario Planner/i));

        await waitFor(() => {
            expect(screen.queryByText(/Loading historical data/i)).not.toBeInTheDocument();
        });

        expect(screen.getByText(/Recommendation focus/i)).toBeInTheDocument();
        const roiBtn = screen.getByRole('button', { name: /^ROI$/i });
        const autonomyBtn = screen.getByRole('button', { name: /^Autonomy$/i });
        expect(roiBtn).toBeInTheDocument();
        expect(autonomyBtn).toBeInTheDocument();

        const horizonInput = screen.getByLabelText(/ROI horizon/i) as HTMLInputElement;
        expect(horizonInput).toBeInTheDocument();
        expect(horizonInput.disabled).toBe(false);

        fireEvent.click(autonomyBtn);
        expect((screen.getByLabelText(/ROI horizon/i) as HTMLInputElement).disabled).toBe(true);
    });

    it('zeigt PV Suggestion bei ausreichenden Daten', async () => {
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        dayStart.setDate(dayStart.getDate() - 1);
        const fullDayData = Array.from({ length: 24 }).map((_, i) => ({
            t: dayStart.getTime() + (i * 60 * 60 * 1000),
            p: 1000,
            l: 500,
        }));

        (api.getSimulationData as any).mockResolvedValue(fullDayData);
        (api.getTariffs as any).mockResolvedValue([]);

        render(<ScenarioPlanner config={mockConfig} />);
        fireEvent.click(screen.getByText(/Scenario Planner/i));

        await waitFor(() => {
            expect(screen.queryByText(/Loading historical data/i)).not.toBeInTheDocument();
        });

        // PV suggestion is shown inside the Details panel.
        fireEvent.click(screen.getByText(/^Details$/i));
        expect(screen.getByText(/PV Suggestion/i)).toBeInTheDocument();
    });
});
