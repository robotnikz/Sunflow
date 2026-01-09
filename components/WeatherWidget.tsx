
import React from 'react';
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Loader2, Sun, MapPinOff, SunMedium, AlertOctagon, Settings2 } from 'lucide-react';
import { SystemConfig, ForecastData } from '../types';
import { WeatherData } from './Dashboard';

interface WeatherWidgetProps {
  config: SystemConfig;
  forecast: ForecastData | null;
  weatherData: WeatherData | null;
  solcastRateLimited: boolean;
}

const WeatherWidget: React.FC<WeatherWidgetProps> = ({ config, forecast, weatherData, solcastRateLimited }) => {

  // Calculate Total Daily Yield
  // STRICT LOGIC: If Solcast Key -> Use Solcast. Else -> OpenMeteo is NOT used for yield.
  let displayYield = 0;
  const hasSolcastKey = !!config.solcastApiKey;

  if (hasSolcastKey) {
      // SOLCAST MODE (Yellow)
      if (forecast && forecast.forecasts && forecast.forecasts.length > 0) {
          const now = new Date();
          const todaysKwh = forecast.forecasts.reduce((sum, entry) => {
              const entryDate = new Date(entry.period_end);
              if (entryDate.getDate() === now.getDate()) {
                  return sum + (entry.pv_estimate * 0.5);
              }
              return sum;
          }, 0);
          displayYield = todaysKwh;
      }
      // If no data (e.g. rate limit w/o cache), yield remains 0. UI shows warning.
  }

  if (!config.latitude || !config.longitude) {
    return (
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl flex flex-col items-center justify-center text-center h-full min-h-[220px]">
            <MapPinOff className="text-slate-500 mb-2" size={32}/>
            <p className="text-slate-400 text-sm">Add location in settings to see Weather & Solar Forecast.</p>
        </div>
    );
  }

  // WMO Weather Code Mapping (Visual only, always from OpenMeteo)
  const getWeatherIcon = (code: number) => {
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
       {/* Background gradient */}
       <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 blur-[50px] rounded-full pointer-events-none"></div>

       <div className="flex justify-between items-start relative z-10">
          <div>
             <h3 className="text-slate-400 text-sm font-medium">Local Weather</h3>
             {weatherData && (
                 <div className="mt-1 text-slate-500 text-xs">{getWeatherLabel(weatherData.current.weatherCode)}</div>
             )}
          </div>
          {weatherData ? (
             <div className="text-right">
                <div className="text-2xl font-bold text-slate-200">{weatherData.current.temp}°C</div>
             </div>
          ) : (
             <div className="flex items-center gap-2 text-slate-500 text-xs">
                 <Loader2 className="animate-spin" size={14} /> Loading...
             </div>
          )}
       </div>

       <div className="flex items-center justify-center my-2 relative z-10">
          {weatherData ? getWeatherIcon(weatherData.current.weatherCode) : <Cloud className="text-slate-600" size={48} />}
       </div>

       <div className={`mt-2 bg-slate-900/50 rounded-xl p-3 border relative z-10 ${hasSolcastKey ? 'border-yellow-500/20 bg-yellow-900/10' : 'border-slate-700/50'}`}>
          <div className="flex justify-between items-center mb-1">
             <span className="text-xs text-slate-500 uppercase font-bold">Total Forecast Today</span>
             {hasSolcastKey ? (
                 <div className="flex items-center gap-1">
                     {solcastRateLimited && (
                         <span title="Solcast Limit Reached">
                            <AlertOctagon size={12} className="text-red-500 animate-pulse" />
                         </span>
                     )}
                     <span className="text-[10px] text-yellow-500 flex items-center gap-1"><SunMedium size={10}/> Solcast</span>
                 </div>
             ) : (
                 // No key = No forecast provider active
                 <span className="text-[10px] text-slate-500 flex items-center gap-1">No Provider</span>
             )}
          </div>
          
          {hasSolcastKey ? (
             (weatherData || (forecast && forecast.forecasts)) ? (
                <div className="flex items-baseline gap-1">
                    <span className="text-xl font-bold text-yellow-400">~{Math.round(displayYield)}</span>
                    <span className="text-sm text-slate-400">kWh</span>
                </div>
             ) : (
                 <div className="text-xs text-slate-500 italic">
                    Loading...
                 </div>
             )
          ) : (
             <div className="flex items-center gap-2 text-xs text-slate-400">
                <Settings2 size={14} />
                <span>Configure Solcast</span>
             </div>
          )}
       </div>
    </div>
  );
};

export default WeatherWidget;
