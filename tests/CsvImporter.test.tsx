
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CsvImporter from '../components/CsvImporter';
import * as api from '../services/api';
import React from 'react';
import Papa from 'papaparse';

vi.mock('../services/api');

// Mock PapaParse
vi.mock('papaparse', () => ({
    default: {
        parse: vi.fn((file, config) => {
            // Simulate success
            if (config.complete) {
                config.complete({
                    data: [
                        ['timestamp', 'power'],
                        ['2023-01-01T10:00:00', '500']
                    ],
                    meta: { fields: ['timestamp', 'power'] }
                });
            }
        })
    }
}));

describe('CsvImporter Component', () => {
    
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('beginnt im Upload-Schritt', () => {
        render(<CsvImporter />);
        expect(screen.getByText(/Click to upload CSV/i)).toBeInTheDocument();
    });

    it('wechselt zu Step 2 (Mapping) nach Dateiwahl', async () => {
        const { container } = render(<CsvImporter />);
        
        // Mock API Response
        vi.mocked(api.previewCsv).mockResolvedValue({
            headers: ['timestamp', 'power'],
            preview: [['2023-01-01T10:00:00', '100']]
        });

        // Mock File with slice/text support
        const fileContent = 'timestamp,power\n2023-01-01,100';
        const file = new File([fileContent], 'test.csv', { type: 'text/csv' });
        
        // Workaround for JSDOM missing file.slice().text()
        Object.defineProperty(file, 'slice', {
            value: () => ({
                text: async () => fileContent
            }),
            writable: true
        });

        const input = container.querySelector('input[type="file"]');
        
        if (input) {
            // Simuliere Upload
            fireEvent.change(input, { target: { files: [file] } });
            
            // Warten auf API Call und State Change
            await waitFor(() => {
                // Check for UI element unique to Step 2 (Mapping)
                // Note: "Configure Column Mapping" text was removed/changed. 
                // We check for one of the label fields or the "File:" indicator.
                const step2Indicator = screen.queryByText(/Timestamp \(Required\)/i);
                if (!step2Indicator) throw new Error("Step 2 not reached");
                expect(step2Indicator).toBeInTheDocument();
            });
        }
    });

    it('führt Import aus wenn Mapping gesetzt ist', async () => {
        // Mock API Response
        vi.mocked(api.previewCsv).mockResolvedValue({
            headers: ['timestamp', 'power'],
            preview: [['2023-01-01T10:00:00', '100']]
        });
        
        // Setup
        const { container } = render(<CsvImporter onSuccess={vi.fn()} />);
        // Create file with content matching the mock
        const fileContent = 'timestamp,power\n2023-01-01T10:00:00,100';
        const file = new File([fileContent], 'test.csv', { type: 'text/csv' });
        
        // Mock slice
        Object.defineProperty(file, 'slice', {
            value: () => ({
                text: async () => fileContent
            }),
            writable: true
        });

        const input = container.querySelector('input[type="file"]');
        if(input) fireEvent.change(input, { target: { files: [file] } });
        
        await waitFor(() => {
            expect(screen.getByText(/Timestamp \(Required\)/i)).toBeInTheDocument();
        });

        // Mapping setzen (Select Timestamp)
        const selects = screen.getAllByRole('combobox');
        
        // Wir müssen sicherstellen, dass die Optionen auch geladen sind (aus Meta fields des Mocks)
        fireEvent.change(selects[0], { target: { value: 'timestamp' } }); 

        // Import Button klicken
        const importBtn = screen.getByRole('button', { name: /Start Import/i });
        fireEvent.click(importBtn);

        // API Call Check
        await waitFor(() => {
           expect(api.importCsv).toHaveBeenCalled();
        });
    });
});
