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
      <div className="flex justify-center gap-6 mt-8 select-none">
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

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={history} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
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
        />
        <Legend content={renderLegend} />
        
        <Line 
            type="monotone" 
            dataKey="autonomy" 
            name="Autonomy"
            stroke="#3B82F6" 
            strokeWidth={2}
            dot={false} 
            activeDot={{ r: 5 }} 
        />
        <Line 
            type="monotone" 
            dataKey="selfConsumption" 
            name="Self Consumption"
            stroke="#22C55E" 
            strokeWidth={2}
            dot={false} 
            activeDot={{ r: 5 }} 
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default EfficiencyChart;