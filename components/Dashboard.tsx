import React, { useState, useEffect } from 'react';
import { InverterData, SystemConfig, TimeRange, HistoryData } from '../types';
import PowerFlow from './PowerFlow';
import EnergyChart from './EnergyChart';
import BatteryChart from './BatteryChart';
import EfficiencyChart from './EfficiencyChart';
import StatsCard from './StatsCard';
import EnergyDonut from './EnergyDonut';
import BatteryWidget from './BatteryWidget';
import StatusTimeline from './StatusTimeline'; 
import { getHistory } from '../services/api';
import { Sun, Zap, Home, PiggyBank, Calendar, ArrowRight, Battery, BarChart3 } from 'lucide-react';

interface DashboardProps {
  data: InverterData | null;
  config: SystemConfig;
  error: string | null;
}

const Dashboard: React.FC<DashboardProps> = ({ data, config, error }) => {
  const [timeRange, setTimeRange] = useState<TimeRange>('day');
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);
  
  // Custom Date Range State
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    fetchHistory();
    // Refresh history every 60s
    const interval = setInterval(fetchHistory, 60000); 
    return () => clearInterval(interval);
  }, [timeRange, startDate, endDate]); 

  const fetchHistory = async () => {
    if (timeRange === 'custom' && (!startDate || !endDate)) return;

    setLoadingHist(true);
    try {
      const hist = await getHistory(timeRange, startDate, endDate);
      setHistory(hist);
    } catch (e) {
      console.error("History fetch failed", e);
    } finally {
      setLoadingHist(false);
    }
  };

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
        <div className="lg:col-span-2 bg-slate-800 rounded-2xl border border-slate-700 shadow-xl relative overflow-hidden flex flex-col h-[450px]">
          <div className="absolute top-4 left-6 flex items-center gap-2 text-slate-300 font-semibold z-10">
             <Zap className="text-yellow-500" size={20} />
             Live Power Flow
          </div>
          {/* Centering Wrapper */}
          <div className="flex-1 w-full flex items-center justify-center p-4">
             <PowerFlow power={data.power} soc={data.battery.soc} />
          </div>
        </div>

        {/* Right: Realtime Stats Column */}
        <div className="flex flex-col gap-4">
          <BatteryWidget 
            soc={data.battery.soc}
            power={data.power.battery}
            state={data.battery.state}
          />
          
          {/* Realtime Efficiency Donuts */}
          <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800 rounded-2xl p-2 border border-slate-700 shadow-lg h-36">
                  <EnergyDonut 
                      percentage={data.autonomy} 
                      label="Autonomy" 
                      color="#3b82f6" 
                      small
                  />
              </div>
              <div className="bg-slate-800 rounded-2xl p-2 border border-slate-700 shadow-lg h-36">
                  <EnergyDonut 
                      percentage={data.selfConsumption} 
                      label="Self Cons." 
                      color="#22c55e" 
                      small
                  />
              </div>
          </div>

          <StatsCard 
            title="PV Power" 
            value={`${(data.power.pv / 1000).toFixed(2)} kW`} 
            subValue="Current Output"
            icon={<Sun className="text-yellow-400" />}
            highlight
          />
        </div>
      </div>

      {/* --- ROW 2: STATUS TIMELINE --- */}
      <div className="animate-fade-in">
        <StatusTimeline history={history?.chart || []} />
      </div>

      {/* --- ROW 3: Controls for Statistics --- */}
      <div className="flex flex-col bg-slate-800/50 p-2 rounded-xl border border-slate-700/50 mt-4 gap-4">
        
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <h2 className="text-lg font-semibold text-slate-200 px-2 flex items-center gap-2">
                <Calendar size={18} className="text-blue-400"/>
                Statistics & Savings
            </h2>
            <div className="flex flex-wrap bg-slate-900 rounded-lg p-1">
                {(['hour', 'day', 'week', 'month', 'year', 'custom'] as TimeRange[]).map((range) => (
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

        {/* Custom Date Range Picker */}
        {timeRange === 'custom' && (
            <div className="flex flex-col sm:flex-row items-center justify-end gap-3 bg-slate-900/50 p-3 rounded-lg border border-slate-700/50 animate-fade-in">
                <span className="text-sm text-slate-400">Select Interval:</span>
                <input 
                    type="date" 
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="bg-slate-800 border border-slate-600 text-white text-sm rounded px-3 py-1.5 focus:border-yellow-500 focus:outline-none"
                />
                <ArrowRight size={16} className="text-slate-500" />
                <input 
                    type="date" 
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="bg-slate-800 border border-slate-600 text-white text-sm rounded px-3 py-1.5 focus:border-yellow-500 focus:outline-none"
                />
                <button 
                    onClick={fetchHistory}
                    className="bg-yellow-600 hover:bg-yellow-500 text-white text-sm font-medium px-4 py-1.5 rounded ml-2 transition-colors"
                >
                    Apply
                </button>
            </div>
        )}
      </div>

      {/* --- ROW 4: Historical Data & Donuts --- */}
      {history ? (
        <div className="animate-fade-in space-y-6">
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Financials & Meters */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                        <h3 className="text-slate-400 text-sm font-medium mb-4 flex items-center gap-2">
                            <PiggyBank size={16} /> Estimated Savings ({timeRange})
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

                    <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                        <h3 className="text-slate-400 text-sm font-medium mb-4">Energy Meters</h3>
                        <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                            <div>
                                <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Sun size={12}/> Solar Yield</div>
                                <div className="text-xl font-bold text-yellow-400">{history.stats.production.toFixed(2)} <span className="text-xs text-slate-500">kWh</span></div>
                            </div>
                            <div>
                                <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Home size={12}/> Consumption</div>
                                <div className="text-xl font-bold text-blue-400">{history.stats.consumption.toFixed(2)} <span className="text-xs text-slate-500">kWh</span></div>
                            </div>
                            <div>
                                <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Zap size={12}/> Imported</div>
                                <div className="text-xl font-bold text-red-400">{history.stats.imported.toFixed(2)} <span className="text-xs text-slate-500">kWh</span></div>
                            </div>
                            <div>
                                <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Zap size={12}/> Exported</div>
                                <div className="text-xl font-bold text-green-400">{history.stats.exported.toFixed(2)} <span className="text-xs text-slate-500">kWh</span></div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Charts */}
                <div className="lg:col-span-2 flex flex-col gap-6">
                    
                    {/* Main Power Chart */}
                    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg h-[400px]">
                        <h3 className="text-slate-400 text-sm font-medium mb-4 flex items-center gap-2">
                             <Zap size={16}/> Power History
                        </h3>
                        <EnergyChart history={history.chart} />
                    </div>

                    {/* Battery SOC Chart */}
                    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg h-[250px]">
                        <h3 className="text-slate-400 text-sm font-medium mb-4 flex items-center gap-2">
                            <Battery size={16}/> Battery State of Charge
                        </h3>
                        <BatteryChart history={history.chart} />
                    </div>

                    {/* Efficiency Chart */}
                    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg h-[250px]">
                        <h3 className="text-slate-400 text-sm font-medium mb-4 flex items-center gap-2">
                            <BarChart3 size={16}/> Efficiency (Autonomy & Self-Consumption)
                        </h3>
                        <EfficiencyChart history={history.chart} />
                    </div>
                </div>
            </div>

        </div>
      ) : (
        <div className="h-64 flex items-center justify-center text-slate-500">
            {loadingHist ? <span className="animate-pulse">Loading historical data...</span> : "Select a range to view data."}
        </div>
      )}
    </div>
  );
};

export default Dashboard;