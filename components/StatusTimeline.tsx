import React from 'react';

interface StatusTimelineProps {
  history: Array<{
    timestamp: string;
    status: number; // 0=Offline, 1=Running, 2=Error
    soc: number;
    production: number; // Used for "Producing" status check
    consumption: number;
  }>;
}

const StatusTimeline: React.FC<StatusTimelineProps> = ({ history }) => {
  if (!history || history.length === 0) return null;

  // Transform data into segments to reduce DOM nodes and create blocks
  // 1. Inverter Status Row
  const statusSegments = [];
  let currentSegment = { status: history[0].status, startTime: 0, count: 0 };
  
  // 2. Battery Status Row
  const batterySegments = [];
  // Helper to determine simplified battery state from historical data points
  // Since we don't store "Charging/Discharging" string in history DB, we infer from SOC delta or if we had power data.
  // Limitation: DB only stores SOC. Let's infer: 
  // We don't have historical power_battery in the chart array (it's in raw DB).
  // We can use SOC > 0 as "Active".
  let currentBattSegment = { status: history[0].soc > 0 ? 'active' : 'idle', startTime: 0, count: 0 };

  history.forEach((point, index) => {
    // --- Inverter Logic ---
    if (point.status !== currentSegment.status) {
      statusSegments.push({ ...currentSegment, width: 0 }); // width calc later
      currentSegment = { status: point.status, startTime: index, count: 1 };
    } else {
      currentSegment.count++;
    }

    // --- Battery Logic ---
    const battState = point.soc > 0 ? 'active' : 'idle';
    if (battState !== currentBattSegment.status) {
      batterySegments.push({ ...currentBattSegment, width: 0 });
      currentBattSegment = { status: battState, startTime: index, count: 1 };
    } else {
      currentBattSegment.count++;
    }
  });
  
  // Push last segments
  statusSegments.push(currentSegment);
  batterySegments.push(currentBattSegment);

  // Calculate widths
  const totalPoints = history.length;
  statusSegments.forEach(seg => seg.width = (seg.count / totalPoints) * 100);
  batterySegments.forEach(seg => seg.width = (seg.count / totalPoints) * 100);

  // Status mapping
  const getStatusColor = (code: number) => {
    switch (code) {
      case 1: return 'bg-emerald-500'; // Running
      case 2: return 'bg-red-500';     // Error
      default: return 'bg-slate-600';  // Offline
    }
  };

  const getStatusLabel = (code: number) => {
    switch (code) {
      case 1: return 'Running';
      case 2: return 'Error';
      default: return 'Offline';
    }
  };

  // Generate ticks for X-Axis (Time)
  const ticks = [
    history[0].timestamp,
    history[Math.floor(totalPoints / 2)].timestamp,
    history[totalPoints - 1].timestamp
  ].map(t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

  return (
    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg">
      <h3 className="text-slate-400 text-sm font-medium mb-4">System Status Timeline</h3>
      
      <div className="space-y-4">
        
        {/* Row 1: Inverter Status */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-xs text-slate-400 uppercase tracking-wider mb-1">
            <span>Inverter State</span>
          </div>
          <div className="w-full h-8 flex rounded-md overflow-hidden bg-slate-900 border border-slate-700">
            {statusSegments.map((seg, i) => (
              <div 
                key={i} 
                className={`${getStatusColor(seg.status)} hover:brightness-110 transition-all`}
                style={{ width: `${seg.width}%` }}
                title={`${getStatusLabel(seg.status)}: ${(seg.width).toFixed(1)}% of time`}
              ></div>
            ))}
          </div>
        </div>

        {/* Row 2: Battery Availability */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-xs text-slate-400 uppercase tracking-wider mb-1">
            <span>Battery Availability</span>
          </div>
          <div className="w-full h-8 flex rounded-md overflow-hidden bg-slate-900 border border-slate-700">
            {batterySegments.map((seg, i) => (
              <div 
                key={i} 
                className={`${seg.status === 'active' ? 'bg-emerald-600' : 'bg-slate-700'} border-r border-slate-800/20`}
                style={{ width: `${seg.width}%` }}
                title={`${seg.status === 'active' ? 'Active' : 'Standby'}`}
              ></div>
            ))}
          </div>
        </div>

        {/* X Axis Labels */}
        <div className="flex justify-between text-xs text-slate-500 mt-2 font-mono">
           <span>{ticks[0]}</span>
           <span>{ticks[1]}</span>
           <span>{ticks[2]}</span>
        </div>

        {/* Legend */}
        <div className="flex gap-4 mt-2 justify-center border-t border-slate-700/50 pt-3">
            <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                <span className="text-xs text-slate-400">Running / Active</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <span className="text-xs text-slate-400">Error</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-slate-600"></div>
                <span className="text-xs text-slate-400">Offline / Standby</span>
            </div>
        </div>
      </div>
    </div>
  );
};

export default StatusTimeline;