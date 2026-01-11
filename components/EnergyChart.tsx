
import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend, BarChart, Bar, Cell } from 'recharts';

interface EnergyChartProps {
  history: Array<{
    timestamp: string;
    production: number;
    consumption: number;
    grid?: number;
    battery?: number;
    is_aggregated?: boolean;
  }>;
  timeRange: string;
}

const EnergyChart: React.FC<EnergyChartProps> = ({ history, timeRange }) => {
  if (history.length === 0) {
    return <div className="flex items-center justify-center h-full text-slate-500">No historical data available yet.</div>;
  }

  const isAggregated = history[0]?.is_aggregated || ['week', 'month', 'year'].includes(timeRange);
  const unit = isAggregated ? 'kWh' : 'Watts';

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
            return d.toLocaleDateString([], { month: 'short' });
        case 'custom':
            return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
        default:
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  };

  const data = history.map(h => ({
    rawTime: h.timestamp,
    Production: h.production,
    Consumption: h.consumption,
    Grid: h.grid || 0,
    Battery: h.battery || 0
  }));

  // Calculate gradient offsets (for AreaChart)
  const gridMax = Math.max(...data.map((i) => i.Grid));
  const gridMin = Math.min(...data.map((i) => i.Grid));
  let gridOff = gridMax / (gridMax - gridMin) || 0;
  if (gridMax <= 0) gridOff = 0; else if (gridMin >= 0) gridOff = 1;

  const batMax = Math.max(...data.map((i) => i.Battery));
  const batMin = Math.min(...data.map((i) => i.Battery));
  let batOff = batMax / (batMax - batMin) || 0;
  if (batMax <= 0) batOff = 0; else if (batMin >= 0) batOff = 1;

  // --- CUSTOM TOOLTIP COMPONENT ---
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;

    const d = new Date(label);
    const dateStr = isAggregated 
        ? (timeRange === 'year' ? d.toLocaleDateString([], { month: 'long', year: 'numeric' }) : d.toLocaleDateString())
        : d.toLocaleString();

    return (
      <div className="bg-slate-900 border border-slate-600 p-3 rounded-lg shadow-2xl antialiased" style={{ boxShadow: '0 10px 30px -10px rgba(0,0,0,0.8)' }}>
        <p className="text-slate-400 font-semibold mb-2 border-b border-slate-700 pb-1 text-xs tracking-wide">
          {dateStr}
        </p>
        <div className="flex flex-col gap-1.5">
          {payload.map((entry: any, index: number) => {
            const val = entry.value;
            const name = entry.name;
            const absVal = Math.round(Math.abs(val) * 100) / 100;
            
            let labelText = name;
            let textColor = '#e2e8f0';

            if (name === 'Production') textColor = '#FACC15'; 
            else if (name === 'Consumption') textColor = '#60A5FA'; 
            else if (name === 'Battery') {
              textColor = '#C084FC'; 
              labelText = val > 0 ? "Discharged" : "Charged";
            } else if (name === 'Grid') {
              if (val > 0) { textColor = '#F87171'; labelText = "Imported"; }
              else { textColor = '#34D399'; labelText = "Exported"; }
            }

            return (
              <div key={index} className="flex items-center justify-between gap-6 text-xs">
                 <span style={{ color: textColor }} className="font-bold">
                    {labelText}:
                 </span>
                 <span className="text-slate-100 font-mono font-bold tracking-tight">
                    {absVal} {unit}
                 </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderLegend = (props: any) => {
    const { payload } = props;
    return (
      <div className="flex flex-wrap justify-center gap-6 mt-6 select-none">
        {payload.map((entry: any, index: number) => {
          let textColorClass = "text-slate-400";
          if (entry.value === 'Production') textColorClass = "text-yellow-400";
          if (entry.value === 'Consumption') textColorClass = "text-blue-400";
          if (entry.value === 'Battery') textColorClass = "text-purple-400";
          const isGrid = entry.value === 'Grid';
          return (
            <div key={`item-${index}`} className="flex items-center gap-2">
              <div 
                style={{ backgroundColor: entry.color }} 
                className={`w-3 h-3 rounded-full ${isGrid ? 'bg-gradient-to-r from-red-500 to-green-500' : ''}`}
              />
              <span className={`text-sm font-bold ${textColorClass} ${isGrid ? 'bg-clip-text text-transparent bg-gradient-to-r from-red-400 to-green-400' : ''}`}>
                {isGrid ? (isAggregated ? 'Grid Balance' : 'Grid Power') : entry.value}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  if (isAggregated) {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis dataKey="rawTime" tickFormatter={formatTick} stroke="#94a3b8" fontSize={11} tickLine={false} dy={10} />
          <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} label={{ value: 'kWh', angle: -90, position: 'insideLeft', fill: '#64748b' }} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#334155', opacity: 0.4 }} isAnimationActive={false} />
          <Legend content={renderLegend} />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
          
          <Bar dataKey="Production" fill="#EAB308" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Consumption" fill="#3B82F6" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Grid" radius={[4, 4, 4, 4]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.Grid > 0 ? '#EF4444' : '#10B981'} />
            ))}
          </Bar>
          <Bar dataKey="Battery" fill="#A855F7" radius={[4, 4, 4, 4]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

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
          <linearGradient id="colorBat" x1="0" y1="0" x2="0" y2="1">
            <stop offset={batOff} stopColor="#A855F7" stopOpacity={0.8} />
            <stop offset={batOff} stopColor="#A855F7" stopOpacity={0.8} />
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
          content={<CustomTooltip />} 
          cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }} 
          isAnimationActive={false}
        />
        
        <Legend content={renderLegend} />
        
        <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />

        <Area type="monotone" dataKey="Battery" stroke="#A855F7" fillOpacity={0.6} fill="url(#colorBat)" dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
        <Area type="monotone" dataKey="Production" stroke="#EAB308" fillOpacity={1} fill="url(#colorProd)" dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
        <Area type="monotone" dataKey="Consumption" stroke="#3B82F6" fillOpacity={1} fill="url(#colorCons)" dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
        <Area type="monotone" dataKey="Grid" stroke="url(#colorGrid)" fillOpacity={1} fill="url(#colorGrid)" dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default EnergyChart;
