
import React from 'react';
import { Smartphone, Laptop, Tv, Gamepad2, Coffee, Utensils, Shirt, Car, Zap, ArrowUp, BatteryWarning, SunMedium, Battery, CheckCircle2, Hourglass, Leaf, Wind, Monitor, Lightbulb, Speaker, Refrigerator, Fan } from 'lucide-react';
import { ForecastData, Appliance } from '../types';

interface SmartRecommendationsProps {
  power: {
      grid: number; // Positive = Import, Negative = Export
      battery: number; // Positive = Discharging, Negative = Charging
      pv: number;
      load: number;
  };
  soc: number;       // Battery State of Charge %
  forecast: ForecastData | null;
  todayProduction: number; // kWh
  fallbackDailyYield?: number; // kWh (From Open-Meteo)
  batteryCapacity: number; // kWh
  appliances: Appliance[]; // User configured appliances
}

// Icon Mapping for dynamic loading
export const ICON_MAP: Record<string, any> = {
    'smartphone': Smartphone,
    'laptop': Laptop,
    'tv': Tv,
    'gamepad': Gamepad2,
    'coffee': Coffee,
    'utensils': Utensils,
    'shirt': Shirt,
    'wind': Wind,
    'car': Car,
    'monitor': Monitor,
    'lightbulb': Lightbulb,
    'speaker': Speaker,
    'refrigerator': Refrigerator,
    'fan': Fan,
    'zap': Zap
};

const SmartRecommendations: React.FC<SmartRecommendationsProps> = ({ power, soc, forecast, todayProduction, fallbackDailyYield, batteryCapacity, appliances }) => {
  const deviceList = appliances || [];

  // --- REALTIME DATA ---
  const gridExport = power.grid < -10 ? Math.abs(power.grid) : 0;
  const batteryCharging = power.battery < -10 ? Math.abs(power.battery) : 0;
  
  // --- FORECAST & BATTERY STRATEGY ---
  let forecastRemainingKwh = 0;
  let usingFallback = false;
  
  if (forecast && forecast.forecasts) {
      // 1. Primary Strategy: Solcast High-Res Forecast
      const now = new Date();
      const remainingSlots = forecast.forecasts.filter(f => {
          const d = new Date(f.period_end);
          return d > now && d.getDate() === now.getDate();
      });
      // Solcast periods are 30 mins (0.5h). Energy (kWh) = Power(kW) * 0.5
      forecastRemainingKwh = remainingSlots.reduce((sum, f) => sum + (f.pv_estimate * 0.5), 0);
  } else if (fallbackDailyYield !== undefined) {
      // 2. Fallback Strategy: Open-Meteo Daily Total
      // We know Total Estimate and Actual Produced. Difference is roughly what's left.
      // We clamp it to 0 because actual can exceed forecast.
      usingFallback = true;
      forecastRemainingKwh = Math.max(0, fallbackDailyYield - todayProduction);
  }

  const hasAnyForecastData = (!!forecast && !!forecast.forecasts) || (fallbackDailyYield !== undefined);

  // Calculate Energy needed to fill battery
  const socMissing = Math.max(0, 100 - soc);
  const kwhToFill = (socMissing / 100) * batteryCapacity;

  // SAFETY BUFFER calculation
  // How much specific "Solar Energy" is left AFTER we assume the battery gets full?
  // We subtract 10% buffer for base load/fluctuations.
  const energyBufferKwh = forecastRemainingKwh - (kwhToFill * 1.1);

  // STRATEGY DECISION
  // Can we divert battery charging power?
  // YES if: 
  // 1. We have a positive Energy Buffer (Forecast > Battery Need)
  // OR 
  // 2. Battery is already nearly full (>95%)
  // OR
  // 3. No forecast data at all? (Fallback below handles strict mode)
  const isBatterySafe = (energyBufferKwh > 0) || soc > 95;
  
  // Available Power Logic
  let totalAvailablePower = 0;
  let divertableAmount = 0;

  if (isBatterySafe) {
      // Strategy: OPTIMIZE SELF-CONSUMPTION
      // We can use Grid Export + Current Battery Charging power
      divertableAmount = batteryCharging;
      totalAvailablePower = gridExport + divertableAmount;
  } else {
      // Strategy: PRIORITY CHARGING
      // We only use Grid Export. We DO NOT steal from battery charging.
      divertableAmount = 0;
      totalAvailablePower = gridExport;
  }

  // Fallback if strictly NO data at all (neither solcast nor open-meteo)
  if (!hasAnyForecastData) {
      if (soc > 80) { // Much stricter without forecast
          divertableAmount = batteryCharging;
          totalAvailablePower = gridExport + batteryCharging;
      } else {
          totalAvailablePower = gridExport;
      }
  }

  // Safety Margin (Watts) to prevent constant flipping
  const SAFETY_MARGIN = 100;
  const usablePower = Math.max(0, totalAvailablePower - SAFETY_MARGIN);

  // --- FILTER APPLIANCES ---
  const available = deviceList.filter(app => {
      // Check 1: Do we have enough POWER (Watts) right now?
      const hasPower = app.watts <= usablePower;

      // Check 2: Do we have enough ENERGY (kWh) budget for the day?
      const isGridOnly = app.watts <= gridExport;
      
      // If we need to dip into the battery charging flow (Divert), check the kWh budget
      let hasEnergyBudget = true;
      if (!isGridOnly && hasAnyForecastData) {
          // If we run this, does it eat up the buffer needed for the battery?
          hasEnergyBudget = app.kwhEstimate <= energyBufferKwh || soc > 95;
      }

      return hasPower && hasEnergyBudget;
  });

  // Find "Blocked by Energy Budget" items 
  const energyBlocked = deviceList.find(app => 
      !available.includes(app) && 
      app.watts <= usablePower &&
      hasAnyForecastData && 
      app.kwhEstimate > energyBufferKwh
  );

  // Find "Blocked by Power Priority" items
  const batteryBlocked = deviceList.find(app => 
      !available.includes(app) && 
      !energyBlocked &&
      app.watts <= (gridExport + batteryCharging) &&
      !isBatterySafe
  );

  const nextUp = deviceList.find(app => !available.includes(app) && !batteryBlocked && !energyBlocked && app.watts > usablePower); 
  const topRecommendations = [...available].sort((a, b) => b.watts - a.watts).slice(0, 3);
  
  return (
    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl flex flex-col h-full relative overflow-hidden transition-all duration-500">
      
      {/* Background Effect */}
      <div className={`absolute top-0 right-0 w-32 h-32 rounded-full blur-[60px] pointer-events-none transition-colors duration-1000 ${
        totalAvailablePower > 1000 ? 'bg-emerald-500/10' : 'bg-slate-500/5'
      }`}></div>

      <div className="flex justify-between items-start mb-2 relative z-10">
        <div>
           <h3 className="text-slate-400 text-sm font-medium flex items-center gap-2">
              <Zap size={16} className={totalAvailablePower > 0 ? "text-yellow-400 fill-yellow-400" : "text-slate-500"} />
              Smart Usage
           </h3>
           <div className="mt-1 flex flex-col">
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${totalAvailablePower > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {Math.round(totalAvailablePower)} W
                </span>
                <span className="text-xs text-slate-500 font-medium">Free</span>
              </div>
              
              {/* Only show "Has battery flow" if we are actually suggesting using it. */}
              {divertableAmount > 0 && (
                   <div className="flex items-center gap-1 text-[10px] text-blue-400 mt-1">
                      <CheckCircle2 size={10} />
                      <span>Buffering {Math.round(divertableAmount)}W</span>
                   </div>
              )}

           </div>
        </div>
        
        {/* RIGHT SIDE: Strategy Badge + Data Comparison */}
        <div className="flex flex-col items-end gap-2">
            
            {/* 1. Status Badge */}
            <div className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded border shadow-sm ${
                isBatterySafe
                ? 'bg-emerald-900/40 border-emerald-500/30 text-emerald-400' 
                : 'bg-amber-900/40 border-amber-500/30 text-amber-400'
            }`}>
                {isBatterySafe ? <CheckCircle2 size={12}/> : <BatteryWarning size={12}/>}
                <span>
                    {isBatterySafe ? "Battery Safe" : "Battery Priority"}
                </span>
            </div>
            
            {/* 2. Forecast vs Battery Need - Always Visible (with placeholders if no data) */}
            <div className="flex items-center gap-2 text-[10px] bg-slate-900/60 px-2 py-1 rounded-md border border-slate-700/50">
                <div className="flex items-center gap-1" title={hasAnyForecastData ? `Remaining Solar Forecast Today (${usingFallback ? 'Estimated' : 'Solcast'})` : "Forecast data unavailable"}>
                    <SunMedium size={10} className={hasAnyForecastData ? (usingFallback ? "text-slate-400" : "text-yellow-500") : "text-slate-600"}/> 
                    <span className="text-slate-300">
                        {hasAnyForecastData ? `+${Math.round(forecastRemainingKwh)}k` : '--'}
                    </span>
                </div>
                <span className="text-slate-600 text-[9px]">vs</span>
                <div className="flex items-center gap-1" title="Energy needed to reach 100% Charge">
                    <Battery size={10} className="text-blue-400"/> 
                    <span className="text-slate-300">-{Math.round(kwhToFill)}k</span>
                </div>
            </div>

        </div>
      </div>

      <div className="flex-1 flex flex-col gap-3 relative z-10 min-h-[140px] mt-2">
        
        {available.length === 0 ? (
             <div className="flex flex-col items-center justify-center flex-1 text-center opacity-60">
                {energyBlocked ? (
                    <>
                         <Leaf size={32} className="text-amber-500 mb-2" />
                         <p className="text-sm text-amber-400 font-medium">Conserve Energy</p>
                         <p className="text-xs text-slate-500 mt-1 max-w-[200px]">
                            Not enough sun left today to refill battery if devices run now.
                         </p>
                    </>
                ) : batteryBlocked ? (
                    <>
                        <Hourglass size={32} className="text-amber-500 mb-2" />
                        <p className="text-sm text-amber-400 font-medium">Charging Storage</p>
                        <p className="text-xs text-slate-500 mt-1 max-w-[200px]">
                            {Math.round(batteryCharging)}W is flowing to battery. Waiting for surplus...
                        </p>
                    </>
                ) : (
                    <>
                        <Zap size={32} className="text-slate-600 mb-2" />
                        <p className="text-sm text-slate-400">No surplus available.</p>
                        <p className="text-xs text-slate-600 mt-1">Wait for sun or reduce load.</p>
                    </>
                )}
             </div>
        ) : (
            <div className="space-y-3">
                {topRecommendations.map(app => {
                    const isUsingDiverted = app.watts > gridExport;
                    const usagePercent = Math.min(100, (app.watts / totalAvailablePower) * 100);
                    // Resolve Icon Component
                    const IconComponent = ICON_MAP[app.iconName] || Zap;

                    return (
                        <div key={app.id} className="group">
                            <div className="flex justify-between items-center mb-1">
                                <div className="flex items-center gap-2">
                                    <div className={`p-1.5 rounded-lg bg-slate-900/50 ${app.color}`}>
                                        <IconComponent size={14} />
                                    </div>
                                    <div>
                                        <span className="text-sm font-medium text-slate-200 block leading-tight">{app.name}</span>
                                        <span className="text-[9px] text-slate-500">~{app.kwhEstimate} kWh/cycle</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className="text-xs font-bold text-slate-500 block">{app.watts} W</span>
                                </div>
                            </div>
                            {/* Usage Bar */}
                            <div className="w-full h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                                <div 
                                    className={`h-full rounded-full ${
                                        isUsingDiverted
                                        ? 'bg-blue-500' // Blue = Smart Divert
                                        : usagePercent < 50 ? 'bg-emerald-500' : 'bg-yellow-500' 
                                    }`}
                                    style={{ width: `${usagePercent}%` }}
                                ></div>
                            </div>
                        </div>
                    );
                })}

                {/* Next Goal Indicator */}
                {nextUp && available.length < 3 && (
                    <div className="mt-auto pt-3 border-t border-slate-700/50 flex items-center gap-2 opacity-70">
                         <div className="p-1 rounded-full bg-slate-700 text-slate-400">
                            <ArrowUp size={12} />
                         </div>
                         <div className="text-xs text-slate-400">
                            Need <strong>+{Math.max(0, nextUp.watts - Math.round(usablePower))} W</strong> for <span className="text-slate-300">{nextUp.name}</span>
                         </div>
                    </div>
                )}
            </div>
        )}
      </div>
    </div>
  );
};

export default SmartRecommendations;
