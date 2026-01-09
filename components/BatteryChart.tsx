
import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface BatteryChartProps {
  history: Array<{
    timestamp: string;
    soc: number;
  }>;
  timeRange: string;
}

const BatteryChart: React.FC<BatteryChartProps> = ({ history, timeRange }) => {
  if (history.length === 0) return null;

  // Dynamic Tick Formatting based on selected timeRange
  const formatTick = (ts: string) => {
    const d = new Date(ts);
    
    switch(timeRange) {
        case 'hour':
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        case 'day':
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        case 'week':
            return d.toLocaleDateString([], { weekday: 'short', day: '2-digit' });
        case 'month':
            return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
        case 'year':
            return d.toLocaleDateString([], { month: 'short', year: '2-digit' });
        case 'custom':
            return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        default:
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  };

  // Consistent Tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    const d = new Date(label);
    const dateStr = d.toLocaleString();

    return (
      <div className="bg-slate-900 border border-slate-600 p-3 rounded-lg shadow-2xl antialiased" style={{ boxShadow: '0 10px 30px -10px rgba(0,0,0,0.8)' }}>
        <p className="text-slate-400 font-semibold mb-2 border-b border-slate-700 pb-1 text-xs tracking-wide">
          {dateStr}
        </p>
        <div className="flex flex-col gap-1.5">
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center justify-between gap-6 text-xs">
                 <span className="text-emerald-400 font-bold">
                    State of Charge:
                 </span>
                 <span className="text-slate-100 font-mono font-bold tracking-tight">
                    {entry.value}%
                 </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={history} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
        <defs>
          <linearGradient id="colorSoc" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10B981" stopOpacity={0.5}/>
            <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
        <XAxis 
          dataKey="timestamp" 
          tickFormatter={formatTick}
          stroke="#94a3b8" 
          fontSize={11} 
          tickLine={false} 
          minTickGap={40}
        />
        <YAxis 
          stroke="#94a3b8" 
          fontSize={11} 
          tickLine={false} 
          domain={[0, 100]}
          unit="%"
        />
        <Tooltip 
          content={<CustomTooltip />} 
          cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }} 
          isAnimationActive={false}
        />
        <Area 
            type="monotone" 
            dataKey="soc" 
            stroke="#10B981" 
            strokeWidth={2}
            fill="url(#colorSoc)" 
            dot={false} 
            activeDot={{ r: 5, strokeWidth: 0 }} 
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default BatteryChart;
