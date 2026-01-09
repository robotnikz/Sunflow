
import React from 'react';
import { Smartphone, Laptop, Tv, Gamepad2, Coffee, Utensils, Shirt, Car, Zap, ArrowUp, BatteryWarning, CloudSun, Sun } from 'lucide-react';
import { ForecastData } from '../types';

interface SmartRecommendationsProps {
  gridPower: number; // Positive = Import, Negative = Export
  soc: number;       // Battery State of Charge %
  pvPower: number;   // Current PV Production
  forecast: ForecastData | null;
  batteryCapacity: number; // kWh
}

const APPLIANCES = [
  // Small loads (Safe to run anytime there is surplus)
  { id: 'phone', name: 'Charge Phone', watts: 15, icon: Smartphone, color: 'text-blue-400', heavy: false },
  { id: 'laptop', name: 'Laptop', watts: 60, icon: Laptop, color: 'text-indigo-400', heavy: false },
  { id: 'tv', name: 'TV / OLED', watts: 150, icon: Tv, color: 'text-purple-400', heavy: false },
  
  // Heavy loads (Require battery buffer OR solid forecast)
  { id: 'pc', name: 'Gaming PC', watts: 400, icon: Gamepad2, color: 'text-pink-400', heavy: true },
  { id: 'coffee', name: 'Coffee Maker', watts: 1000, icon: Coffee, color: 'text-amber-700', heavy: true },
  { id: 'dishwasher', name: 'Dishwasher', watts: 1500, icon: Utensils, color: 'text-teal-400', heavy: true },
  { id: 'washing', name: 'Washing Machine', watts: 2000, icon: Shirt, color: 'text-cyan-400', heavy: true },
  { id: 'ev', name: 'Car (Min. Charge)', watts: 3700, icon: Car, color: 'text-emerald-400', heavy: true },
];

const SmartRecommendations: React.FC<SmartRecommendationsProps> = ({ gridPower, soc, pvPower, forecast, batteryCapacity }) => {
  // 1. Calculate available surplus (Grid Export)
  // We only count surplus if we are exporting (negative grid power)
  const surplus = gridPower < -10 ? Math.abs(gridPower) : 0;

  // 2. Intelligent Logic with Forecast
  const MIN_SOC_SAFE_BUFFER = 30; // 30% Hard limit without forecast
  
  // -- FORECAST CALCULATIONS --
  let next90MinAvg = 0;
  let forecastTotalRestOfDay = 0;
  
  if (forecast && forecast.forecasts) {
    const now = new Date();
    // Filter future entries
    const futureForecasts = forecast.forecasts.filter(f => new Date(f.period_end) > now);
    
    // Calculate Next 90 Mins (approx 3 x 30min slots or 6 x 15min slots depending on API)
    // Solcast usually gives 30min periods.
    let count90 = 0;
    let sum90 = 0;
    
    futureForecasts.forEach((f, index) => {
        // Convert kW to W
        const watts = f.pv_estimate * 1000;
        
        // Sum total energy (kW * 0.5h = kWh) - assuming 30 min slots for simplicity of Sum
        // Ideally we check period string, but for recommendation heuristic, simple sum is ok
        forecastTotalRestOfDay += (f.pv_estimate * 0.5); // kWh

        // For the next ~90 mins (first 3 entries approx)
        if (index < 3) {
            sum90 += watts;
            count90++;
        }
    });
    
    if (count90 > 0) next90MinAvg = sum90 / count90;
  }

  // Energy Analysis
  const energyNeededToFillBattery = batteryCapacity * ((100 - soc) / 100); // kWh
  const predictedExcessEnergy = Math.max(0, forecastTotalRestOfDay - energyNeededToFillBattery);
  
  // Can we be aggressive?
  // Yes, if predicted excess is comfortably higher than 0 (e.g. > 2kWh buffer)
  const isForecastAbundant = predictedExcessEnergy > 2.0;

  // Filter appliances based on Wattage AND Stability
  const available = APPLIANCES.filter(app => {
    // Basic Surplus Check: Do we have enough RIGHT NOW?
    const hasImmediateSurplus = app.watts <= surplus;

    // Advanced Check: Even if we don't have surplus NOW, does the forecast say 
    // "We have so much sun coming, you can run it now and battery will still fill"?
    // Logic: 
    // 1. Is the battery not critically low? (>15%)
    // 2. Is the forecast for the next 90 mins solid? (avg > appliance watt)
    // 3. Will the battery fill up anyway by end of day?
    const isForecastSafe = 
        soc > 15 && 
        next90MinAvg > (app.watts + 200) && // +200W buffer for base load
        isForecastAbundant;

    // Stability / Battery Check
    // If it's a heavy load, we usually want battery buffer > 30%
    // BUT if forecast is safe, we ignore the 30% rule.
    const isStable = !app.heavy || (soc >= MIN_SOC_SAFE_BUFFER) || isForecastSafe;
    
    // We recommend if:
    // (We have surplus AND it's stable) OR (We rely purely on forecast confidence)
    return (hasImmediateSurplus && isStable) || (isForecastSafe && !hasImmediateSurplus);
  });

  // Find something we *could* run if we had just a bit more power
  const nextUp = APPLIANCES.find(app => !available.includes(app) && app.watts > surplus && !app.heavy); 
  
  // Find blocked items (Enough power, but blocked by low battery AND bad forecast)
  const batteryBlocked = APPLIANCES.find(app => 
      app.heavy && 
      app.watts <= surplus && 
      soc < MIN_SOC_SAFE_BUFFER &&
      !isForecastAbundant // Only blocked if forecast is bad
  );

  // Sort available by wattage desc
  const topRecommendations = [...available].sort((a, b) => b.watts - a.watts).slice(0, 3);
  
  const hasForecastData = !!forecast;

  return (
    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl flex flex-col h-full relative overflow-hidden transition-all duration-500">
      
      {/* Background Effect */}
      <div className={`absolute top-0 right-0 w-32 h-32 rounded-full blur-[60px] pointer-events-none transition-colors duration-1000 ${
        surplus > 1000 ? 'bg-emerald-500/10' : 'bg-slate-500/5'
      }`}></div>

      <div className="flex justify-between items-start mb-4 relative z-10">
        <div>
           <h3 className="text-slate-400 text-sm font-medium flex items-center gap-2">
              <Zap size={16} className={surplus > 0 ? "text-yellow-400 fill-yellow-400" : "text-slate-500"} />
              Smart Usage
           </h3>
           <div className="mt-1 flex items-baseline gap-1">
              <span className={`text-2xl font-bold ${surplus > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                {Math.round(surplus)} W
              </span>
              <span className="text-xs text-slate-500 font-medium">Free Surplus</span>
           </div>
        </div>
        
        {/* Forecast / Stability Indicator */}
        <div className="flex flex-col items-end gap-1">
            {hasForecastData ? (
                 <div className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border ${
                    isForecastAbundant 
                    ? 'bg-blue-900/30 border-blue-700/50 text-blue-300' 
                    : 'bg-slate-700/30 border-slate-600 text-slate-400'
                 }`}>
                    <Sun size={10} />
                    <span>Next 90m: {Math.round(next90MinAvg)}W</span>
                </div>
            ) : (
                <div className="flex items-center gap-1 text-[10px] text-slate-500">
                    <span>No Forecast</span>
                </div>
            )}

            {surplus > 0 && soc < MIN_SOC_SAFE_BUFFER && !isForecastAbundant && (
                <div className="flex items-center gap-1 text-amber-400 text-xs font-bold bg-amber-900/30 px-2 py-1 rounded border border-amber-700/50">
                    <CloudSun size={12} />
                    <span>Buffer Low</span>
                </div>
            )}
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-3 relative z-10 min-h-[140px]">
        
        {/* STATE 1: No Surplus & No Forecast Safety */}
        {available.length === 0 ? (
             <div className="flex flex-col items-center justify-center flex-1 text-center opacity-60">
                <Zap size={32} className="text-slate-600 mb-2" />
                <p className="text-sm text-slate-400">No power available.</p>
                <p className="text-xs text-slate-600 mt-1">Wait for sun or reduce load.</p>
             </div>
        ) : (
            <>
                {/* STATE 2: Surplus exists, but Battery blocked heavy loads */}
                {topRecommendations.length === 0 && batteryBlocked ? (
                    <div className="flex flex-col items-center justify-center flex-1 text-center animate-pulse">
                         <div className="p-3 bg-amber-500/10 rounded-full mb-2">
                             <BatteryWarning size={24} className="text-amber-500" />
                         </div>
                         <p className="text-sm text-slate-300 font-medium">Charging Battery...</p>
                         <p className="text-xs text-slate-500 mt-1 max-w-[220px]">
                            Waiting for <strong>&gt;{MIN_SOC_SAFE_BUFFER}%</strong> buffer. Forecast too low to risk running {batteryBlocked.name}.
                         </p>
                    </div>
                ) : (
                    /* STATE 3: Recommendations Available (Either via Surplus OR Forecast) */
                    <div className="space-y-3">
                        {topRecommendations.map(app => {
                            // Visualize why it's recommended
                            // If we have surplus, standard bar.
                            // If it's recommended purely on forecast, show blue "Forecast" bar
                            const isForecastDriven = app.watts > surplus;
                            const usagePercent = Math.min(100, (app.watts / (isForecastDriven ? next90MinAvg : surplus)) * 100);

                            return (
                                <div key={app.id} className="group">
                                    <div className="flex justify-between items-center mb-1">
                                        <div className="flex items-center gap-2">
                                            <div className={`p-1.5 rounded-lg bg-slate-900/50 ${app.color}`}>
                                                <app.icon size={14} />
                                            </div>
                                            <span className="text-sm font-medium text-slate-200">{app.name}</span>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-xs font-bold text-slate-500 block">{app.watts} W</span>
                                            {isForecastDriven && (
                                                <span className="text-[10px] text-blue-400 font-medium block leading-none">Forecast OK</span>
                                            )}
                                        </div>
                                    </div>
                                    {/* Usage Bar */}
                                    <div className="w-full h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                                        <div 
                                            className={`h-full rounded-full ${
                                                isForecastDriven 
                                                ? 'bg-blue-500' // Blue for Forecast driven
                                                : usagePercent < 50 ? 'bg-emerald-500' : 'bg-yellow-500' // Green/Yellow for Surplus
                                            }`}
                                            style={{ width: `${usagePercent}%` }}
                                        ></div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* "Next Goal" indicator */}
                {nextUp && !batteryBlocked && available.length < 3 && (
                    <div className="mt-auto pt-3 border-t border-slate-700/50 flex items-center gap-2 opacity-70">
                         <div className="p-1 rounded-full bg-slate-700 text-slate-400">
                            <ArrowUp size={12} />
                         </div>
                         <div className="text-xs text-slate-400">
                            Need <strong>+{nextUp.watts - Math.round(surplus)} W</strong> for <span className="text-slate-300">{nextUp.name}</span>
                         </div>
                    </div>
                )}
            </>
        )}
      </div>
    </div>
  );
};

export default SmartRecommendations;
