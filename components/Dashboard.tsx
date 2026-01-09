
import React, { useState, useEffect } from 'react';
import { InverterData, SystemConfig, TimeRange, HistoryData, RoiData, ForecastData } from '../types';
import PowerFlow from './PowerFlow';
import EnergyChart from './EnergyChart';
import BatteryChart from './BatteryChart';
import EfficiencyChart from './EfficiencyChart';
import StatsCard from './StatsCard';
import EnergyDonut from './EnergyDonut';
import BatteryWidget from './BatteryWidget';
import StatusTimeline from './StatusTimeline'; 
import AmortizationWidget from './AmortizationWidget';
import WeatherWidget from './WeatherWidget';
import SmartRecommendations from './SmartRecommendations';
import { getHistory, getRoiData, getForecast } from '../services/api';
import { Sun, Zap, Home, PiggyBank, Calendar, ArrowRight, Battery, BarChart3, Leaf, TrendingUp } from 'lucide-react';

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
    };
    dailyYield: number; // Calculated kWh from Open-Meteo radiation
}

const Dashboard: React.FC<DashboardProps> = ({ data, config, error, refreshTrigger }) => {
  const [timeRange, setTimeRange] = useState<TimeRange>('day');
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [roiData, setRoiData] = useState<RoiData | null>(null);
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);
  
  // Custom Date Range State
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Fetch History (Charts, Stats)
  useEffect(() => {
    fetchHistory();
    // Refresh history every 60s (Standard monitoring interval)
    const interval = setInterval(fetchHistory, 60000); 
    return () => clearInterval(interval);
  }, [timeRange, startDate, endDate, refreshTrigger]); 

  // Fetch ROI Data (Expensive calculation)
  useEffect(() => {
    const fetchRoi = async () => {
        try {
            const rData = await getRoiData();
            setRoiData(rData);
        } catch(e) { console.error("ROI Fetch Error", e); }
    };
    
    fetchRoi(); 
    const interval = setInterval(fetchRoi, 10 * 60 * 1000); 
    return () => clearInterval(interval);
  }, [refreshTrigger]); 

  // Fetch Forecast (Solcast)
  useEffect(() => {
    if (!config.solcastApiKey) return;
    const fetchFC = async () => {
        try {
            const fc = await getForecast();
            setForecast(fc);
        } catch(e) { console.error("Forecast Fetch Error", e); }
    };
    fetchFC();
    // Refresh forecast every 60 mins (handled by backend cache too)
    const interval = setInterval(fetchFC, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [config.solcastApiKey, refreshTrigger]);

  // Fetch Weather (Open-Meteo) - Fallback Logic
  useEffect(() => {
    if (!config.latitude || !config.longitude) return;

    const fetchWeather = async () => {
      try {
        const lat = config.latitude;
        const lon = config.longitude;
        // Fetch current weather + Daily Shortwave Radiation Sum (MJ/m²)
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&daily=weather_code,shortwave_radiation_sum&timezone=auto&forecast_days=1`;
        
        const res = await fetch(url);
        if (!res.ok) throw new Error("Weather API failed");
        
        const wData = await res.json();
        
        // Calculate Fallback Yield: Capacity * (Radiation_MJ / 3.6) * PR(0.85)
        const radiationMJ = wData.daily?.shortwave_radiation_sum?.[0] || 0;
        const radiationKWh = radiationMJ / 3.6;
        const capacity = config.systemCapacity || 0; 
        const pr = 0.85; 
        const estimatedYield = capacity * radiationKWh * pr;

        setWeather({
            current: {
                temp: wData.current.temperature_2m,
                weatherCode: wData.current.weather_code
            },
            dailyYield: estimatedYield
        });
      } catch (err) {
        console.error("Failed to load weather/fallback forecast", err);
      }
    };

    fetchWeather();
    const interval = setInterval(fetchWeather, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [config.latitude, config.longitude, config.systemCapacity]);


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

      {/* --- SECTION 1: LIVE MONITORING --- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Power Flow Diagram (Takes 2/3 width) */}
        {/* Removed fixed height so it grows with content, but set min-height for consistent look */}
        <div className="lg:col-span-2 bg-slate-800 rounded-2xl border border-slate-700 shadow-xl relative overflow-hidden flex flex-col min-h-[500px]">
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

        {/* Right: Widgets Column (Takes 1/3 width) */}
        <div className="flex flex-col gap-6 min-h-[500px]">
          {/* Smart Recommendations - High Priority */}
          <div className="flex-1 min-h-[220px]">
            <SmartRecommendations 
                power={data.power}
                soc={data.battery.soc}
                forecast={forecast}
                todayProduction={data.energy.today.production}
                fallbackDailyYield={weather?.dailyYield}
                batteryCapacity={config.batteryCapacity || 10}
                appliances={config.appliances || []}
            />
          </div>

          {/* Battery Widget */}
          <div className="flex-1 min-h-[220px]">
             <BatteryWidget 
                soc={data.battery.soc}
                power={data.power.battery}
                state={data.battery.state}
             />
          </div>
        </div>
      </div>

      {/* --- SECTION 2: SYSTEM HEALTH & FORECAST --- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in">
          {/* ROI Widget */}
          <AmortizationWidget roiData={roiData} currency={config.currency} />

          {/* Weather / Solar Forecast (Moved here from top section) */}
          <div className="h-full">
             <WeatherWidget 
                config={config} 
                forecast={forecast}
                weatherData={weather}
                actualProduction={data.energy.today.production}
             />
          </div>

          {/* Realtime Efficiency Donuts */}
          <div className="grid grid-rows-2 gap-4 h-full">
            <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 shadow-lg flex items-center justify-between relative overflow-hidden">
                <div className="z-10 pl-2">
                    <div className="text-slate-400 text-xs font-bold uppercase mb-1">Live Autonomy</div>
                    <div className="text-2xl font-bold text-blue-400">{data.autonomy}%</div>
                </div>
                <div className="h-16 w-16 mr-2">
                    <EnergyDonut percentage={data.autonomy} label="" color="#3b82f6" small />
                </div>
            </div>
            <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-lg flex items-center justify-between relative overflow-hidden">
                <div className="z-10 pl-2">
                    <div className="text-slate-400 text-xs font-bold uppercase mb-1">Self Consumption</div>
                    <div className="text-2xl font-bold text-green-400">{data.selfConsumption}%</div>
                </div>
                <div className="h-16 w-16 mr-2">
                    <EnergyDonut percentage={data.selfConsumption} label="" color="#22c55e" small />
                </div>
            </div>
          </div>
      </div>

      {/* --- SECTION 3: TIMELINE --- */}
      <div className="animate-fade-in">
        <StatusTimeline history={history?.chart || []} />
      </div>

      {/* --- SECTION 4: HISTORICAL ANALYSIS CONTROLS --- */}
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

      {/* --- SECTION 5: HISTORICAL DATA GRIDS --- */}
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

                    {/* Environment & Peaks */}
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
                            <span className="text-xs text-slate-600">Max Load: {(peaks.maxLoad).toFixed(0)}W</span>
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
                            <BarChart3 size={16}/> Efficiency History
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
