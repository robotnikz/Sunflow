
import React, { memo } from 'react';
import { Sun, Home, Zap, Battery, ArrowDown, ArrowUp } from 'lucide-react';

interface PowerFlowProps {
  power: {
    pv: number;
    load: number;
    grid: number;
    battery: number;
  };
  soc: number;
}

const PowerFlow: React.FC<PowerFlowProps> = memo(({ power, soc }) => {
  // Logic
  const isImporting = power.grid > 0;
  const isExporting = power.grid < 0;
  
  // FIXED LOGIC: Fronius P_Akku is Negative when Charging, Positive when Discharging
  const isCharging = power.battery < -10; 
  const isDischarging = power.battery > 10;
  
  const gridPowerAbs = Math.abs(power.grid);
  const batPowerAbs = Math.abs(power.battery);

  // Helper to determine animation speed based on wattage
  const getSpeed = (watts: number) => {
    const val = Math.abs(watts);
    if (val < 10) return 0; // Stopped
    if (val < 500) return 3; // Slow
    if (val < 2000) return 1.5; // Medium
    return 0.8; // Fast
  };

  const pvSpeed = getSpeed(power.pv);
  const loadSpeed = getSpeed(power.load);
  const gridSpeed = getSpeed(power.grid);
  const batSpeed = getSpeed(power.battery);

  // Colors
  const cPV = "#EAB308"; // Yellow-500
  const cLoad = "#3B82F6"; // Blue-500
  const cGrid = isImporting ? "#EF4444" : "#22C55E"; // Red/Green
  const cBat = "#A855F7"; // Purple-500

  // SVG Coordinates (Center 300,200)
  // Canvas Size: 600x400
  const cx = 300;
  const cy = 200;
  
  // Endpoint Coordinates (Where the icons sit visually)
  // Adjusted to match new % positions (15% / 85%)
  const topY = 60;    // 15% of 400
  const bottomY = 340; // 85% of 400
  const leftX = 90;   // 15% of 600
  const rightX = 510; // 85% of 600

  return (
    <div className="relative w-full h-full flex items-center justify-center select-none p-4">
      <svg className="w-full h-full max-w-2xl max-h-[400px]" viewBox="0 0 600 400" preserveAspectRatio="xMidYMid meet">
        <defs>
            {/* Glow Filters */}
            <filter id="glow-pv" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="glow-load"><feGaussianBlur stdDeviation="4" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <filter id="glow-grid"><feGaussianBlur stdDeviation="4" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <filter id="glow-bat"><feGaussianBlur stdDeviation="4" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>

        {/* --- CONNECTING LINES (Background Tracks) --- */}
        {/* PV to Center */}
        <path d={`M${cx},${topY} L${cx},${cy}`} stroke={cPV} strokeWidth="2" strokeOpacity="0.2" fill="none" />
        {/* Center to Load */}
        <path d={`M${cx},${cy} L${cx},${bottomY}`} stroke={cLoad} strokeWidth="2" strokeOpacity="0.2" fill="none" />
        {/* Bat to Center */}
        <path d={`M${leftX},${cy} L${cx},${cy}`} stroke={cBat} strokeWidth="2" strokeOpacity="0.2" fill="none" />
        {/* Center to Grid */}
        <path d={`M${cx},${cy} L${rightX},${cy}`} stroke={cGrid} strokeWidth="2" strokeOpacity="0.2" fill="none" />


        {/* --- ANIMATED FLOW PARTICLES --- */}
        
        {/* PV Flow */}
        {power.pv > 10 && (
            <circle r="4" fill={cPV} filter="url(#glow-pv)">
                <animateMotion dur={`${pvSpeed}s`} repeatCount="indefinite" path={`M${cx},${topY} L${cx},${cy}`} keyPoints="0;1" keyTimes="0;1" />
            </circle>
        )}

        {/* Load Flow */}
        {power.load > 10 && (
            <circle r="4" fill={cLoad} filter="url(#glow-load)">
                <animateMotion dur={`${loadSpeed}s`} repeatCount="indefinite" path={`M${cx},${cy} L${cx},${bottomY}`} keyPoints="0;1" keyTimes="0;1" />
            </circle>
        )}

        {/* Battery Flow */}
        {batPowerAbs > 10 && (
            <circle r="4" fill={cBat} filter="url(#glow-bat)">
                {isCharging ? (
                     // Charging: Center -> Battery (Left)
                     <animateMotion dur={`${batSpeed}s`} repeatCount="indefinite" path={`M${cx},${cy} L${leftX},${cy}`} keyPoints="0;1" keyTimes="0;1" />
                ) : (
                     // Discharging: Battery (Left) -> Center
                     <animateMotion dur={`${batSpeed}s`} repeatCount="indefinite" path={`M${leftX},${cy} L${cx},${cy}`} keyPoints="0;1" keyTimes="0;1" />
                )}
            </circle>
        )}

        {/* Grid Flow */}
        {gridPowerAbs > 10 && (
            <circle r="4" fill={cGrid} filter="url(#glow-grid)">
                {isImporting ? (
                    <animateMotion dur={`${gridSpeed}s`} repeatCount="indefinite" path={`M${rightX},${cy} L${cx},${cy}`} keyPoints="0;1" keyTimes="0;1" />
                ) : (
                    <animateMotion dur={`${gridSpeed}s`} repeatCount="indefinite" path={`M${cx},${cy} L${rightX},${cy}`} keyPoints="0;1" keyTimes="0;1" />
                )}
            </circle>
        )}

        {/* --- NODES --- */}

        {/* CENTER HUB */}
        <circle cx={cx} cy={cy} r="15" fill="#1e293b" stroke="#64748b" strokeWidth="2" />
        <circle cx={cx} cy={cy} r="6" fill="#94a3b8" className="animate-pulse" />

      </svg>

      {/* --- HTML OVERLAYS --- */}
      
      {/* PV NODE */}
      <div 
        className="absolute flex flex-col-reverse items-center gap-4"
        style={{ top: '15%', left: '50%', transform: 'translate(-50%, -50%)' }}
      >
        <div className="p-4 rounded-full bg-slate-800/80 backdrop-blur border border-slate-600 shadow-[0_0_20px_rgba(234,179,8,0.2)] transition-transform duration-300 hover:scale-110 z-10 relative">
             <Sun className="text-yellow-500" size={36} fill={power.pv > 0 ? "currentColor" : "none"} fillOpacity={0.2} />
        </div>
        <div className="flex flex-col items-center gap-1 mb-1">
             <span className="text-xs text-slate-500 font-medium tracking-wide">SOLAR</span>
             <span className="text-xl font-bold text-yellow-400 drop-shadow-md leading-none whitespace-nowrap">{Math.round(power.pv)} W</span>
        </div>
      </div>

      {/* LOAD NODE */}
      <div 
        className="absolute flex flex-col items-center gap-4"
        style={{ top: '85%', left: '50%', transform: 'translate(-50%, -50%)' }}
      >
        <div className="p-4 rounded-full bg-slate-800/80 backdrop-blur border border-slate-600 shadow-[0_0_20px_rgba(59,130,246,0.2)] transition-transform duration-300 hover:scale-110 z-10 relative">
             <Home className="text-blue-500" size={36} />
        </div>
        <div className="flex flex-col items-center gap-1 mt-1">
             <span className="text-xl font-bold text-blue-400 drop-shadow-md leading-none whitespace-nowrap">{Math.round(power.load)} W</span>
             <span className="text-xs text-slate-500 font-medium tracking-wide">HOME LOAD</span>
        </div>
      </div>

      {/* BATTERY NODE */}
      <div 
        className="absolute flex flex-col items-center gap-4 w-[140px]"
        style={{ top: '50%', left: '15%', transform: 'translate(-50%, -50%)' }}
      >
        <div className="p-4 rounded-full bg-slate-800/80 backdrop-blur border border-slate-600 shadow-[0_0_20px_rgba(168,85,247,0.3)] transition-all duration-300 hover:scale-110 z-10 relative">
             <Battery className="text-purple-500" size={36} />
        </div>
        <div className="flex flex-col items-center gap-1 w-full mt-1">
             <span className="text-xl font-bold text-purple-400 drop-shadow-md leading-none whitespace-nowrap">{Math.round(batPowerAbs)} W</span>
             <span className="text-xs text-slate-500 font-medium flex justify-center items-center gap-1">
                {isCharging ? 'CHARGING' : isDischarging ? 'DRAINING' : 'IDLE'}
             </span>
        </div>
      </div>

      {/* GRID NODE */}
      <div 
        className="absolute flex flex-col items-center gap-4 w-[140px]"
        style={{ top: '50%', left: '85%', transform: 'translate(-50%, -50%)' }}
      >
        <div className={`p-4 rounded-full bg-slate-800/80 backdrop-blur border ${isImporting ? 'border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)]' : isExporting ? 'border-green-500 shadow-[0_0_20px_rgba(34,197,94,0.3)]' : 'border-slate-600'} transition-all duration-300 hover:scale-110 z-10 relative`}>
             <Zap className={isImporting ? 'text-red-500' : isExporting ? 'text-green-500' : 'text-slate-500'} size={36} fill={power.grid !== 0 ? "currentColor" : "none"} fillOpacity={0.2} />
        </div>
        <div className="flex flex-col items-center gap-1 w-full mt-1">
             <span className={`text-xl font-bold drop-shadow-md leading-none whitespace-nowrap ${isImporting ? 'text-red-400' : isExporting ? 'text-green-400' : 'text-slate-500'}`}>
                {Math.round(gridPowerAbs)} W
             </span>
             <span className={`text-xs font-medium flex justify-center items-center gap-1 ${isImporting ? 'text-red-500' : isExporting ? 'text-green-500' : 'text-slate-500'}`}>
                {isImporting && <ArrowDown size={12}/>}
                {isExporting && <ArrowUp size={12}/>}
                {isImporting ? 'GRID' : isExporting ? 'GRID' : 'GRID'}
             </span>
        </div>
      </div>

    </div>
  );
});

export default PowerFlow;
