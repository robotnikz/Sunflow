
import React from 'react';
import { Smartphone, Laptop, Tv, Gamepad2, Coffee, Utensils, Shirt, Car, Zap, ArrowUp, BatteryWarning, SunMedium, Battery, CheckCircle2, Hourglass, Leaf, Wind, Monitor, Lightbulb, Speaker, Refrigerator, Fan, AlertOctagon } from 'lucide-react';
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
  solcastRateLimited: boolean;
  todayProduction: number; // kWh
  isDay: boolean; // From Open-Meteo
    sunriseIso?: string;
    sunsetIso?: string;
  batteryCapacity: number; // kWh
  appliances: Appliance[]; // User configured appliances
  hasSolcastKey: boolean;

    // Smart Usage: keep at least this SOC until sunset.
    // If battery SOC is above this threshold (and it is daytime), Smart Usage may also use battery energy.
    reserveSocPct?: number; // 0..100 (default 100)

    // Optional: used only for UI helper text.
    currency?: string;
    gridCostPerKwh?: number;
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

const currencySymbolFor = (currency: string | undefined) => {
    if (currency === 'EUR') return '€';
    if (currency === 'GBP') return '£';
    return '$';
};

const clampNumber = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const SmartRecommendations: React.FC<SmartRecommendationsProps> = ({ power, soc, forecast, solcastRateLimited, todayProduction, isDay, sunriseIso, sunsetIso, batteryCapacity, appliances, hasSolcastKey, reserveSocPct, currency, gridCostPerKwh }) => {
    const deviceList = (appliances || []).filter(app => Number(app?.watts || 0) > 0);
    const currencySymbol = currencySymbolFor(currency);

    const socPct = clampNumber(Number(soc || 0), 0, 100);
    const reservePct = clampNumber(Number(reserveSocPct ?? 100), 0, 100);
    const batteryCapacityKwh = Math.max(0, Number(batteryCapacity || 0));
    const socKwh = (socPct / 100) * batteryCapacityKwh;
    const reserveKwh = (reservePct / 100) * batteryCapacityKwh;
    const aboveReserveKwh = Math.max(0, socKwh - reserveKwh);

  // --- REALTIME DATA ---
  const gridExport = power.grid < -10 ? Math.abs(power.grid) : 0;
  const batteryCharging = power.battery < -10 ? Math.abs(power.battery) : 0;
  
  // --- FORECAST LOGIC (STRICT SEPARATION) ---
  let forecastRemainingKwh = 0;
  
  if (!isDay) {
      // NIGHT TIME: Forecast is 0 regardless of source
      forecastRemainingKwh = 0;
  } else if (hasSolcastKey) {
      // SOLCAST MODE (Yellow)
      if (forecast && forecast.forecasts && forecast.forecasts.length > 0) {
        const now = new Date();
        const remainingSlots = forecast.forecasts.filter(f => {
            const d = new Date(f.period_end);
            return d > now && d.getDate() === now.getDate();
        });
        forecastRemainingKwh = remainingSlots.reduce((sum, f) => sum + (f.pv_estimate * 0.5), 0);
      }
      // If Limit Reached and no data, it stays 0, but UI shows warning.
  } 
  // No Fallback Logic anymore.

  const hasAnyForecastData = hasSolcastKey && !!forecast;

  // --- BATTERY STRATEGY ---
    const socMissingToReserve = Math.max(0, reservePct - socPct);
    const kwhToReachReserve = (socMissingToReserve / 100) * batteryCapacityKwh;
    const energyBufferKwh = forecastRemainingKwh - (kwhToReachReserve * 1.1);
    const isBatterySafe = (energyBufferKwh > 0) || socPct >= reservePct || socPct > 95;

        const nowMs = Date.now();
        const sunriseMs = sunriseIso ? new Date(sunriseIso).getTime() : null;
        const sunsetMs = sunsetIso ? new Date(sunsetIso).getTime() : null;
        const hasSunTimes = Number.isFinite(Number(sunriseMs)) && Number.isFinite(Number(sunsetMs));
        const isBetweenSunriseAndSunset = hasSunTimes
                ? (nowMs >= (sunriseMs as number) && nowMs < (sunsetMs as number))
                : isDay;

        const canRunFromBatteryReserve = (app: Appliance) => {
            if (!isBetweenSunriseAndSunset) return false;
            if (!(batteryCapacityKwh > 0)) return false;
            if (!(socPct > reservePct + 0.5)) return false;
            const runKwh = Number(app.kwhEstimate || 0);
            if (!Number.isFinite(runKwh) || runKwh <= 0) return false;
            return runKwh <= aboveReserveKwh;
    };
  
  // Available Power Logic
  let totalAvailablePower = 0;
  let divertableAmount = 0;

  if (isBatterySafe) {
      divertableAmount = batteryCharging;
      totalAvailablePower = gridExport + divertableAmount;
  } else {
      divertableAmount = 0;
      totalAvailablePower = gridExport;
  }

  // Fallback if strictly NO data at all
  if (!hasAnyForecastData) {
      if (socPct >= 80) { 
          divertableAmount = batteryCharging;
          totalAvailablePower = gridExport + batteryCharging;
      } else {
          divertableAmount = 0;
          totalAvailablePower = 0;
      }
  }

  const SAFETY_MARGIN = 100;
  const usablePower = Math.max(0, totalAvailablePower - SAFETY_MARGIN);

  // --- FILTER APPLIANCES ---
  const available = deviceList.filter(app => {
      const hasPower = app.watts <= usablePower;
      const isGridOnly = app.watts <= gridExport;
      let hasEnergyBudget = true;
      if (!isGridOnly && hasAnyForecastData) {
          hasEnergyBudget = app.kwhEstimate <= energyBufferKwh || socPct > 95;
      }
      const bySurplus = hasPower && hasEnergyBudget;
      const byReserve = canRunFromBatteryReserve(app);
      return bySurplus || byReserve;
  });

  const energyBlocked = deviceList.find(app => 
      !available.includes(app) && 
      app.watts <= usablePower &&
      hasAnyForecastData && 
      app.kwhEstimate > energyBufferKwh
  );

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
                    <span className={`text-2xl font-bold ${totalAvailablePower > 0 || (isDay && aboveReserveKwh > 0) ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {totalAvailablePower > 0 ? `${Math.round(totalAvailablePower)} W` : (isDay && aboveReserveKwh > 0 ? `${aboveReserveKwh.toFixed(1)} kWh` : '0 W')}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">
                        {totalAvailablePower > 0 ? 'Free' : (isDay && aboveReserveKwh > 0 ? 'Above reserve' : 'Free')}
                    </span>
              </div>

              {(batteryCapacityKwh > 0 || divertableAmount > 0) && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0 text-[10px] leading-tight">
                      {batteryCapacityKwh > 0 && (
                          <span className="text-slate-500">
                              Reserve: <span className="text-slate-300">{Math.round(reservePct)}%</span>
                          </span>
                      )}
                      {divertableAmount > 0 && (
                          <span className="flex items-center gap-1 text-blue-400">
                              <CheckCircle2 size={10} />
                              <span>Buffering {Math.round(divertableAmount)}W</span>
                          </span>
                      )}
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
            
            {/* 2. Forecast vs Battery Need */}
            <div className="flex items-center gap-2 text-[10px] bg-slate-900/60 px-2 py-1 rounded-md border border-slate-700/50">
                <div className="flex items-center gap-1" title={hasAnyForecastData ? `Remaining Solar Forecast Today (Solcast)` : "Forecast data unavailable"}>
                    <SunMedium size={10} className={hasAnyForecastData ? "text-yellow-500" : "text-slate-600"}/> 
                    <span className="text-slate-300">
                        {hasAnyForecastData ? `+${Math.round(forecastRemainingKwh)}k` : '--'}
                    </span>
                    {solcastRateLimited && (
                        <span title="Solcast API Limit Reached (Using cached data if available)">
                            <AlertOctagon size={10} className="text-red-500 animate-pulse" />
                        </span>
                    )}
                </div>
                <span className="text-slate-600 text-[9px]">vs</span>
                <div className="flex items-center gap-1" title="Energy needed to reach your reserve target">
                    <Battery size={10} className="text-blue-400"/> 
                    <span className="text-slate-300">-{Math.round(kwhToReachReserve)}k</span>
                </div>
            </div>

        </div>
      </div>

      <div className="flex-1 flex flex-col gap-3 relative z-10 min-h-[140px] mt-2">
        {/* ... Recommendations List ... */}
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
                    const denom = Math.max(1, totalAvailablePower > 0 ? totalAvailablePower : app.watts);
                    const usagePercent = Math.min(100, (app.watts / denom) * 100);
                    const isUsingReserve = totalAvailablePower <= 0 && canRunFromBatteryReserve(app);
                    const runKwh = Number(app.kwhEstimate || 0);
                    const hasRunKwh = Number.isFinite(runKwh) && runKwh > 0;
                    const hasCost = hasRunKwh && Number.isFinite(Number(gridCostPerKwh)) && Number(gridCostPerKwh) > 0;
                    const runCost = hasCost ? (runKwh * Number(gridCostPerKwh)) : null;
                    const hasBatteryEq = hasRunKwh && Number.isFinite(Number(batteryCapacity)) && Number(batteryCapacity) > 0;
                    const batteryPct = hasBatteryEq ? Math.min(999, (runKwh / Number(batteryCapacity)) * 100) : null;
                    // Resolve Icon Component
                    const IconComponent = ICON_MAP[app.iconName] || Zap;

                    const sourceBadge = (() => {
                        if (isUsingReserve) {
                            return { label: 'Battery Reserve', cls: 'bg-purple-500/10 text-purple-300 border-purple-500/20' };
                        }
                        if (app.watts <= gridExport) {
                            return { label: 'Grid Export', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' };
                        }
                        if (totalAvailablePower > 0 && isUsingDiverted) {
                            return { label: 'Battery Divert', cls: 'bg-blue-500/10 text-blue-300 border-blue-500/20' };
                        }
                        return null;
                    })();

                    return (
                        <div key={app.id} className="group">
                            <div className="flex justify-between items-center mb-1">
                                <div className="flex items-center gap-2">
                                    <div className={`p-1.5 rounded-lg bg-slate-900/50 ${app.color}`}>
                                        <IconComponent size={14} />
                                    </div>
                                    <div>
                                        <span className="text-sm font-medium text-slate-200 block leading-tight">{app.name}</span>
                                                                                <span className="text-[9px] text-slate-500">
                                                                                    ~{runKwh} kWh/run
                                                                                    {hasCost && runCost !== null && (
                                                                                        <>
                                                                                            {' '}• ≈ {currencySymbol}{runCost.toFixed(2)}
                                                                                        </>
                                                                                    )}
                                                                                    {hasBatteryEq && batteryPct !== null && (
                                                                                        <>
                                                                                            {' '}• ~{Math.round(batteryPct)}% battery
                                                                                        </>
                                                                                    )}
                                                                                </span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className="text-xs font-bold text-slate-500 block">{app.watts} W</span>
                                    {sourceBadge && (
                                        <span className={`mt-1 inline-flex items-center justify-end px-1.5 py-0.5 rounded border text-[9px] font-semibold ${sourceBadge.cls}`}>
                                            {sourceBadge.label}
                                        </span>
                                    )}
                                </div>
                            </div>
                            {/* Usage Bar */}
                            <div className="w-full h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                                <div 
                                    className={`h-full rounded-full ${
                                        isUsingReserve
                                        ? 'bg-purple-500'
                                        : isUsingDiverted
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
