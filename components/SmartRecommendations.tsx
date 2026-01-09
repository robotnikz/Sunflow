
import React from 'react';
import { Smartphone, Laptop, Tv, Gamepad2, Coffee, Utensils, Shirt, Car, Zap, ArrowUp, BatteryWarning, CloudSun } from 'lucide-react';

interface SmartRecommendationsProps {
  gridPower: number; // Positive = Import, Negative = Export
  soc: number;       // Battery State of Charge %
  pvPower: number;   // Current PV Production
}

const APPLIANCES = [
  // Small loads (Safe to run anytime there is surplus)
  { id: 'phone', name: 'Charge Phone', watts: 15, icon: Smartphone, color: 'text-blue-400', heavy: false },
  { id: 'laptop', name: 'Laptop', watts: 60, icon: Laptop, color: 'text-indigo-400', heavy: false },
  { id: 'tv', name: 'TV / OLED', watts: 150, icon: Tv, color: 'text-purple-400', heavy: false },
  
  // Heavy loads (Require battery buffer)
  { id: 'pc', name: 'Gaming PC', watts: 400, icon: Gamepad2, color: 'text-pink-400', heavy: true },
  { id: 'coffee', name: 'Coffee Maker', watts: 1000, icon: Coffee, color: 'text-amber-700', heavy: true },
  { id: 'dishwasher', name: 'Dishwasher', watts: 1500, icon: Utensils, color: 'text-teal-400', heavy: true },
  { id: 'washing', name: 'Washing Machine', watts: 2000, icon: Shirt, color: 'text-cyan-400', heavy: true },
  { id: 'ev', name: 'Car (Min. Charge)', watts: 3700, icon: Car, color: 'text-emerald-400', heavy: true },
];

const SmartRecommendations: React.FC<SmartRecommendationsProps> = ({ gridPower, soc, pvPower }) => {
  // 1. Calculate available surplus (Grid Export)
  // We only count surplus if we are exporting (negative grid power)
  const surplus = gridPower < -10 ? Math.abs(gridPower) : 0;

  // 2. Define Stability Rules
  // "Heavy" appliances should only run if we have a battery buffer to handle clouds
  const MIN_SOC_FOR_HEAVY_LOAD = 30; // 30% Battery required for heavy loads
  
  // Filter appliances based on Wattage AND Stability
  const available = APPLIANCES.filter(app => {
    // Basic check: Is there enough power?
    const hasPower = app.watts <= surplus;
    
    // Stability check: If it's a heavy load, do we have battery buffer?
    // Exception: If PV is massive (e.g. > 3x the device needs), we might risk it without battery
    const isStable = !app.heavy || (soc >= MIN_SOC_FOR_HEAVY_LOAD) || (pvPower > app.watts * 3);
    
    return hasPower && isStable;
  });

  const nextUp = APPLIANCES.find(app => !available.includes(app) && app.watts > surplus); 
  
  // Find blocked items (Enough power, but blocked by low battery)
  const batteryBlocked = APPLIANCES.find(app => 
      app.heavy && 
      app.watts <= surplus && 
      soc < MIN_SOC_FOR_HEAVY_LOAD
  );

  // Sort available by wattage desc (show biggest consumers first)
  const topRecommendations = [...available].sort((a, b) => b.watts - a.watts).slice(0, 3);

  return (
    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl flex flex-col h-full relative overflow-hidden transition-all duration-500">
      
      {/* Background Effect - Dynamic based on state */}
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
        
        {/* Stability Indicator */}
        {surplus > 0 && soc < MIN_SOC_FOR_HEAVY_LOAD && (
            <div className="flex flex-col items-end">
                <div className="flex items-center gap-1 text-amber-400 text-xs font-bold bg-amber-900/30 px-2 py-1 rounded border border-amber-700/50">
                    <CloudSun size={12} />
                    <span>Buffer Low</span>
                </div>
            </div>
        )}
      </div>

      <div className="flex-1 flex flex-col gap-3 relative z-10 min-h-[140px]">
        
        {/* STATE 1: No Surplus */}
        {surplus < 15 ? (
             <div className="flex flex-col items-center justify-center flex-1 text-center opacity-60">
                <Zap size={32} className="text-slate-600 mb-2" />
                <p className="text-sm text-slate-400">No surplus power.</p>
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
                         <p className="text-sm text-slate-300 font-medium">Prioritizing Battery</p>
                         <p className="text-xs text-slate-500 mt-1 max-w-[200px]">
                            {batteryBlocked.name} could run, but battery ({Math.round(soc)}%) is below safe buffer ({MIN_SOC_FOR_HEAVY_LOAD}%).
                         </p>
                    </div>
                ) : (
                    /* STATE 3: Recommendations Available */
                    <div className="space-y-3">
                        {topRecommendations.map(app => {
                            const usagePercent = Math.min(100, (app.watts / surplus) * 100);
                            return (
                                <div key={app.id} className="group">
                                    <div className="flex justify-between items-center mb-1">
                                        <div className="flex items-center gap-2">
                                            <div className={`p-1.5 rounded-lg bg-slate-900/50 ${app.color}`}>
                                                <app.icon size={14} />
                                            </div>
                                            <span className="text-sm font-medium text-slate-200">{app.name}</span>
                                        </div>
                                        <span className="text-xs font-bold text-slate-500">{app.watts} W</span>
                                    </div>
                                    {/* Usage Bar */}
                                    <div className="w-full h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                                        <div 
                                            className={`h-full rounded-full ${usagePercent < 50 ? 'bg-emerald-500' : 'bg-yellow-500'}`}
                                            style={{ width: `${usagePercent}%` }}
                                        ></div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* "Next Goal" indicator */}
                {nextUp && !batteryBlocked && (
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
