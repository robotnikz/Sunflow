
import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { BatteryHealthData } from '../types';
import { Activity, Battery, Zap, AlertTriangle } from 'lucide-react';

interface BatteryHealthWidgetProps {
  data: BatteryHealthData | null;
  nominalCapacity: number; // Configured capacity (e.g., 10 kWh)
}

const BatteryHealthWidget: React.FC<BatteryHealthWidgetProps> = ({ data, nominalCapacity }) => {
  if (!data || data.dataPoints.length === 0) {
    return (
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg flex flex-col items-center justify-center h-full text-center">
            <div className="p-3 bg-slate-700/50 rounded-full mb-3 text-slate-400">
                <Activity size={24} />
            </div>
            <h3 className="text-slate-200 font-semibold">Battery Health</h3>
            <p className="text-sm text-slate-500 mt-2 max-w-xs">
                Not enough data yet. Requires full charge cycles to calculate SOH and efficiency.
            </p>
        </div>
    );
  }

  // Calculate Health Metric
  // If estimated capacity is > 95% of nominal, it's excellent.
  const latestSoh = data.latestCapacityEst > 0 ? (data.latestCapacityEst / nominalCapacity) * 100 : 0;
  
  let healthColor = 'text-emerald-400';
  let healthText = 'Excellent';
  if (latestSoh < 90) { healthColor = 'text-yellow-400'; healthText = 'Good'; }
  if (latestSoh < 80) { healthColor = 'text-amber-500'; healthText = 'Degrading'; }
  if (latestSoh < 70) { healthColor = 'text-red-500'; healthText = 'Poor'; }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div className="bg-slate-900 border border-slate-600 p-3 rounded-lg shadow-xl text-xs">
        <p className="text-slate-400 font-bold mb-2 border-b border-slate-700 pb-1">{label}</p>
        {payload.map((entry: any, index: number) => (
             <div key={index} className="flex items-center justify-between gap-4 mb-1">
                <span style={{ color: entry.color }}>{entry.name}:</span>
                <span className="font-mono text-slate-200">{entry.value}{entry.unit}</span>
             </div>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg relative overflow-hidden flex flex-col h-full">
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
            <div>
                <h3 className="text-slate-200 text-sm font-bold flex items-center gap-2">
                    <Activity size={16} className="text-purple-400"/> Battery Health (SOH)
                </h3>
                <p className="text-[10px] text-slate-500 mt-0.5">Based on {data.totalCycles} estimated cycles</p>
            </div>
            <div className={`px-2 py-0.5 rounded border bg-slate-900/50 flex items-center gap-1.5 ${healthColor} border-current opacity-80`}>
                <Battery size={12} />
                <span className="font-bold text-xs">{healthText}</span>
            </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-slate-900/50 p-2.5 rounded-lg border border-slate-700/50">
                <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase mb-0.5">
                    <Zap size={10} className="text-green-400"/> Efficiency
                </div>
                <div className="text-lg font-bold text-slate-100">{data.averageEfficiency}%</div>
            </div>
            <div className="bg-slate-900/50 p-2.5 rounded-lg border border-slate-700/50">
                 <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase mb-0.5">
                    <Battery size={10} className="text-purple-400"/> Est. Cap
                </div>
                <div className="text-lg font-bold text-slate-100">
                    {data.latestCapacityEst > 0 ? data.latestCapacityEst.toFixed(1) : '--'} <span className="text-xs font-normal text-slate-500">kWh</span>
                </div>
            </div>
        </div>

        {/* Chart */}
        <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.dataPoints} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                    <defs>
                        <linearGradient id="colorCap" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#A855F7" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#A855F7" stopOpacity={0}/>
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis 
                        dataKey="date" 
                        stroke="#64748b" 
                        fontSize={9} 
                        tickLine={false} 
                        minTickGap={30}
                        tickFormatter={(val) => {
                            const d = new Date(val);
                            return `${d.getDate()}.${d.getMonth()+1}`;
                        }}
                    />
                    <YAxis yAxisId="left" stroke="#64748b" fontSize={9} tickLine={false} domain={[0, nominalCapacity * 1.2]} />
                    <YAxis yAxisId="right" orientation="right" stroke="#64748b" fontSize={9} tickLine={false} domain={[60, 100]} hide />
                    
                    <Tooltip content={<CustomTooltip />} />
                    
                    <ReferenceLine y={nominalCapacity} yAxisId="left" stroke="#64748b" strokeDasharray="3 3" label={{ value: 'Rated', position: 'insideTopLeft', fontSize: 9, fill: '#64748b' }} />

                    <Area 
                        yAxisId="left"
                        type="monotone" 
                        dataKey="estimatedCapacity" 
                        name="Est. Capacity"
                        unit=" kWh"
                        stroke="#A855F7" 
                        fill="url(#colorCap)" 
                        connectNulls
                        strokeWidth={2}
                    />
                    
                     <Area 
                        yAxisId="right"
                        type="monotone" 
                        dataKey="efficiency" 
                        name="Efficiency"
                        unit="%"
                        stroke="#10B981" 
                        fill="none" 
                        connectNulls
                        strokeWidth={2}
                        strokeDasharray="4 4"
                    />

                </AreaChart>
            </ResponsiveContainer>
        </div>
        
    </div>
  );
};

export default BatteryHealthWidget;
