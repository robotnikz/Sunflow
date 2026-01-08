import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';

interface EnergyChartProps {
  history: Array<{
    timestamp: string;
    production: number;
    consumption: number;
    soc: number;
    grid?: number; // Optional as old data might miss it temporarily before reload
  }>;
}

const EnergyChart: React.FC<EnergyChartProps> = ({ history }) => {
  if (history.length === 0) {
    return <div className="flex items-center justify-center h-full text-slate-500">No historical data available yet.</div>;
  }

  // Smart Date Formatting
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

  const data = history.map(h => ({
    rawTime: h.timestamp,
    Production: h.production,
    Consumption: h.consumption,
    SOC: h.soc,
    Grid: h.grid || 0
  }));

  // Calculate gradient offset for Grid (Split between positive/Red and negative/Green)
  const gridMax = Math.max(...data.map((i) => i.Grid));
  const gridMin = Math.min(...data.map((i) => i.Grid));
  
  let gridOff = 0;
  if (gridMax <= 0) gridOff = 0;
  else if (gridMin >= 0) gridOff = 1;
  else gridOff = gridMax / (gridMax - gridMin);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
        <defs>
          <linearGradient id="colorProd" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#EAB308" stopOpacity={0.8}/>
            <stop offset="95%" stopColor="#EAB308" stopOpacity={0}/>
          </linearGradient>
          <linearGradient id="colorCons" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8}/>
            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
          </linearGradient>
          
          {/* Split Gradient for Grid: Top (Positive/Import) is Red, Bottom (Negative/Export) is Green */}
          <linearGradient id="colorGrid" x1="0" y1="0" x2="0" y2="1">
            <stop offset={gridOff} stopColor="#EF4444" stopOpacity={0.8} />
            <stop offset={gridOff} stopColor="#10B981" stopOpacity={0.8} />
          </linearGradient>
        </defs>
        
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
        
        <XAxis 
          dataKey="rawTime" 
          tickFormatter={formatTick}
          stroke="#94a3b8" 
          fontSize={11} 
          tickLine={false} 
          minTickGap={40}
          dy={10}
        />
        
        <YAxis 
          stroke="#94a3b8" 
          fontSize={11} 
          tickLine={false} 
          label={{ value: 'Watts', angle: -90, position: 'insideLeft', fill: '#64748b' }} 
        />
        
        <YAxis 
          yAxisId="right"
          orientation="right" 
          stroke="#a855f7" 
          fontSize={11} 
          tickLine={false} 
          domain={[0, 100]}
          unit="%"
        />
        
        <Tooltip 
          contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#e2e8f0', borderRadius: '8px' }}
          itemStyle={{ color: '#e2e8f0' }}
          labelFormatter={(label) => new Date(label).toLocaleString()}
          formatter={(value: number, name: string) => {
              if (name === 'Grid') {
                  return [`${Math.abs(value)} W`, value > 0 ? "Grid Import" : "Grid Export"];
              }
              return [`${value} ${name === 'SOC' ? '%' : 'W'}`, name];
          }}
        />
        
        <Legend 
          verticalAlign="bottom" 
          height={36} 
          wrapperStyle={{ paddingTop: '20px' }}
          iconType="circle"
        />
        
        <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />

        <Area type="monotone" dataKey="Production" stroke="#EAB308" fillOpacity={1} fill="url(#colorProd)" dot={false} activeDot={{ r: 5 }} />
        <Area type="monotone" dataKey="Consumption" stroke="#3B82F6" fillOpacity={1} fill="url(#colorCons)" dot={false} activeDot={{ r: 5 }} />
        
        {/* Grid Area with Split Colors */}
        <Area type="monotone" dataKey="Grid" stroke="url(#colorGrid)" fillOpacity={1} fill="url(#colorGrid)" dot={false} activeDot={{ r: 5 }} />
        
        <Area yAxisId="right" type="monotone" dataKey="SOC" stroke="#a855f7" fill="none" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default EnergyChart;