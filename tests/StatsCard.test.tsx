
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatsCard from '../components/StatsCard';
import { Zap } from 'lucide-react';
import React from 'react';

describe('StatsCard Component', () => {
    it('rendert Titel und Wert korrekt', () => {
        render(
            <StatsCard 
                title="Produktion" 
                value="5.0 kWh" 
                icon={<Zap size={16} />} 
                valueColor="text-yellow-400" 
            />
        );

        expect(screen.getByText('Produktion')).toBeInTheDocument();
        expect(screen.getByText('5.0 kWh')).toBeInTheDocument();
    });

    it('zeigt Subtext an wenn vorhanden', () => {
        render(
            <StatsCard 
                title="Test" 
                value="100" 
                icon={<Zap size={16} />} 
                subValue="Details hier"
            />
        );
        expect(screen.getByText('Details hier')).toBeInTheDocument();
    });
});
