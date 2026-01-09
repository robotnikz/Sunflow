
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface EfficiencyChartProps {
  history: Array<{
    timestamp: string;
    autonomy: number;
    selfConsumption: number;
  }>;
}

const EfficiencyChart: React.FC<EfficiencyChartProps> = ({ history }) => {
  if (history.length === 0) return null;

  const startTime = new Date(history[0].timestamp).getTime();
  const endTime = new Date(history[history.length - 1].timestamp).getTime();
  const durationHours = (endTime - startTime) / (1000 * 60 * 60);
  const showDate = durationHours > 24;

  const formatTick = (ts: string) => {
    const d = new Date(ts);
    if (showDate) {
      return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth()+1).toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:00`;
    }
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderLegend = (props: any) => {
    const { payload } = props;
    return (
      <div className="flex justify-center gap-6 mt-6 select-none">
        {payload.map((entry: any, index: number) => (
          <div key={`item-${index}`} className="flex items-center gap-2">
            <div style={{ backgroundColor: entry.color }} className="w-3 h-3 rounded-full" />
            <span 
                className={`text-sm font-bold ${entry.value === 'Autonomy' ? 'text-blue-400' : 'text-green-400'}`}
            >
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    );
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
          {payload.map((entry: any, index: number) => {
             const isAutonomy = entry.name === 'Autonomy';
             const textColor = isAutonomy ? '#60A5FA' : '#4ADE80'; // Blue-400 : Green-400
             
             return (
                <div key={index} className="flex items-center justify-between gap-6 text-xs">
                    <span style={{ color: textColor }} className="font-bold">
                        {entry.name}:
                    </span>
                    <span className="text-slate-100 font-mono font-bold tracking-tight">
                        {entry.value}%
                    </span>
                </div>
             );
          })}
        </div>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={history} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
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
        <Legend content={renderLegend} />
        
        <Line 
            type="monotone" 
            dataKey="autonomy" 
            name="Autonomy"
            stroke="#3B82F6" 
            strokeWidth={2}
            dot={false} 
            activeDot={{ r: 5, strokeWidth: 0 }} 
        />
        <Line 
            type="monotone" 
            dataKey="selfConsumption" 
            name="Self Consumption"
            stroke="#22C55E" 
            strokeWidth={2}
            dot={false} 
            activeDot={{ r: 5, strokeWidth: 0 }} 
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default EfficiencyChart;
