import React from 'react';
import { BatteryCharging, Zap } from 'lucide-react';

interface BatteryWidgetProps {
  soc: number;
  power: number; // Positive = Charging, Negative = Discharging
  state: 'charging' | 'discharging' | 'idle';
}

const BatteryWidget: React.FC<BatteryWidgetProps> = ({ soc, power, state }) => {
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

  return (
    <div className={`relative overflow-hidden bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl transition-all duration-500 ${isCharging ? 'border-emerald-500/30' : ''}`}>
        
        {/* Background Glow Effect */}
        <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${getColor()} opacity-10 blur-[50px] rounded-full pointer-events-none`}></div>

        <div className="flex justify-between items-start mb-4 relative z-10">
            <h3 className="text-slate-400 text-sm font-medium">Energy Storage</h3>
            <div className="flex gap-2">
                {isCharging && <BatteryCharging className="text-emerald-400 animate-pulse" size={20} />}
                {isDischarging && <Zap className="text-amber-400" size={20} />}
            </div>
        </div>

        {/* Main Centered Content */}
        <div className="flex flex-col items-center justify-center gap-3 relative z-10">
            
            {/* The Visual Battery Container */}
            <div className="relative">
                {/* Battery Cap */}
                <div className="w-10 h-3 bg-slate-600 mx-auto rounded-t-sm mb-[1px]"></div>
                
                {/* Battery Body */}
                <div className="w-24 h-36 bg-slate-900 border-4 border-slate-600 rounded-2xl relative p-1 shadow-inner">
                    
                    {/* Grid Pattern Background inside Battery */}
                    <div className="absolute inset-0 opacity-20 bg-[linear-gradient(rgba(255,255,255,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.1)_1px,transparent_1px)] bg-[size:10px_10px]"></div>

                    {/* The Liquid Fill */}
                    <div 
                        className={`absolute bottom-1 left-1 right-1 rounded-xl bg-gradient-to-t ${getColor()} transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(0,0,0,0.5)] ${getShadowColor()}`}
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
                        <span className="text-3xl font-bold text-white drop-shadow-md z-20 mix-blend-overlay opacity-90 tracking-tight">{Math.round(soc)}%</span>
                    </div>
                </div>
            </div>

            {/* Status Text below */}
            <div className="text-center mt-1">
                 <span className={`text-xs font-bold uppercase tracking-widest ${
                        isCharging ? 'text-emerald-400' : isDischarging ? 'text-amber-400' : 'text-slate-500'
                    }`}>
                        {state === 'idle' ? 'Standby' : state}
                 </span>
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