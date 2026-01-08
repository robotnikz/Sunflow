import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface BatteryChartProps {
  history: Array<{
    timestamp: string;
    soc: number;
  }>;
}

const BatteryChart: React.FC<BatteryChartProps> = ({ history }) => {
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
          contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#e2e8f0', borderRadius: '8px' }}
          labelFormatter={(label) => new Date(label).toLocaleString()}
          formatter={(value: number) => [`${value}%`, 'State of Charge']}
        />
        <Area 
            type="monotone" 
            dataKey="soc" 
            stroke="#10B981" 
            strokeWidth={2}
            fill="url(#colorSoc)" 
            dot={false} 
            activeDot={{ r: 5 }} 
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default BatteryChart;