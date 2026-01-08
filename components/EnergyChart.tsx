import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface EnergyChartProps {
  history: Array<{
    timestamp: string;
    production: number;
    consumption: number;
    soc: number;
  }>;
}

const EnergyChart: React.FC<EnergyChartProps> = ({ history }) => {
  // Format data for chart
  const data = history.map(h => ({
    time: new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    Production: h.production,
    Consumption: h.consumption,
    SOC: h.soc
  }));

  if (data.length === 0) {
    return <div className="flex items-center justify-center h-full text-slate-500">No historical data available yet.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorProd" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#EAB308" stopOpacity={0.8}/>
            <stop offset="95%" stopColor="#EAB308" stopOpacity={0}/>
          </linearGradient>
          <linearGradient id="colorCons" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8}/>
            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
        <XAxis 
          dataKey="time" 
          stroke="#94a3b8" 
          fontSize={12} 
          tickLine={false} 
          minTickGap={30}
        />
        <YAxis 
          stroke="#94a3b8" 
          fontSize={12} 
          tickLine={false} 
          label={{ value: 'Watts', angle: -90, position: 'insideLeft', fill: '#64748b' }} 
        />
        <YAxis 
          yAxisId="right"
          orientation="right" 
          stroke="#a855f7" 
          fontSize={12} 
          tickLine={false} 
          domain={[0, 100]}
          unit="%"
        />
        <Tooltip 
          contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#e2e8f0' }}
          itemStyle={{ color: '#e2e8f0' }}
        />
        <Legend />
        {/* Enable dots (r:0 to hide by default, but we use explicit true or r:3 to show them if needed. 
            However, area usually hides them. We'll enable small dots so single points are seen.) */}
        <Area type="monotone" dataKey="Production" stroke="#EAB308" fillOpacity={1} fill="url(#colorProd)" dot={{ r: 2 }} activeDot={{ r: 6 }} />
        <Area type="monotone" dataKey="Consumption" stroke="#3B82F6" fillOpacity={1} fill="url(#colorCons)" dot={{ r: 2 }} activeDot={{ r: 6 }} />
        <Area yAxisId="right" type="monotone" dataKey="SOC" stroke="#a855f7" fill="none" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default EnergyChart;