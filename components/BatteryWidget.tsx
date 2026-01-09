
import React from 'react';
import { BatteryCharging, Zap, Clock } from 'lucide-react';

interface BatteryWidgetProps {
  soc: number;
  power: number; // Used for status calculation
  state: 'charging' | 'discharging' | 'idle';
  capacity?: number; // Total Capacity in kWh
}

const BatteryWidget: React.FC<BatteryWidgetProps> = ({ soc, power, state, capacity = 10 }) => {
  // Determine Color based on SOC
  const getColor = () => {
    if (soc <= 20) return 'from-red-500 to-red-600';
    if (soc <= 50) return 'from-yellow-400 to-yellow-500';
    return 'from-emerald-400 to-emerald-600';
  };

  const getShadowColor = () => {
    if (soc <= 20) return 'shadow-red-500/20';
    if (soc <= 50) return 'shadow-yellow-500/20';
    return 'shadow-emerald-500/20';
  };

  const isCharging = state === 'charging';
  const isDischarging = state === 'discharging';
  const powerAbs = Math.abs(power);

  // Time Calculation Logic
  const calculateTimeRemaining = () => {
      if (!powerAbs || powerAbs < 100) return null; // Too slow to calc
      
      let hours = 0;
      if (isCharging) {
          // Time to Full: (Capacity * (100-SOC)%) / PowerkW
          const neededKwh = capacity * ((100 - soc) / 100);
          hours = neededKwh / (powerAbs / 1000);
      } else if (isDischarging) {
          // Time to Empty: (Capacity * SOC%) / PowerkW
          const remainingKwh = capacity * (soc / 100);
          hours = remainingKwh / (powerAbs / 1000);
      }
      
      if (hours > 24) return "> 24h";
      
      const h = Math.floor(hours);
      const m = Math.round((hours - h) * 60);
      return `${h}h ${m}m`;
  };

  const timeString = calculateTimeRemaining();

  return (
    <div className={`relative overflow-hidden bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl transition-all duration-500 flex flex-col items-center justify-center min-h-[200px] h-full`}>
        
        {/* Background Glow Effect */}
        <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${getColor()} opacity-10 blur-[50px] rounded-full pointer-events-none`}></div>

        <h3 className="text-slate-400 text-sm font-medium absolute top-4 left-4 flex items-center gap-2">
            Energy Storage
        </h3>

        {/* Main Centered Content */}
        <div className="flex flex-col items-center justify-center gap-2 relative z-10 mt-4">
            
            {/* The Visual Battery Container */}
            <div className="relative transform scale-105">
                {/* Battery Cap */}
                <div className="w-12 h-4 bg-slate-600 mx-auto rounded-t-sm mb-[1px]"></div>
                
                {/* Battery Body */}
                <div className="w-28 h-40 bg-slate-900 border-[5px] border-slate-600 rounded-2xl relative p-1 shadow-inner overflow-hidden">
                    
                    {/* Grid Pattern Background inside Battery */}
                    <div className="absolute inset-0 opacity-20 bg-[linear-gradient(rgba(255,255,255,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.1)_1px,transparent_1px)] bg-[size:10px_10px]"></div>

                    {/* The Liquid Fill */}
                    <div 
                        className={`absolute bottom-1 left-1 right-1 rounded-lg bg-gradient-to-t ${getColor()} transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(0,0,0,0.5)] ${getShadowColor()}`}
                        style={{ height: `${Math.max(soc, 5)}%` }} // Min 5% so we always see a sliver
                    >
                        {/* Shimmer/Reflection effect on the liquid */}
                        <div className="absolute top-0 left-0 right-0 h-[1px] bg-white/30"></div>
                        
                        {/* Charging Animation (Bubbles) */}
                        {isCharging && (
                            <div className="absolute inset-0 overflow-hidden rounded-xl">
                                <div className="absolute bottom-0 left-1/4 w-1 h-1 bg-white/40 rounded-full animate-[rise_2s_infinite]"></div>
                                <div className="absolute bottom-0 left-1/2 w-1.5 h-1.5 bg-white/40 rounded-full animate-[rise_3s_infinite_0.5s]"></div>
                                <div className="absolute bottom-0 left-3/4 w-1 h-1 bg-white/40 rounded-full animate-[rise_2.5s_infinite_1s]"></div>
                            </div>
                        )}
                    </div>

                    {/* Percentage Text Overlay centered in Battery */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="text-4xl font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] z-20 tracking-tight">{Math.round(soc)}%</span>
                    </div>
                </div>
            </div>

            {/* Status Text below */}
            <div className="flex flex-col items-center gap-1 mt-2">
                 <div className="flex items-center gap-2">
                    {isCharging ? <BatteryCharging size={16} className="text-emerald-400 animate-pulse"/> : <Zap size={16} className="text-slate-500"/>}
                    <span className={`text-sm font-bold uppercase tracking-widest ${
                            state === 'charging' ? 'text-emerald-400' : state === 'discharging' ? 'text-amber-400' : 'text-slate-500'
                        }`}>
                            {state === 'idle' ? 'Standby' : state}
                    </span>
                 </div>
                 
                 {/* Smart Time Calculation Display */}
                 {timeString && (state !== 'idle') && (
                     <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-900/50 px-2 py-1 rounded-full border border-slate-700/50">
                        <Clock size={10} />
                        <span>
                            {isCharging ? 'Full in ' : 'Empty in '} 
                            <span className="text-slate-200 font-mono font-bold">{timeString}</span>
                        </span>
                     </div>
                 )}
            </div>
        </div>

        {/* CSS for Bubble Animation */}
        <style>{`
            @keyframes rise {
                0% { transform: translateY(0); opacity: 0; }
                50% { opacity: 1; }
                100% { transform: translateY(-80px); opacity: 0; }
            }
        `}</style>
    </div>
  );
};

export default BatteryWidget;
