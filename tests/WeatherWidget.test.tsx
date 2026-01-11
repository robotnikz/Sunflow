
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import WeatherWidget from '../components/WeatherWidget';
import React from 'react';

describe('WeatherWidget Component', () => {
    it('zeigt Placeholder wenn keine Daten vorhanden', () => {
        const mockConfig = { inverterIp: '1.2.3', currency: 'EUR' }; // Min config
        const { getByText } = render(<WeatherWidget config={mockConfig} forecast={null} weatherData={null} solcastRateLimited={false} />);
        expect(getByText(/Add location in settings/i)).toBeInTheDocument();
    });

    it('zeigt Temperatur und Wetter Code an', () => {
        const mockConfig = { inverterIp: '1.2.3', currency: 'EUR', latitude: '50', longitude: '10' };
        const mockWeather = {
            current: {
                temp: 22.5,
                weatherCode: 0, // Clear sky
                isDay: true
            }
        };

        render(<WeatherWidget config={mockConfig} forecast={null} weatherData={mockWeather} solcastRateLimited={false}/>);
        expect(screen.getByText(/22.5°C/)).toBeInTheDocument();
    });
    
    it('zeigt Nacht-Modus an', () => {
        const mockConfig = { inverterIp: '1.2.3', currency: 'EUR', latitude: '50', longitude: '10' };
        const mockWeather = {
            current: {
                temp: 15,
                weatherCode: 1, 
                isDay: false
            }
        };
        render(<WeatherWidget config={mockConfig} forecast={null} weatherData={mockWeather} solcastRateLimited={false}/>);
        expect(screen.getByText(/15°C/)).toBeInTheDocument();
    });
});
