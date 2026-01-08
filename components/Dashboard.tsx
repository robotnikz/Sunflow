import React, { useState, useEffect } from 'react';
import { InverterData, SystemConfig, TimeRange, HistoryData, RoiData } from '../types';
import PowerFlow from './PowerFlow';
import EnergyChart from './EnergyChart';
import BatteryChart from './BatteryChart';
import EfficiencyChart from './EfficiencyChart';
import StatsCard from './StatsCard';
import EnergyDonut from './EnergyDonut';
import BatteryWidget from './BatteryWidget';
import StatusTimeline from './StatusTimeline'; 
import AmortizationWidget from './AmortizationWidget';
import { getHistory, getRoiData } from '../services/api';
import { Sun, Zap, Home, PiggyBank, Calendar, ArrowRight, Battery, BarChart3, Leaf, TrendingUp } from 'lucide-react';

interface DashboardProps {
  data: InverterData | null;
  config: SystemConfig;
  error: string | null;
}

const Dashboard: React.FC<DashboardProps> = ({ data, config, error }) => {
  const [timeRange, setTimeRange] = useState<TimeRange>('day');
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [roiData, setRoiData] = useState<RoiData | null>(null);
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

  // Fetch ROI data separately (it might change less frequently but good to have)
  useEffect(() => {
    const fetchRoi = async () => {
        try {
            const rData = await getRoiData();
            setRoiData(rData);
        } catch(e) { console.error("ROI Fetch Error", e); }
    };
    fetchRoi();
    // Fetch ROI on load and then less frequently could be an option, but sticking to effect here is fine.
  }, []);

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

  // Helper Calculations
  const calculateCO2 = (kwh: number) => {
    // Approx 0.4kg CO2 per kWh grid mix saved
    return (kwh * 0.4).toFixed(1);
  };

  const getPeaks = (chartData: HistoryData['chart']) => {
    if (!chartData || chartData.length === 0) return { maxPv: 0, maxLoad: 0 };
    let maxPv = 0;
    let maxLoad = 0;
    chartData.forEach(d => {
        if (d.production > maxPv) maxPv = d.production;
        if (d.consumption > maxLoad) maxLoad = d.consumption;
    });
    return { maxPv, maxLoad };
  };

  if (!data) return null;

  const currencySymbol = config.currency === 'EUR' ? '€' : '$';
  const peaks = history ? getPeaks(history.chart) : { maxPv: 0, maxLoad: 0 };

  // SKELETON LOADER COMPONENT
  const SkeletonCard = ({ height = "h-64" }: { height?: string }) => (
    <div className={`bg-slate-800/50 rounded-2xl border border-slate-700/50 shadow-lg ${height} w-full animate-pulse flex flex-col p-6`}>
        <div className="h-5 w-32 bg-slate-700 rounded mb-6"></div>
        <div className="flex-1 bg-slate-700/30 rounded-xl"></div>
    </div>
  );

  return (
    <div className="space-y-6 pb-12">
      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-200 p-4 rounded-lg flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          {error}
        </div>
      )}

      {/* --- ROW 1: Realtime Power Flow & Status --- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Power Flow Diagram */}
        <div className="lg:col-span-2 bg-slate-800 rounded-2xl border border-slate-700 shadow-xl relative overflow-hidden flex flex-col h-full min-h-[450px]">
          <div className="absolute top-6 left-6 flex items-center gap-2 text-slate-300 font-semibold z-10">
             <div className="p-1.5 bg-slate-700/50 rounded-lg backdrop-blur">
                <Zap className="text-yellow-500" size={18} />
             </div>
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
            icon={<Sun className="text-yellow-400" size={24} />}
            highlight
          />
        </div>
      </div>

      {/* --- ROW 2: STATUS TIMELINE --- */}
      <div className="animate-fade-in">
        <StatusTimeline history={history?.chart || []} />
      </div>

      {/* --- ROW 3: Controls for Statistics --- */}
      <div className="flex flex-col bg-slate-800/60 backdrop-blur p-2 rounded-xl border border-slate-700/50 mt-4 gap-4 sticky top-[70px] z-20 shadow-lg">
        
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <h2 className="text-lg font-semibold text-slate-200 px-2 flex items-center gap-2">
                <Calendar size={18} className="text-blue-400"/>
                Statistics & Analysis
            </h2>
            <div className="flex flex-wrap bg-slate-900 rounded-lg p-1 border border-slate-700">
                {(['hour', 'day', 'week', 'month', 'year', 'custom'] as TimeRange[]).map((range) => (
                    <button
                        key={range}
                        onClick={() => setTimeRange(range)}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                            timeRange === range 
                            ? 'bg-slate-700 text-white shadow ring-1 ring-slate-600' 
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
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
                <span className="text-sm text-slate-400">Interval:</span>
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
                    className="bg-yellow-600 hover:bg-yellow-500 text-white text-sm font-medium px-4 py-1.5 rounded ml-2 transition-colors shadow-lg shadow-yellow-900/20"
                >
                    Apply
                </button>
            </div>
        )}
      </div>

      {/* --- ROW 4: Historical Data & Donuts --- */}
      {history && !loadingHist ? (
        <div className="animate-fade-in space-y-6">
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Financials, Environment & Peaks */}
                <div className="lg:col-span-1 space-y-6">
                    
                    {/* Financial Card */}
                    <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/5 blur-[50px] rounded-full pointer-events-none"></div>
                        <h3 className="text-slate-400 text-sm font-medium mb-6 flex items-center gap-2">
                            <PiggyBank size={16} className="text-green-400"/> Financial Impact ({timeRange})
                        </h3>
                        <div className="flex flex-col gap-6 relative z-10">
                            <div>
                                <span className="text-slate-500 text-xs uppercase tracking-wider font-bold">Total Benefit</span>
                                <div className="text-4xl font-bold text-green-400 tracking-tight">
                                    {currencySymbol} {(history.stats.costSaved + history.stats.earnings).toFixed(2)}
                                </div>
                                <div className="text-xs text-slate-500 mt-1">Saved Grid Costs + Feed-in Reward</div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-700">
                                <div>
                                    <span className="text-slate-500 text-xs block mb-0.5">Direct Savings</span>
                                    <div className="text-lg font-semibold text-slate-200">{currencySymbol} {history.stats.costSaved.toFixed(2)}</div>
                                </div>
                                <div>
                                    <span className="text-slate-500 text-xs block mb-0.5">Export Earnings</span>
                                    <div className="text-lg font-semibold text-slate-200">{currencySymbol} {history.stats.earnings.toFixed(2)}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* NEW: ROI / AMORTIZATION WIDGET */}
                    <AmortizationWidget roiData={roiData} currency={config.currency} />

                    {/* Environment & Peaks (New Feature) */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-slate-800 p-4 rounded-2xl border border-slate-700 shadow-lg">
                            <div className="flex items-center gap-2 mb-2 text-emerald-400">
                                <Leaf size={16} /> <span className="text-xs font-bold uppercase">CO₂ Saved</span>
                            </div>
                            <div className="text-2xl font-bold text-slate-100">
                                {calculateCO2(history.stats.production)} <span className="text-sm font-normal text-slate-500">kg</span>
                            </div>
                        </div>
                        <div className="bg-slate-800 p-4 rounded-2xl border border-slate-700 shadow-lg">
                            <div className="flex items-center gap-2 mb-2 text-yellow-400">
                                <TrendingUp size={16} /> <span className="text-xs font-bold uppercase">Peak PV</span>
                            </div>
                            <div className="text-2xl font-bold text-slate-100">
                                {(peaks.maxPv / 1000).toFixed(1)} <span className="text-sm font-normal text-slate-500">kW</span>
                            </div>
                        </div>
                    </div>

                    {/* Detailed Meters */}
                    <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
                        <h3 className="text-slate-400 text-sm font-medium mb-6 flex items-center gap-2">
                             <BarChart3 size={16} /> Energy Totals
                        </h3>
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
                    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg h-[400px] flex flex-col relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-xs text-slate-600 font-mono">Max Load: {(peaks.maxLoad).toFixed(0)}W</span>
                        </div>
                        <h3 className="text-slate-400 text-sm font-medium mb-6 flex items-center gap-2 shrink-0">
                             <Zap size={16}/> Power History
                        </h3>
                        <div className="flex-1 min-h-0 w-full">
                            <EnergyChart history={history.chart} />
                        </div>
                    </div>

                    {/* Battery SOC Chart */}
                    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg h-[250px] flex flex-col">
                        <h3 className="text-slate-400 text-sm font-medium mb-6 flex items-center gap-2 shrink-0">
                            <Battery size={16}/> Battery State of Charge
                        </h3>
                        <div className="flex-1 min-h-0 w-full">
                            <BatteryChart history={history.chart} />
                        </div>
                    </div>

                    {/* Efficiency Chart */}
                    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg h-[250px] flex flex-col">
                        <h3 className="text-slate-400 text-sm font-medium mb-6 flex items-center gap-2 shrink-0">
                            <BarChart3 size={16}/> Efficiency (Autonomy & Self-Consumption)
                        </h3>
                        <div className="flex-1 min-h-0 w-full">
                            <EfficiencyChart history={history.chart} />
                        </div>
                    </div>
                </div>
            </div>

        </div>
      ) : (
        // SKELETON LOADING STATE
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-pulse">
            <div className="lg:col-span-1 space-y-6">
                <SkeletonCard height="h-64" />
                <div className="grid grid-cols-2 gap-4">
                    <SkeletonCard height="h-24" />
                    <SkeletonCard height="h-24" />
                </div>
                <SkeletonCard height="h-48" />
            </div>
            <div className="lg:col-span-2 space-y-6">
                <SkeletonCard height="h-[400px]" />
                <SkeletonCard height="h-[250px]" />
                <SkeletonCard height="h-[250px]" />
            </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;