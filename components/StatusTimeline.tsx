import React from 'react';

interface StatusTimelineProps {
  history: Array<{
    timestamp: string;
    status?: number; // 0=Offline, 1=Running, 2=Error
    soc: number;
  }>;
}

const StatusTimeline: React.FC<StatusTimelineProps> = ({ history }) => {
  if (!history || history.length === 0) return null;

  const totalPoints = history.length;

  // Helper to compress data into visual segments
  const createSegments = (getValue: (p: any) => any, getLabel: (val: any) => string, getColor: (val: any) => string) => {
    const segments: Array<{ value: any; start: number; count: number; label: string; color: string }> = [];
    let current = { 
        value: getValue(history[0]), 
        start: 0, 
        count: 0,
        label: getLabel(getValue(history[0])),
        color: getColor(getValue(history[0]))
    };

    history.forEach((point, index) => {
      const val = getValue(point);
      if (val !== current.value) {
        segments.push({ ...current });
        current = { 
            value: val, 
            start: index, 
            count: 1,
            label: getLabel(val),
            color: getColor(val)
        };
      } else {
        current.count++;
      }
    });
    segments.push(current);

    // Calc widths
    return segments.map(seg => ({
      ...seg,
      width: (seg.count / totalPoints) * 100
    }));
  };

  // --- Row 1: Errors (Health) ---
  // If status is 2 (Error), show Error. Otherwise show "Flawless"
  const errorSegments = createSegments(
    (p) => p.status === 2 ? 'error' : 'ok',
    (val) => val === 'error' ? 'Error' : 'Flawless',
    (val) => val === 'error' ? 'bg-red-500/80' : 'bg-emerald-600/80'
  );

  // --- Row 2: Status (Connectivity) ---
  // If status is 0 (Offline), show Offline. Default to Running (1) if undefined (migration fallback)
  const statusSegments = createSegments(
    (p) => (p.status === 0) ? 'offline' : 'running',
    (val) => val === 'offline' ? 'Offline' : 'Running',
    (val) => val === 'offline' ? 'bg-slate-600' : 'bg-emerald-600/80'
  );

  // --- Row 3: Battery ---
  // If SOC > 0 it's Active, else Idle
  const batterySegments = createSegments(
    (p) => p.soc > 0 ? 'active' : 'idle',
    (val) => val === 'active' ? 'Active' : 'Idle',
    (val) => val === 'active' ? 'bg-emerald-600/80' : 'bg-slate-700'
  );

  // X-Axis Time Ticks
  const ticks = [
    history[0].timestamp,
    history[Math.floor(totalPoints / 2)].timestamp,
    history[totalPoints - 1].timestamp
  ].map(t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

  const Row = ({ label, segments }: { label: string, segments: typeof errorSegments }) => (
    <div className="contents">
        {/* Label Column */}
        <div className="text-sm font-medium text-slate-400 py-1">{label}</div>
        
        {/* Bar Column */}
        <div className="relative h-8 w-full bg-slate-900 rounded flex overflow-hidden">
            {segments.map((seg, i) => (
                <div 
                    key={i} 
                    className={`h-full flex items-center pl-2 overflow-hidden whitespace-nowrap transition-all border-r border-slate-900/10 ${seg.color}`}
                    style={{ width: `${seg.width}%` }}
                    title={`${seg.label} (${Math.round(seg.width)}%)`}
                >
                    {/* Show label only if segment is wide enough (>5%) */}
                    {seg.width > 5 && (
                        <span className="text-xs font-bold text-white/90 drop-shadow-md">{seg.label}</span>
                    )}
                </div>
            ))}
        </div>
    </div>
  );

  return (
    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg">
      <h3 className="text-slate-200 text-lg font-semibold mb-6">Inverter Status</h3>
      
      {/* Grid Layout: [Label] [Bar] */}
      <div className="grid grid-cols-[80px_1fr] gap-y-4 gap-x-4 items-center">
        <Row label="Errors" segments={errorSegments} />
        <Row label="Status" segments={statusSegments} />
        <Row label="Battery" segments={batterySegments} />
      </div>

      {/* X Axis */}
      <div className="grid grid-cols-[80px_1fr] gap-x-4 mt-2">
         <div></div> {/* Spacer for label col */}
         <div className="flex justify-between text-xs text-slate-500 font-mono px-1">
            <span>{ticks[0]}</span>
            <span>{ticks[1]}</span>
            <span>{ticks[2]}</span>
         </div>
      </div>
      
      {/* Legend */}
      <div className="flex gap-6 mt-6 justify-center border-t border-slate-700/50 pt-4">
            <div className="flex items-center gap-2">
                <div className="w-4 h-1 bg-emerald-600 rounded"></div>
                <span className="text-xs text-slate-400">Flawless / Running</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="w-4 h-1 bg-red-500 rounded"></div>
                <span className="text-xs text-slate-400">Error</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="w-4 h-1 bg-slate-600 rounded"></div>
                <span className="text-xs text-slate-400">Offline</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="w-4 h-1 bg-slate-700 rounded"></div>
                <span className="text-xs text-slate-400">Idle</span>
            </div>
        </div>
    </div>
  );
};

export default StatusTimeline;