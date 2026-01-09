
import React from 'react';
import { BatteryCharging, Zap, Clock, Battery, ArrowDown, ArrowUp } from 'lucide-react';

interface BatteryWidgetProps {
  soc: number;
  power: number; // Watts
  state: 'charging' | 'discharging' | 'idle';
  capacity?: number; // Total Capacity in kWh
}

const BatteryWidget: React.FC<BatteryWidgetProps> = ({ soc, power, state, capacity = 10 }) => {
  // --- CONFIG ---
  const radius = 80;
  const stroke = 12;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  // We want a 240-degree arc (open at bottom)
  const arcAngle = 240; 
  const offsetAngle = (360 - arcAngle) / 2; // Rotate so gap is at bottom
  
  // Calculate stroke-dasharray for the arc
  // We only want to draw 'arcAngle' portion of the circle
  const arcLength = (arcAngle / 360) * circumference;
  const strokeDasharray = `${arcLength} ${circumference}`;
  
  // Calculate fill based on SOC
  // 0% SOC = full offset (empty)
  // 100% SOC = 0 offset (full) relative to the arcLength
  const strokeDashoffset = arcLength - ((soc / 100) * arcLength);

  // --- LOGIC ---
  const isCharging = state === 'charging';
  const isDischarging = state === 'discharging';
  const powerKw = Math.abs(power) / 1000;

  // Determine Colors
  const getColors = () => {
    if (soc <= 15) return { text: 'text-red-500', stroke: '#ef4444', shadow: 'rgba(239,68,68,0.4)' };
    if (soc <= 40) return { text: 'text-amber-400', stroke: '#fbbf24', shadow: 'rgba(251,191,36,0.4)' };
    return { text: 'text-emerald-400', stroke: '#10b981', shadow: 'rgba(16,185,129,0.4)' };
  };
  
  const colors = getColors();

  // Time Calculation
  const calculateTimeRemaining = () => {
      if (!powerKw || powerKw < 0.1) return null; 
      
      let hours = 0;
      if (isCharging) {
          const neededKwh = capacity * ((100 - soc) / 100);
          hours = neededKwh / powerKw;
      } else if (isDischarging) {
          const remainingKwh = capacity * (soc / 100);
          hours = remainingKwh / powerKw;
      }
      
      if (hours > 48) return "> 48h";
      const h = Math.floor(hours);
      const m = Math.round((hours - h) * 60);
      return `${h}h ${m}m`;
  };

  const timeString = calculateTimeRemaining();

  return (
    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl flex flex-col items-center justify-between h-full relative overflow-hidden">
        
        {/* Header */}
        <div className="w-full flex justify-between items-start z-10 mb-2">
             <h3 className="text-slate-400 text-sm font-medium flex items-center gap-2">
                <Battery size={16} /> Storage
            </h3>
             <div className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                 isCharging ? 'bg-emerald-900/30 border-emerald-500/30 text-emerald-400' :
                 isDischarging ? 'bg-amber-900/30 border-amber-500/30 text-amber-400' :
                 'bg-slate-700/30 border-slate-600 text-slate-400'
             }`}>
                 {state === 'idle' ? 'Standby' : state}
             </div>
        </div>

        {/* --- MAIN GAUGE --- */}
        <div className="relative flex-1 flex items-center justify-center w-full">
            <svg
                height={radius * 2 + 20}
                width={radius * 2 + 20}
                className={`transform rotate-[150deg] transition-all duration-700 ${isCharging ? 'scale-105' : ''}`} // Rotate to put gap at bottom
                viewBox={`0 0 ${radius * 2} ${radius * 2}`}
            >
                {/* Defs for Glow */}
                <defs>
                    <filter id="glow-gauge" x="-50%" y="-50%" width="200%" height="200%">
                         <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                         <feMerge>
                            <feMergeNode in="coloredBlur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                    <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor={soc < 20 ? "#ef4444" : "#fbbf24"} />
                        <stop offset="100%" stopColor={soc < 20 ? "#fbbf24" : "#10b981"} />
                    </linearGradient>
                </defs>

                {/* Background Track */}
                <circle
                    stroke="#1e293b" // slate-800
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    fill="transparent"
                    r={normalizedRadius}
                    cx={radius}
                    cy={radius}
                    style={{ strokeDasharray: `${arcLength} ${circumference}` }}
                />
                
                {/* Foreground Fill */}
                <circle
                    stroke="url(#gaugeGradient)"
                    strokeWidth={stroke}
                    strokeDasharray={strokeDasharray}
                    style={{ 
                        strokeDashoffset,
                        transition: 'stroke-dashoffset 1s ease-in-out',
                        filter: `drop-shadow(0 0 6px ${colors.shadow})`
                    }}
                    strokeLinecap="round"
                    fill="transparent"
                    r={normalizedRadius}
                    cx={radius}
                    cy={radius}
                />
            </svg>

            {/* --- CENTER DATA --- */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pt-4">
                {/* SOC Percentage */}
                <div className="flex items-baseline">
                    <span className={`text-5xl font-bold tracking-tighter ${colors.text} drop-shadow-lg`}>
                        {Math.round(soc)}
                    </span>
                    <span className="text-xl text-slate-500 font-medium">%</span>
                </div>

                {/* Power Flow Value */}
                {Math.abs(power) > 10 ? (
                    <div className="flex items-center gap-1 mt-1 text-slate-300 font-mono text-sm bg-slate-900/50 px-2 py-0.5 rounded-full border border-slate-700/50">
                        {isCharging ? <ArrowDown size={12} className="text-emerald-400"/> : <ArrowUp size={12} className="text-amber-400"/>}
                        {powerKw.toFixed(2)} kW
                    </div>
                ) : (
                    <span className="text-slate-600 text-xs mt-2 font-medium">IDLE</span>
                )}
            </div>
            
            {/* Subtle Glow for Charging (Replaces intrusive Ping) */}
            {isCharging && (
                 <div className="absolute inset-0 rounded-full bg-emerald-500/10 animate-pulse pointer-events-none m-12 blur-xl"></div>
            )}
        </div>

        {/* Footer: Time Remaining */}
        <div className="w-full mt-2 min-h-[24px] flex justify-center">
            {timeString && (
                <div className="flex items-center gap-2 text-xs text-slate-400 animate-fade-in">
                    <Clock size={12} />
                    <span>
                        {isCharging ? 'Full in' : 'Empty in'} <span className="text-slate-200 font-bold">{timeString}</span>
                    </span>
                </div>
            )}
            {!timeString && soc < 100 && soc > 0 && (
                <div className="text-[10px] text-slate-600">Calculated based on current load</div>
            )}
        </div>

    </div>
  );
};

export default BatteryWidget;
