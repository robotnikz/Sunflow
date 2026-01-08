import React, { useState, useEffect } from 'react';
import { InverterData, SystemConfig, TimeRange, HistoryData } from '../types';
import PowerFlow from './PowerFlow';
import EnergyChart from './EnergyChart';
import StatsCard from './StatsCard';
import EnergyDonut from './EnergyDonut';
import BatteryWidget from './BatteryWidget'; // Import new widget
import { getHistory } from '../services/api';
import { Sun, Zap, Home, PiggyBank, Calendar } from 'lucide-react';

interface DashboardProps {
  data: InverterData | null;
  config: SystemConfig;
  error: string | null;
}

const Dashboard: React.FC<DashboardProps> = ({ data, config, error }) => {
  const [timeRange, setTimeRange] = useState<TimeRange>('day');
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);

  // Fetch history when range changes or initial load
  useEffect(() => {
    const fetchHistory = async () => {
      setLoadingHist(true);
      try {
        const hist = await getHistory(timeRange);
        setHistory(hist);
      } catch (e) {
        console.error("History fetch failed", e);
      } finally {
        setLoadingHist(false);
      }
    };
    fetchHistory();
  }, [timeRange, data?.energy.today.production]); // Refetch if today's prod changes (polling)

  if (!data) return null;

  const currencySymbol = config.currency === 'EUR' ? '€' : '$';

  return (
    <div className="space-y-6 pb-12">
      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-200 p-4 rounded-lg">
          {error}
        </div>
      )}

      {/* --- ROW 1: Realtime Power Flow & Status --- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Power Flow Diagram */}
        <div className="lg:col-span-2 bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-xl relative overflow-hidden">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-slate-300 flex items-center gap-2">
                <Zap className="text-yellow-500" size={20} />
                Live Power Flow
            </h2>
          </div>
          <div className="h-[300px] flex items-center justify-center">
             <PowerFlow power={data.power} soc={data.battery.soc} />
          </div>
        </div>

        {/* Right: Realtime Stats Column */}
        <div className="flex flex-col gap-4">
          
          {/* NEW VISUAL BATTERY WIDGET REPLACES STATS CARD */}
          <BatteryWidget 
            soc={data.battery.soc}
            power={data.power.battery}
            state={data.battery.state}
          />

          <StatsCard 
            title="PV Power" 
            value={`${(data.power.pv / 1000).toFixed(2)} kW`} 
            subValue="Current Output"
            icon={<Sun className="text-yellow-400" />}
            highlight
          />
           <StatsCard 
            title="Grid Power" 
            value={`${(Math.abs(data.power.grid) / 1000).toFixed(2)} kW`} 
            subValue={data.power.grid > 0 ? "Importing" : "Exporting"}
            icon={<Zap className={data.power.grid > 0 ? "text-red-400" : "text-green-400"} />}
            valueColor={data.power.grid > 0 ? "text-red-400" : "text-green-400"}
          />
        </div>
      </div>

      {/* --- ROW 2: Controls for Statistics --- */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-slate-800/50 p-2 rounded-xl border border-slate-700/50">
        <h2 className="text-lg font-semibold text-slate-200 px-2 flex items-center gap-2">
            <Calendar size={18} className="text-blue-400"/>
            Statistics & Savings
        </h2>
        <div className="flex bg-slate-900 rounded-lg p-1">
            {(['hour', 'day', 'week', 'month', 'year'] as TimeRange[]).map((range) => (
                <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                        timeRange === range 
                        ? 'bg-slate-700 text-white shadow' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                >
                    {range.charAt(0).toUpperCase() + range.slice(1)}
                </button>
            ))}
        </div>
      </div>

      {/* --- ROW 3: Historical Data & Donuts --- */}
      {history ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
            
            {/* Left: Financials & Meters Grid */}
            <div className="lg:col-span-1 space-y-6">
                {/* Financial Card */}
                <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                    <h3 className="text-slate-400 text-sm font-medium mb-4 flex items-center gap-2">
                        <PiggyBank size={16} /> Estimated Savings
                    </h3>
                    <div className="flex flex-col gap-6">
                        <div>
                            <span className="text-slate-500 text-xs uppercase tracking-wider">Total Savings</span>
                            <div className="text-4xl font-bold text-green-400">
                                {currencySymbol} {(history.stats.costSaved + history.stats.earnings).toFixed(2)}
                            </div>
                            <div className="text-xs text-slate-500 mt-1">Avoided Cost + Feed-in</div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-700">
                             <div>
                                <span className="text-slate-500 text-xs">Direct Savings</span>
                                <div className="text-lg font-semibold text-slate-200">{currencySymbol} {history.stats.costSaved.toFixed(2)}</div>
                             </div>
                             <div>
                                <span className="text-slate-500 text-xs">Export Earnings</span>
                                <div className="text-lg font-semibold text-slate-200">{currencySymbol} {history.stats.earnings.toFixed(2)}</div>
                             </div>
                        </div>
                    </div>
                </div>

                {/* Energy Detail Grid */}
                <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                    <h3 className="text-slate-400 text-sm font-medium mb-4">Energy Meters ({timeRange})</h3>
                    <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                        <div>
                            <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Sun size={12}/> Solar Yield</div>
                            <div className="text-xl font-bold text-yellow-400">{history.stats.production.toFixed(1)} <span className="text-xs text-slate-500">kWh</span></div>
                        </div>
                        <div>
                            <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Home size={12}/> Consumption</div>
                            <div className="text-xl font-bold text-blue-400">{history.stats.consumption.toFixed(1)} <span className="text-xs text-slate-500">kWh</span></div>
                        </div>
                        <div>
                            <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Zap size={12}/> Imported</div>
                            <div className="text-xl font-bold text-red-400">{history.stats.imported.toFixed(1)} <span className="text-xs text-slate-500">kWh</span></div>
                        </div>
                        <div>
                            <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Zap size={12}/> Exported</div>
                            <div className="text-xl font-bold text-green-400">{history.stats.exported.toFixed(1)} <span className="text-xs text-slate-500">kWh</span></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Middle: Donuts */}
            <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 shadow-lg">
                    <EnergyDonut 
                        percentage={history.stats.autonomy} 
                        label="Autonomy" 
                        subLabel="Self-powered vs. Grid"
                        color="#3b82f6" // blue
                    />
                </div>
                <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 shadow-lg">
                     <EnergyDonut 
                        percentage={history.stats.selfConsumption} 
                        label="Self Consumption" 
                        subLabel="Consumed vs. Exported"
                        color="#22c55e" // green
                    />
                </div>
                
                {/* Chart spanning full width of this column section */}
                <div className="md:col-span-2 bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg h-[350px]">
                     <h3 className="text-slate-400 text-sm font-medium mb-4">Power History</h3>
                     <EnergyChart history={history.chart} />
                </div>
            </div>

        </div>
      ) : (
        <div className="h-64 flex items-center justify-center text-slate-500">
            {loadingHist ? <span className="animate-pulse">Loading historical data...</span> : "No data available."}
        </div>
      )}
    </div>
  );
};

export default Dashboard;