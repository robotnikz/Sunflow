import React, { useMemo } from 'react';
import { InverterData, SystemConfig } from '../types';
import PowerFlow from './PowerFlow';
import EnergyChart from './EnergyChart';
import StatsCard from './StatsCard';
import { Euro, Zap, Sun, Battery, TrendingUp } from 'lucide-react';

interface DashboardProps {
  data: InverterData | null;
  config: SystemConfig;
  error: string | null;
}

const Dashboard: React.FC<DashboardProps> = ({ data, config, error }) => {
  if (!data) return null;

  // Calculations for Financials (Estimated based on current power for simplicity of realtime view)
  // In a real app, this would be calculated on the backend from historical sums.
  const currentSavingsHour = (data.power.pv / 1000) * config.costPerKwh; 
  const exportEarningsHour = data.power.grid < 0 ? (Math.abs(data.power.grid) / 1000) * config.feedInTariff : 0;
  
  // Power Flow Status strings
  const batteryStatus = data.battery.state === 'charging' 
    ? `Charging (${Math.round(data.power.battery)}W)` 
    : data.battery.state === 'discharging' 
      ? `Discharging (${Math.round(Math.abs(data.power.battery))}W)`
      : 'Idle';

  const gridStatus = data.power.grid > 0 
    ? `Importing ${Math.round(data.power.grid)}W`
    : `Exporting ${Math.round(Math.abs(data.power.grid))}W`;

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-200 p-4 rounded-lg">
          {error}
        </div>
      )}

      {/* Top Row: Power Flow Visualization & Quick Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Power Flow Diagram */}
        <div className="lg:col-span-2 bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl relative overflow-hidden">
          <h2 className="text-lg font-semibold text-slate-300 mb-6 flex items-center gap-2">
            <Zap className="text-yellow-500" size={20} />
            Live Power Flow
          </h2>
          <div className="h-[300px] flex items-center justify-center">
             <PowerFlow power={data.power} soc={data.battery.soc} />
          </div>
          
          {/* Legend/Status Text */}
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-8 text-xs font-medium text-slate-400">
             <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500"></span> Solar</span>
             <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span> Home</span>
             <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500"></span> Battery</span>
             <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-400"></span> Grid</span>
          </div>
        </div>

        {/* Right: Key Metrics */}
        <div className="space-y-6">
          <StatsCard 
            title="Battery SOC" 
            value={`${data.battery.soc}%`} 
            subValue={batteryStatus}
            icon={<Battery className={data.battery.soc < 20 ? "text-red-400" : "text-purple-400"} />}
            trend={data.battery.state === 'charging' ? 'up' : data.battery.state === 'discharging' ? 'down' : 'neutral'}
          />
          <StatsCard 
            title="Current Production" 
            value={`${(data.power.pv / 1000).toFixed(2)} kW`} 
            subValue="Solar Array"
            icon={<Sun className="text-yellow-400" />}
            highlight
          />
           <StatsCard 
            title="Grid Interaction" 
            value={`${(Math.abs(data.power.grid) / 1000).toFixed(2)} kW`} 
            subValue={gridStatus}
            icon={<Zap className={data.power.grid > 0 ? "text-red-400" : "text-green-400"} />}
            valueColor={data.power.grid > 0 ? "text-red-400" : "text-green-400"}
          />
        </div>
      </div>

      {/* Middle: Charts */}
      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-semibold text-slate-300 flex items-center gap-2">
            <TrendingUp className="text-blue-500" size={20} />
            Energy History (Last 24h)
          </h2>
        </div>
        <div className="h-[350px] w-full">
          <EnergyChart history={data.history} />
        </div>
      </div>

      {/* Bottom: Financial Estimates (Simplified) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
            <h3 className="text-slate-400 text-sm font-medium mb-1">Estimated Hourly Savings</h3>
            <div className="text-2xl font-bold text-green-400 flex items-baseline gap-1">
               {config.currency === 'EUR' ? '€' : '$'} {currentSavingsHour.toFixed(2)}
               <span className="text-sm text-slate-500 font-normal">/hr</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">Based on current solar usage vs grid import cost.</p>
         </div>
         <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
            <h3 className="text-slate-400 text-sm font-medium mb-1">Today's Production</h3>
            <div className="text-2xl font-bold text-yellow-400 flex items-baseline gap-1">
               {data.energy.today.production.toFixed(1)}
               <span className="text-sm text-slate-500 font-normal">kWh</span>
            </div>
         </div>
         <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
            <h3 className="text-slate-400 text-sm font-medium mb-1">Self Consumption</h3>
            <div className="text-2xl font-bold text-blue-400 flex items-baseline gap-1">
               {data.power.pv > 0 ? Math.round(((data.power.pv - Math.max(0, -data.power.grid)) / data.power.pv) * 100) : 0}
               <span className="text-sm text-slate-500 font-normal">%</span>
            </div>
         </div>
      </div>
    </div>
  );
};

export default Dashboard;
