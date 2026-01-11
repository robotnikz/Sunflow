
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AmortizationWidget from '../components/AmortizationWidget';
import React from 'react';

describe('AmortizationWidget Component', () => {
    it('zeigt Platzhalter bei fehlenden Daten', () => {
        render(<AmortizationWidget roiData={null} currency="EUR" />);
        expect(screen.getByText(/Amortization Tracker/i)).toBeInTheDocument();
        expect(screen.getByText(/Configure your system/i)).toBeInTheDocument();
    });

    it('zeigt ROI Daten korrekt an', () => {
        const mockRoi = {
            totalInvested: 10000,
            totalReturned: 2500,
            netValue: -7500,
            roiPercent: 25,
            breakEvenDate: '2030-01-01',
            expenses: []
        };

        render(<AmortizationWidget roiData={mockRoi} currency="EUR" />);
        
        expect(screen.getByText(/25/)).toBeInTheDocument(); // ROI Percent
        expect(screen.getByText(/10[.,]000/)).toBeInTheDocument(); // Invested
    });

    it('zeigt "Paid Off" Status an', () => {
        const mockRoi = {
            totalInvested: 10000,
            totalReturned: 12000,
            netValue: 2000,
            roiPercent: 120,
            breakEvenDate: '2025-01-01',
            expenses: []
        };

        render(<AmortizationWidget roiData={mockRoi} currency="EUR" />);
        expect(screen.getByText(/Paid Off/i)).toBeInTheDocument();
    });
});
