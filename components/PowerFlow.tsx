import React from 'react';
import { Sun, Home, Zap, Battery } from 'lucide-react';

interface PowerFlowProps {
  power: {
    pv: number;
    load: number;
    grid: number;
    battery: number;
  };
  soc: number;
}

const PowerFlow: React.FC<PowerFlowProps> = ({ power, soc }) => {
  // Normalize grid/battery for visual flow direction
  const isImporting = power.grid > 0;
  const isCharging = power.battery > 0;
  const isDischarging = power.battery < -10; // Threshold

  // Calculate line thickness/opacity based on power flow (clamped)
  const getFlowStyle = (watts: number) => {
    const absWatts = Math.abs(watts);
    const active = absWatts > 10;
    return {
      strokeWidth: active ? Math.min(Math.max(absWatts / 500, 2), 8) : 1,
      opacity: active ? 1 : 0.2,
      animationDuration: active ? `${Math.max(0.5, 3000 / absWatts)}s` : '0s' 
    };
  };

  const pvStyle = getFlowStyle(power.pv);
  const gridStyle = getFlowStyle(power.grid);
  const battStyle = getFlowStyle(power.battery);
  const loadStyle = getFlowStyle(power.load);

  return (
    <div className="relative w-full max-w-lg aspect-video flex items-center justify-center select-none">
      
      {/* SVG Connections */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 250">
        <defs>
          <linearGradient id="gradSolar" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#EAB308" />
            <stop offset="100%" stopColor="#EAB308" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Center Hub (Inverter) */}
        <circle cx="200" cy="125" r="5" fill="#475569" />

        {/* Solar -> Center */}
        <line x1="200" y1="40" x2="200" y2="125" stroke="#EAB308" strokeWidth={pvStyle.strokeWidth} opacity={pvStyle.opacity} strokeDasharray="10 5" className={power.pv > 10 ? "animate-pulse-flow" : ""} />

        {/* Center -> Home (Load) */}
        <line x1="200" y1="125" x2="200" y2="210" stroke="#3B82F6" strokeWidth={loadStyle.strokeWidth} opacity={loadStyle.opacity} strokeDasharray="10 5" className={power.load > 10 ? "animate-pulse-flow-down" : ""} />

        {/* Grid <-> Center */}
        <line x1="340" y1="125" x2="200" y2="125" stroke={isImporting ? "#EF4444" : "#22C55E"} strokeWidth={gridStyle.strokeWidth} opacity={gridStyle.opacity} strokeDasharray="10 5" className={power.grid !== 0 ? (isImporting ? "animate-pulse-flow-left" : "animate-pulse-flow-right") : ""} />

        {/* Battery <-> Center */}
        <line x1="60" y1="125" x2="200" y2="125" stroke="#A855F7" strokeWidth={battStyle.strokeWidth} opacity={battStyle.opacity} strokeDasharray="10 5" className={Math.abs(power.battery) > 10 ? (isCharging ? "animate-pulse-flow-right" : "animate-pulse-flow-left") : ""} />
      </svg>

      {/* Nodes */}
      
      {/* Solar (Top) */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 flex flex-col items-center">
        <div className={`p-3 rounded-full bg-slate-800 border-2 ${power.pv > 0 ? 'border-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : 'border-slate-600'} transition-all duration-500`}>
          <Sun className="text-yellow-500" size={32} />
        </div>
        <span className="mt-2 font-mono text-yellow-400 font-bold">{Math.round(power.pv)} W</span>
      </div>

      {/* Load (Bottom) */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 flex flex-col items-center">
        <span className="mb-2 font-mono text-blue-400 font-bold">{Math.round(power.load)} W</span>
        <div className="p-3 rounded-full bg-slate-800 border-2 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]">
          <Home className="text-blue-500" size={32} />
        </div>
      </div>

      {/* Grid (Right) */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col items-center">
        <div className={`p-3 rounded-full bg-slate-800 border-2 ${isImporting ? 'border-red-500' : 'border-green-500'} transition-colors duration-500`}>
          <Zap className={isImporting ? 'text-red-500' : 'text-green-500'} size={32} />
        </div>
        <span className={`mt-2 font-mono font-bold ${isImporting ? 'text-red-400' : 'text-green-400'}`}>
          {Math.round(Math.abs(power.grid))} W
        </span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">{isImporting ? 'Grid Import' : 'Grid Export'}</span>
      </div>

      {/* Battery (Left) */}
      <div className="absolute left-0 top-1/2 -translate-y-1/2 flex flex-col items-center">
        <div className={`relative p-3 rounded-full bg-slate-800 border-2 ${isDischarging ? 'border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.3)]' : isCharging ? 'border-green-500' : 'border-slate-600'}`}>
          <Battery className="text-purple-500" size={32} />
          {/* SOC Indicator Overlay */}
          <div className="absolute -bottom-1 -right-1 bg-slate-900 text-[10px] font-bold text-white px-1 rounded border border-slate-700">
            {Math.round(soc)}%
          </div>
        </div>
        <span className="mt-2 font-mono text-purple-400 font-bold">{Math.round(Math.abs(power.battery))} W</span>
      </div>

      <style>{`
        @keyframes flow { to { stroke-dashoffset: -15; } }
        @keyframes flow-reverse { to { stroke-dashoffset: 15; } }
        .animate-pulse-flow { animation: flow 1s linear infinite; }
        .animate-pulse-flow-down { animation: flow 1s linear infinite; }
        .animate-pulse-flow-right { animation: flow-reverse 1s linear infinite; }
        .animate-pulse-flow-left { animation: flow 1s linear infinite; }
      `}</style>
    </div>
  );
};

export default PowerFlow;