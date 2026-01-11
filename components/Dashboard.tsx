
import React, { useState, useEffect } from 'react';
import { InverterData, SystemConfig, TimeRange, HistoryData, RoiData, ForecastData, BatteryHealthData } from '../types';
import PowerFlow from './PowerFlow';
import EnergyChart from './EnergyChart';
import BatteryChart from './BatteryChart';
import EfficiencyChart from './EfficiencyChart';
import EnergyDonut from './EnergyDonut';
import BatteryWidget from './BatteryWidget';
import StatusTimeline from './StatusTimeline'; 
import AmortizationWidget from './AmortizationWidget';
import WeatherWidget from './WeatherWidget';
import SmartRecommendations from './SmartRecommendations';
import BatteryHealthWidget from './BatteryHealthWidget';
import { getHistory, getRoiData, getForecast, getBatteryHealth } from '../services/api';
import { Sun, Zap, Home, PiggyBank, Calendar, ArrowRight, Battery, BarChart3, Leaf, TrendingUp, ShieldCheck, Download, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';

interface DashboardProps {
  data: InverterData | null;
  config: SystemConfig;
  error: string | null;
  refreshTrigger: number; // Increment this to force reload of historical/ROI data
}

export interface WeatherData {
    current: {
      temp: number;
      weatherCode: number;
      isDay: boolean; 
    };
}

// SKELETON LOADER COMPONENT (Moved outside for Performance)
const SkeletonCard = ({ height = "h-64" }: { height?: string }) => (
  <div className={`bg-slate-800/50 rounded-2xl border border-slate-700/50 shadow-lg ${height} w-full animate-pulse flex flex-col p-6`}>
      <div className="h-5 w-32 bg-slate-700 rounded mb-6"></div>
      <div className="flex-1 bg-slate-700/30 rounded-xl"></div>
  </div>
);

const Dashboard: React.FC<DashboardProps> = ({ data, config, error, refreshTrigger }) => {
  const [timeRange, setTimeRange] = useState<TimeRange>('day');
  const [timeOffset, setTimeOffset] = useState<number>(0);
  
  // Main History State
  const [history, setHistory] = useState<(HistoryData & { windowStart?: string, windowEnd?: string }) | null>(null);
  const [statusHistory, setStatusHistory] = useState<HistoryData | null>(null);

  const [roiData, setRoiData] = useState<RoiData | null>(null);
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [batteryHealth, setBatteryHealth] = useState<BatteryHealthData | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);
  
  const [solcastRateLimited, setSolcastRateLimited] = useState(false);
  
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Handle preset clicks: set range and reset offset
  const handleTimeRangeSelect = (range: TimeRange) => {
      setTimeRange(range);
      setTimeOffset(0);
  };

  // 1. Fetch Main History (Charts, Stats)
  useEffect(() => {
    fetchHistory();
    // Refresh history every 60s if viewing the current period (offset 0)
    const interval = setInterval(() => {
        if (timeOffset === 0) fetchHistory();
    }, 60000); 
    return () => clearInterval(interval);
  }, [timeRange, timeOffset, startDate, endDate, refreshTrigger]); 

  // 2. Fetch Status History (Fixed 24h for Timeline)
  useEffect(() => {
    const fetchStatusHistory = async () => {
        try {
            const hist = await getHistory('day', undefined, undefined, 0);
            setStatusHistory(hist);
        } catch (e) {
            console.error("Status history fetch failed", e);
        }
    };
    
    fetchStatusHistory();
    const interval = setInterval(fetchStatusHistory, 60000); 
    return () => clearInterval(interval);
  }, [refreshTrigger]);

  useEffect(() => {
    const fetchExpensiveData = async () => {
        try {
            const rData = await getRoiData();
            setRoiData(rData);
        } catch(e) { console.error("ROI Fetch Error", e); }
        
        try {
             const bData = await getBatteryHealth();
             setBatteryHealth(bData);
        } catch(e) { console.error("Battery Health Fetch Error", e); }
    };
    
    fetchExpensiveData(); 
    const interval = setInterval(fetchExpensiveData, 10 * 60 * 1000); 
    return () => clearInterval(interval);
  }, [refreshTrigger]); 

  const POLL_INTERVAL = 96 * 60 * 1000; 

  useEffect(() => {
    if (!config.solcastApiKey) {
        setForecast(null);
        return;
    }
    const fetchFC = async () => {
        try {
            const fc = await getForecast();
            setForecast(fc);
            setSolcastRateLimited(false);
        } catch(e: any) { 
            if (e.message && e.message.includes('429')) {
                setSolcastRateLimited(true);
            }
        }
    };
    fetchFC();
    const interval = setInterval(fetchFC, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [config.solcastApiKey, refreshTrigger]);

  useEffect(() => {
    if (!config.latitude || !config.longitude) return;
    const fetchWeather = async () => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${config.latitude}&longitude=${config.longitude}&current=temperature_2m,weather_code,is_day&timezone=auto&forecast_days=1`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Weather API failed");
        const wData = await res.json();
        setWeather({
            current: {
                temp: wData.current.temperature_2m,
                weatherCode: wData.current.weather_code,
                isDay: wData.current.is_day === 1
            }
        });
      } catch (err) { console.error("Failed to load weather", err); }
    };
    fetchWeather();
    const interval = setInterval(fetchWeather, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [config.latitude, config.longitude]);

  const fetchHistory = async () => {
    if (timeRange === 'custom' && (!startDate || !endDate)) return;
    setLoadingHist(true);
    try {
      const hist = await getHistory(timeRange, startDate, endDate, timeOffset);
      setHistory(hist);
    } catch (e) { console.error("History fetch failed", e); }
    finally { setLoadingHist(false); }
  };

  const handleDownloadCSV = () => {
      if (!history || !history.chart) return;
      const headers = ['Timestamp', 'Production (W)', 'Consumption (W)', 'Grid (W)', 'Battery (W)', 'SOC (%)', 'Autonomy (%)', 'SelfConsumption (%)'];
      const rows = history.chart.map(row => [row.timestamp, row.production, row.consumption, row.grid, row.battery, row.soc, row.autonomy, row.selfConsumption]);
      const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.map(e => e.join(",")).join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `sunflow_data_${timeRange}_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const calculateCO2 = (kwh: number) => (kwh * 0.4).toFixed(1);

  const getPeaks = (chartData: HistoryData['chart']) => {
    if (!chartData || chartData.length === 0) return { maxPv: 0, maxLoad: 0 };
    let maxPv = 0, maxLoad = 0;
    chartData.forEach(d => {
        if (d.production > maxPv) maxPv = d.production;
        if (d.consumption > maxLoad) maxLoad = d.consumption;
    });
    return { maxPv, maxLoad };
  };

  // Human Readable Label for the currently viewed period
  const getPeriodLabel = () => {
    if (!history?.windowStart) return 'Loading...';
    if (timeRange === 'custom') return `${startDate} - ${endDate}`;
    
    const d = new Date(history.windowStart);
    switch(timeRange) {
        case 'hour':
            return d.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' }) + ', ' + d.getHours() + ':00';
        case 'day':
            return d.toLocaleDateString([], { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
        case 'week':
            const end = new Date(history.windowEnd!);
            end.setDate(end.getDate() - 1); // Display week range correctly
            return `Week ${d.toLocaleDateString([], { day: '2-digit', month: 'short' })} - ${end.toLocaleDateString([], { day: '2-digit', month: 'short' })}`;
        case 'month':
            return d.toLocaleDateString([], { month: 'long', year: 'numeric' });
        case 'year':
            return d.getFullYear().toString();
        default:
            return '';
    }
  };

  if (!data) return null;

  const currencySymbol = config.currency === 'EUR' ? '€' : config.currency === 'GBP' ? '£' : '$';
  const peaks = history ? getPeaks(history.chart) : { maxPv: 0, maxLoad: 0 };

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
        {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-200 p-4 rounded-lg flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            {error}
            </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-slate-800 rounded-2xl border border-slate-700 shadow-xl relative overflow-hidden flex flex-col min-h-[500px]">
                <div className="absolute top-6 left-6 flex items-center gap-2 text-slate-300 font-semibold z-10">
                    <div className="p-1.5 bg-slate-700/50 rounded-lg backdrop-blur">
                        <Zap className="text-yellow-500" size={18} />
                    </div>
                    Live Power Flow
                </div>
                <div className="flex-1 w-full flex items-center justify-center p-4">
                    <PowerFlow power={data.power} soc={data.battery.soc} />
                </div>
            </div>

            <div className="flex flex-col gap-6 min-h-[500px]">
                <div className="flex-1 min-h-[220px]">
                    <SmartRecommendations 
                        power={data.power}
                        soc={data.battery.soc}
                        forecast={forecast}
                        solcastRateLimited={solcastRateLimited}
                        todayProduction={data.energy.today.production}
                        isDay={weather?.current.isDay ?? true} 
                        batteryCapacity={config.batteryCapacity || 10}
                        appliances={config.appliances || []}
                        hasSolcastKey={!!config.solcastApiKey}
                    />
                </div>

                <div className="flex-1 min-h-[220px]">
                    <BatteryWidget 
                        soc={data.battery.soc}
                        power={data.power.battery}
                        state={data.battery.state}
                        capacity={config.batteryCapacity || 10}
                    />
                </div>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <AmortizationWidget roiData={roiData} currency={config.currency} />
            <div className="h-full">
                <WeatherWidget 
                    config={config} 
                    forecast={forecast}
                    weatherData={weather}
                    solcastRateLimited={solcastRateLimited}
                />
            </div>
            <div className="grid grid-rows-2 gap-4 h-full">
                <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 shadow-lg flex items-center justify-between relative overflow-hidden group hover:border-blue-500/30 transition-colors">
                    <div className="z-10 pl-2 flex flex-col justify-center">
                        <div className="flex items-center gap-2 mb-1">
                            <div className="p-1.5 bg-blue-500/10 rounded-lg text-blue-400">
                                <ShieldCheck size={18} />
                            </div>
                            <span className="text-slate-300 font-bold text-sm tracking-wide">AUTONOMY</span>
                        </div>
                        <div className="text-xs text-slate-500 pl-1">Grid Independence</div>
                    </div>
                    <div className="h-24 w-24 mr-2">
                        <EnergyDonut percentage={data.autonomy} color="#3b82f6" />
                    </div>
                </div>
                <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 shadow-lg flex items-center justify-between relative overflow-hidden group hover:border-emerald-500/30 transition-colors">
                    <div className="z-10 pl-2 flex flex-col justify-center">
                        <div className="flex items-center gap-2 mb-1">
                            <div className="p-1.5 bg-emerald-500/10 rounded-lg text-emerald-400">
                                <Leaf size={18} />
                            </div>
                            <span className="text-slate-300 font-bold text-sm tracking-wide">USAGE</span>
                        </div>
                        <div className="text-xs text-slate-500 pl-1">Solar Utilization</div>
                    </div>
                    <div className="h-24 w-24 mr-2">
                        <EnergyDonut percentage={data.selfConsumption} color="#22c55e" />
                    </div>
                </div>
            </div>
        </div>

        <StatusTimeline history={statusHistory?.chart || []} />

        {/* --- SECTION 4: HISTORICAL ANALYSIS CONTROLS --- */}
        <div className="flex flex-col bg-slate-800/60 backdrop-blur p-2 rounded-xl border border-slate-700/50 mt-4 gap-4 sticky top-[70px] z-20 shadow-lg">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex flex-col">
                    <h2 className="text-lg font-semibold text-slate-200 px-2 flex items-center gap-2">
                        <Calendar size={18} className="text-blue-400"/>
                        Statistics & Analysis
                    </h2>
                    <div className="px-2 text-xs text-slate-500 font-medium flex items-center gap-1.5">
                        {getPeriodLabel()}
                        {timeOffset !== 0 && (
                            <button 
                                onClick={() => setTimeOffset(0)}
                                className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors bg-blue-900/30 px-1.5 py-0.5 rounded border border-blue-800/50"
                            >
                                <RotateCcw size={10}/> Jump to Now
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex wrap items-center gap-2">
                    <div className="flex items-center bg-slate-900 rounded-lg p-1 border border-slate-700">
                        <button 
                            disabled={timeRange === 'custom'}
                            onClick={() => setTimeOffset(prev => prev - 1)}
                            className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
                        >
                            <ChevronLeft size={20} />
                        </button>
                        
                        <div className="flex flex-wrap mx-1 bg-slate-800 rounded-md p-0.5">
                            {(['hour', 'day', 'week', 'month', 'year', 'custom'] as TimeRange[]).map((range) => (
                                <button
                                    key={range}
                                    onClick={() => handleTimeRangeSelect(range)}
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

                        <button 
                            disabled={timeRange === 'custom' || timeOffset >= 0}
                            onClick={() => setTimeOffset(prev => prev + 1)}
                            className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
                        >
                            <ChevronRight size={20} />
                        </button>
                    </div>
                    
                    <button 
                        onClick={handleDownloadCSV}
                        className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg border border-slate-700 transition-colors"
                        title="Export CSV"
                    >
                        <Download size={18} />
                    </button>
                </div>
            </div>

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

        {/* --- SECTION 5: HISTORICAL DATA GRIDS --- */}
        {history && !loadingHist ? (
            <div className="animate-fade-in space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/5 blur-[50px] rounded-full pointer-events-none"></div>
                            <h3 className="text-slate-400 text-sm font-medium mb-6 flex items-center gap-2">
                                <PiggyBank size={16} className="text-green-400"/> Financial Impact
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
                        <div className="h-[300px]">
                            <BatteryHealthWidget 
                                data={batteryHealth} 
                                nominalCapacity={config.batteryCapacity || 10} 
                            />
                        </div>
                    </div>

                    <div className="lg:col-span-2 flex flex-col gap-6">
                        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg h-[400px] flex flex-col relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-100 transition-opacity">
                                <span className="text-xs text-slate-600">Max Load: {(peaks.maxLoad).toFixed(0)}W</span>
                            </div>
                            <h3 className="text-slate-400 text-sm font-medium mb-6 flex items-center gap-2 shrink-0">
                                <Zap size={16}/> Power History
                            </h3>
                            <div className="flex-1 min-h-0 w-full">
                                <EnergyChart history={history.chart} timeRange={timeRange} />
                            </div>
                        </div>
                        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg h-[300px] flex flex-col">
                            <h3 className="text-slate-400 text-sm font-medium mb-6 flex items-center gap-2 shrink-0">
                                <Battery size={16}/> Battery State of Charge
                            </h3>
                            <div className="flex-1 min-h-0 w-full">
                                <BatteryChart history={history.chart} timeRange={timeRange} />
                            </div>
                        </div>
                        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg h-[250px] flex flex-col">
                            <h3 className="text-slate-400 text-sm font-medium mb-6 flex items-center gap-2 shrink-0">
                                <BarChart3 size={16}/> Efficiency History
                            </h3>
                            <div className="flex-1 min-h-0 w-full">
                                <EfficiencyChart history={history.chart} timeRange={timeRange} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-pulse mt-6">
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
