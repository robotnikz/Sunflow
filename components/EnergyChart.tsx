import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';

interface EnergyChartProps {
  history: Array<{
    timestamp: string;
    production: number;
    consumption: number;
    grid?: number;
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
    Grid: h.grid || 0
  }));

  // Calculate gradient offset for Grid
  const gridMax = Math.max(...data.map((i) => i.Grid));
  const gridMin = Math.min(...data.map((i) => i.Grid));
  
  let gridOff = 0;
  if (gridMax <= 0) gridOff = 0;
  else if (gridMin >= 0) gridOff = 1;
  else gridOff = gridMax / (gridMax - gridMin);

  // Custom Legend to allow colored text
  const renderLegend = (props: any) => {
    const { payload } = props;
    
    return (
      <div className="flex flex-wrap justify-center gap-6 mt-6 select-none">
        {payload.map((entry: any, index: number) => {
          let textColorClass = "text-slate-400";
          if (entry.value === 'Production') textColorClass = "text-yellow-400";
          if (entry.value === 'Consumption') textColorClass = "text-blue-400";
          
          const isGrid = entry.value === 'Grid';

          return (
            <div key={`item-${index}`} className="flex items-center gap-2">
              <div 
                style={{ backgroundColor: entry.color }} 
                className={`w-3 h-3 rounded-full ${isGrid ? 'bg-gradient-to-r from-red-500 to-green-500' : ''}`}
              />
              <span className={`text-sm font-bold ${textColorClass} ${isGrid ? 'bg-clip-text text-transparent bg-gradient-to-r from-red-400 to-green-400' : ''}`}>
                {isGrid ? 'Grid Power' : entry.value}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
        <defs>
          <linearGradient id="colorProd" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#EAB308" stopOpacity={0.8}/>
            <stop offset="95%" stopColor="#EAB308" stopOpacity={0}/>
          </linearGradient>
          <linearGradient id="colorCons" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8}/>
            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
          </linearGradient>
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
        
        <Tooltip 
          contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#e2e8f0', borderRadius: '8px' }}
          itemStyle={{ color: '#e2e8f0' }}
          labelFormatter={(label) => new Date(label).toLocaleString()}
          formatter={(value: number, name: string) => {
              if (name === 'Grid') {
                  return [`${Math.abs(value)} W`, value > 0 ? "Importing" : "Exporting"];
              }
              return [`${value} W`, name];
          }}
        />
        
        <Legend content={renderLegend} />
        
        <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />

        <Area type="monotone" dataKey="Production" stroke="#EAB308" fillOpacity={1} fill="url(#colorProd)" dot={false} activeDot={{ r: 5 }} />
        <Area type="monotone" dataKey="Consumption" stroke="#3B82F6" fillOpacity={1} fill="url(#colorCons)" dot={false} activeDot={{ r: 5 }} />
        <Area type="monotone" dataKey="Grid" stroke="url(#colorGrid)" fillOpacity={1} fill="url(#colorGrid)" dot={false} activeDot={{ r: 5 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default EnergyChart;