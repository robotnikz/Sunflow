import React, { useEffect, useState } from 'react';
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Loader2, Sun, MapPinOff } from 'lucide-react';
import { SystemConfig } from '../types';

interface WeatherWidgetProps {
  config: SystemConfig;
}

interface WeatherData {
  current: {
    temp: number;
    weatherCode: number;
  };
  forecast: {
    todayYield: number; // kWh
  };
}

const WeatherWidget: React.FC<WeatherWidgetProps> = ({ config }) => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config.latitude || !config.longitude) return;

    const fetchWeather = async () => {
      setLoading(true);
      try {
        const lat = config.latitude;
        const lon = config.longitude;
        // Open-Meteo API (Free for non-commercial use)
        // Fetch current weather + Daily Shortwave Radiation Sum (MJ/m²)
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&daily=weather_code,shortwave_radiation_sum&timezone=auto&forecast_days=1`;
        
        const res = await fetch(url);
        if (!res.ok) throw new Error("Weather API failed");
        
        const data = await res.json();
        
        // Calculate Yield Forecast
        // Formula: Energy (kWh) = Area * Radiation (kWh/m2) * Efficiency
        // Simpler with System Capacity: Energy = Capacity(kWp) * (Radiation / 1kW/m2 standard) * PR (0.75-0.85)
        // Shortwave Radiation is in MJ/m². 1 kWh = 3.6 MJ.
        // So Radiation (kWh/m²) = MJ / 3.6
        
        const radiationMJ = data.daily.shortwave_radiation_sum[0];
        const radiationKWh = radiationMJ / 3.6;
        const capacity = config.systemCapacity || 0; // kWp
        
        // Performance Ratio (PR) typically ~0.8 to 0.85 for new systems
        const pr = 0.85; 
        
        // Estimated Yield = Capacity * (Radiation / 1) * PR ?? 
        // Actually, 1kWp system produces roughly 'Radiation(kWh/m2)' * Efficiency factor?
        // Standard Test Conditions: 1kW/m2.
        // So if Radiation is 5 kWh/m2, a 1kWp system produces ~4-5 kWh.
        
        const estimatedYield = capacity * radiationKWh * pr;

        setWeather({
            current: {
                temp: data.current.temperature_2m,
                weatherCode: data.current.weather_code
            },
            forecast: {
                todayYield: estimatedYield
            }
        });
        setError(null);
      } catch (err) {
        console.error(err);
        setError("Failed to load weather");
      } finally {
        setLoading(false);
      }
    };

    fetchWeather();
    // Refresh every 30 mins
    const interval = setInterval(fetchWeather, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [config.latitude, config.longitude, config.systemCapacity]);

  if (!config.latitude || !config.longitude) {
    return (
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl flex flex-col items-center justify-center text-center h-full min-h-[220px]">
            <MapPinOff className="text-slate-500 mb-2" size={32}/>
            <p className="text-slate-400 text-sm">Add location in settings to see Weather & Solar Forecast.</p>
        </div>
    );
  }

  // WMO Weather Code Mapping
  const getWeatherIcon = (code: number) => {
    // 0 Clear
    // 1-3 Cloudy
    // 45,48 Fog
    // 51,53,55 Drizzle
    // 61,63,65 Rain
    // 71,73,75 Snow
    // 95,96,99 Thunderstorm
    if (code === 0) return <Sun className="text-yellow-400" size={48} />;
    if (code <= 3) return <CloudSun className="text-blue-200" size={48} />;
    if (code <= 48) return <CloudFog className="text-slate-400" size={48} />;
    if (code <= 57) return <CloudRain className="text-blue-400" size={48} />;
    if (code <= 67) return <CloudRain className="text-blue-500" size={48} />;
    if (code <= 77) return <CloudSnow className="text-white" size={48} />;
    return <CloudLightning className="text-purple-400" size={48} />;
  };

  const getWeatherLabel = (code: number) => {
    if (code === 0) return "Sunny";
    if (code <= 3) return "Partly Cloudy";
    if (code <= 48) return "Foggy";
    if (code <= 67) return "Rainy";
    if (code <= 77) return "Snowy";
    return "Stormy";
  };

  return (
    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl relative overflow-hidden h-full flex flex-col justify-between">
       {/* Background gradient based on weather? Keep it simple dark for now */}
       <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 blur-[50px] rounded-full pointer-events-none"></div>

       <div className="flex justify-between items-start relative z-10">
          <div>
             <h3 className="text-slate-400 text-sm font-medium">Local Weather</h3>
             {weather && (
                 <div className="mt-1 text-slate-500 text-xs">{getWeatherLabel(weather.current.weatherCode)}</div>
             )}
          </div>
          {loading ? (
             <Loader2 className="animate-spin text-slate-500" size={24} />
          ) : weather ? (
             <div className="text-right">
                <div className="text-2xl font-bold text-slate-200">{weather.current.temp}°C</div>
             </div>
          ) : (
             <div className="text-red-400 text-xs">{error}</div>
          )}
       </div>

       <div className="flex items-center justify-center my-2 relative z-10">
          {weather ? getWeatherIcon(weather.current.weatherCode) : <Cloud className="text-slate-600" size={48} />}
       </div>

       <div className="mt-2 bg-slate-900/50 rounded-xl p-3 border border-slate-700/50 relative z-10">
          <div className="text-xs text-slate-500 uppercase font-bold mb-1">Forecast Today</div>
          {weather && config.systemCapacity ? (
            <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-yellow-400">~{Math.round(weather.forecast.todayYield)}</span>
                <span className="text-sm text-slate-400">kWh</span>
            </div>
          ) : (
             <div className="text-xs text-slate-500 italic">
                {config.systemCapacity ? "Loading..." : "Set System kWp"}
             </div>
          )}
       </div>
    </div>
  );
};

export default WeatherWidget;