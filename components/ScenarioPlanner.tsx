import React, { useState, useEffect, useMemo } from 'react';
import { Settings2, Calculator, ArrowRight, TrendingUp, Zap, Battery, Info, PiggyBank, Coins, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { SimulationDataPoint, SystemConfig, Tariff } from '../types';
import { getSimulationData, getTariffs } from '../services/api';

interface ScenarioPlannerProps {
    config: SystemConfig;
}

const ScenarioPlanner: React.FC<ScenarioPlannerProps> = ({ config }) => {
    const [data, setData] = useState<SimulationDataPoint[]>([]);
    const [tariffs, setTariffs] = useState<Tariff[]>([]);
    const [loading, setLoading] = useState(false);
    
    // Scenarios
    const [addedPvPercent, setAddedPvPercent] = useState<number>(0); // 0 to 200%
    const [addedBatteryKwh, setAddedBatteryKwh] = useState<number>(0); // 0 to 20 kWh

    // Costs (Defaults: 1000/kWp, 400/kWh)
    const [costPerKwp, setCostPerKwp] = useState<number>(1000);
    const [costPerKwhBat, setCostPerKwhBat] = useState<number>(400);

    const [isOpen, setIsOpen] = useState(false);

    const dataCoverage = useMemo(() => {
        if (data.length === 0) return { days: 0, percent: 0, missingDays: 365, quality: 0 };
        
        // Group points by date to check for completeness
        const dayCounts: Record<string, number> = {};
        data.forEach(d => {
            const date = new Date(d.t).toISOString().split('T')[0];
            dayCounts[date] = (dayCounts[date] || 0) + 1;
        });

        // A day is "complete" if it has at least 23 hourly data points
        const completeDays = Object.values(dayCounts).filter(count => count >= 23).length;
        const totalDaysWithSomeData = Object.keys(dayCounts).length;

        const days = completeDays; 
        const missingDays = Math.max(0, 365 - days);
        const percent = Math.min(100, Math.round((days / 365) * 100));
        
        // Quality factor: how many of the days that have data are actually "hourly" resolution
        const quality = totalDaysWithSomeData > 0 ? (completeDays / totalDaysWithSomeData) * 100 : 0;

        return { days, percent, missingDays, quality };
    }, [data]);

    useEffect(() => {
        if (isOpen && data.length === 0) {
            setLoading(true);
            Promise.all([
                getSimulationData(),
                getTariffs()
            ])
            .then(([simData, tariffData]) => {
                setData(simData);
                setTariffs(tariffData);
            })
            .catch(err => console.error("Sim data fail", err))
            .finally(() => setLoading(false));
        }
    }, [isOpen]);

    // Helper to get active tariff
    const activeTariff = useMemo(() => {
        if (tariffs.length === 0) return { costPerKwh: 0.30, feedInTariff: 0.08 }; // Default if no tariff found
        // Sort by date desc
        const sorted = [...tariffs].sort((a,b) => new Date(b.validFrom).getTime() - new Date(a.validFrom).getTime());
        // Find first one that is in the past (active)
        const active = sorted.find(t => new Date(t.validFrom) <= new Date()) || sorted[0];
        return active;
    }, [tariffs]);

    // The Simulation Core
    const results = useMemo(() => {
        if (data.length === 0) return null;

        // NEW: Filter data to only include days that are "complete" (>= 23 hours)
        // to ensure the simulation is statistically sound.
        const dayCounts: Record<string, number> = {};
        data.forEach(d => {
            const date = new Date(d.t).toISOString().split('T')[0];
            dayCounts[date] = (dayCounts[date] || 0) + 1;
        });

        const validDates = new Set(
            Object.keys(dayCounts).filter(date => dayCounts[date] >= 23)
        );

        const filteredData = data.filter(d => {
            const date = new Date(d.t).toISOString().split('T')[0];
            return validDates.has(date);
        });

        if (filteredData.length === 0) return null;

        let totalLoad = 0;
        let totalPvOriginal = 0;
        let totalPvSimulated = 0;
        
        // Sim State
        const batteryCapacityWh = (config.batteryCapacity || 5) * 1000 + (addedBatteryKwh * 1000);
        let currentSocWh = 0; 
        let currentSocWhOriginal = 0;
        
        let importedOriginal = 0;
        let importedSimulated = 0;
        let exportedOriginal = 0;
        let exportedSimulated = 0;

        // Iterate ONLY through filtered (complete hourly) data
        filteredData.forEach(point => {
            const loadWh = point.l; 
            const pvWhOriginal = point.p; 
            const pvWhSimulated = point.p * (1 + (addedPvPercent / 100));

            totalLoad += loadWh;
            totalPvOriginal += pvWhOriginal;
            totalPvSimulated += pvWhSimulated;

            // --- Net Logic ---
            const netOriginal = pvWhOriginal - loadWh;
            if (netOriginal > 0) {
                const space = (config.batteryCapacity || 5) * 1000 - currentSocWhOriginal;
                const charge = Math.min(netOriginal, space);
                currentSocWhOriginal += charge;
                exportedOriginal += (netOriginal - charge);
            } else {
                const discharge = Math.min(Math.abs(netOriginal), currentSocWhOriginal);
                currentSocWhOriginal -= discharge;
                importedOriginal += (Math.abs(netOriginal) - discharge);
            }

            const netSimulated = pvWhSimulated - loadWh;
            if (netSimulated > 0) {
                 const space = batteryCapacityWh - currentSocWh;
                 const charge = Math.min(netSimulated, space);
                 currentSocWh += charge;
                 exportedSimulated += (netSimulated - charge);
            } else {
                 const discharge = Math.min(Math.abs(netSimulated), currentSocWh);
                 currentSocWh -= discharge;
                 importedSimulated += (Math.abs(netSimulated) - discharge);
            }
        });

        // Autonomy = 1 - (Imported / TotalLoad)
        const autonomyOriginal = 100 * (1 - (importedOriginal / totalLoad));
        const autonomySimulated = 100 * (1 - (importedSimulated / totalLoad));

        return {
            autonomyOriginal,
            autonomySimulated,
            totalPvSimulated,
            totalLoad,
            importedOriginal,
            importedSimulated,
            exportedOriginal,
            exportedSimulated
        };
    }, [data, addedPvPercent, addedBatteryKwh, config.batteryCapacity]);

    // Financial Calculation
    const financials = useMemo(() => {
        if (!results) return null;

        // Normalize to 1 Year (since data could span multiple years or just a few months)
        const yearsCovered = Math.max(0.1, dataCoverage.days / 365);
        
        // Use active tariff from settings
        const gridCost = activeTariff.costPerKwh; 
        const feedIn = activeTariff.feedInTariff; 
        
        // Total Benefits over the entire dataset
        const totalSavedImportKwh = (results.importedOriginal - results.importedSimulated) / 1000;
        const totalExtraExportKwh = (results.exportedSimulated - results.exportedOriginal) / 1000;
        
        const totalBenefit = (totalSavedImportKwh * gridCost) + (totalExtraExportKwh * feedIn);
        
        // Normalize to YEARLY benefit
        const totalYearlyBenefit = totalBenefit / yearsCovered;

        let estimatedBaseKwp = 5;
        if (config.systemCapacity && config.systemCapacity > 0) {
             estimatedBaseKwp = config.systemCapacity;
        } else if (data.length > 0) {
            const maxP = Math.max(...data.map(d => d.p));
            estimatedBaseKwp = Math.ceil(maxP / 1000); // 4500W -> 5kWp
        }

        const addedKwp = estimatedBaseKwp * (addedPvPercent / 100);
        const investPv = addedKwp * costPerKwp;
        const investBat = addedBatteryKwh * costPerKwhBat;
        const totalInvest = investPv + investBat;

        const roiYears = totalInvest / (totalYearlyBenefit || 1); // Avoid div/0

        return {
            totalInvest,
            totalYearlyBenefit,
            roiYears,
            estimatedBaseKwp
        };

    }, [results, costPerKwp, costPerKwhBat, addedPvPercent, addedBatteryKwh, data, activeTariff]);


    if (!isOpen) {
        return (
             <button 
                onClick={() => setIsOpen(true)}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 p-4 rounded-xl shadow-lg border border-white/10 flex items-center justify-between group transition-all"
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-white/20 rounded-lg">
                        <Calculator className="text-white" size={24} />
                    </div>
                    <div className="text-left">
                        <div className="text-white font-bold text-lg">Scenario Planner</div>
                        <div className="text-indigo-200 text-sm">Simulate Upgrades & ROI</div>
                    </div>
                </div>
                <ArrowRight className="text-white opacity-50 group-hover:opacity-100 transition-opacity" />
            </button>
        );
    }

    return (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 animate-fade-in shadow-2xl relative overflow-hidden">
             {/* Header */}
             <div className="flex justify-between items-start mb-6">
                 <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <TrendingUp className="text-purple-400" />
                        Upgrade Simulator
                    </h2>
                    <p className="text-slate-400 text-sm mt-1">
                        Based on your last 12 months. Financials at {activeTariff.costPerKwh.toFixed(2)} {config.currency}/kWh buy & {activeTariff.feedInTariff.toFixed(2)} {config.currency}/kWh sell.
                    </p>
                 </div>
                 <button 
                    onClick={() => setIsOpen(false)}
                    className="text-slate-500 hover:text-white"
                 >
                    Close
                 </button>
             </div>

             {loading && (
                 <div className="text-center py-10 text-slate-400">Loading historical data...</div>
             )}

             {!loading && !results && data.length > 0 && (
                 <div className="text-center py-10 bg-slate-900/50 rounded-xl border border-dashed border-slate-700">
                     <AlertTriangle className="text-yellow-500 mx-auto mb-3" size={48} />
                     <h3 className="text-white font-bold text-lg">No hourly data found</h3>
                     <p className="text-slate-400 text-sm max-w-md mx-auto mt-2">
                         The simulator requires at least one full day (24h) of hourly data to calculate battery behavior. 
                         Your current imports only contain daily totals.
                     </p>
                 </div>
             )}

             {!loading && results && financials && (
                 <div className="flex flex-col gap-8">
                     
                     <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* LEFT COL: CONTROLS */}
                        <div className="space-y-8 bg-slate-900/50 p-6 rounded-xl border border-slate-700/50">
                            
                            {/* PV Slider */}
                            <div>
                                <div className="flex justify-between mb-2">
                                    <label className="text-slate-200 font-medium flex items-center gap-2">
                                        <Zap size={16} className="text-yellow-400" />
                                        ADD PV Power
                                    </label>
                                    <span className="text-yellow-400 font-bold">+{addedPvPercent}%</span>
                                </div>
                                <input 
                                    type="range" 
                                    min="0" 
                                    max="200" 
                                    step="10"
                                    value={addedPvPercent}
                                    onChange={(e) => setAddedPvPercent(parseInt(e.target.value))}
                                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-yellow-500 mb-2"
                                />
                                <div className="flex justify-between items-center text-xs text-slate-500">
                                    <span>Base: {financials.estimatedBaseKwp} kWp {config.systemCapacity ? '(Configured)' : '(Est.)'}</span>
                                    <div className="flex items-center gap-1 bg-slate-800 px-2 py-1 rounded border border-slate-700">
                                        <span>Cost:</span>
                                        <input 
                                            type="number" 
                                            value={costPerKwp}
                                            onChange={(e) => setCostPerKwp(Number(e.target.value))}
                                            className="w-12 bg-transparent text-right text-yellow-400 focus:outline-none"
                                        />
                                        <span>{config.currency}/kWp</span>
                                    </div>
                                </div>
                            </div>

                            {/* Battery Slider */}
                            <div>
                                <div className="flex justify-between mb-2">
                                    <label className="text-slate-200 font-medium flex items-center gap-2">
                                        <Battery size={16} className="text-green-400" />
                                        ADD Storage
                                    </label>
                                    <span className="text-green-400 font-bold">+{addedBatteryKwh} kWh</span>
                                </div>
                                <input 
                                    type="range" 
                                    min="0" 
                                    max="30" 
                                    step="1"
                                    value={addedBatteryKwh}
                                    onChange={(e) => setAddedBatteryKwh(parseInt(e.target.value))}
                                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-green-500 mb-2"
                                />
                                <div className="flex justify-between items-center text-xs text-slate-500">
                                    <span>Base: {config.batteryCapacity || 0} kWh</span>
                                    <div className="flex items-center gap-1 bg-slate-800 px-2 py-1 rounded border border-slate-700">
                                        <span>Cost:</span>
                                        <input 
                                            type="number" 
                                            value={costPerKwhBat}
                                            onChange={(e) => setCostPerKwhBat(Number(e.target.value))}
                                            className="w-12 bg-transparent text-right text-green-400 focus:outline-none"
                                        />
                                        <span>{config.currency}/kWh</span>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-xl flex flex-col gap-3 backdrop-blur-sm">
                                <div className="flex gap-3 items-start">
                                    <Info size={18} className="text-blue-400 shrink-0 mt-0.5" />
                                    <div className="text-xs text-blue-200 leading-relaxed">
                                        <strong>Accuracy Check:</strong> 1 year of hourly data is required for highly accurate ROI simulations that account for all seasons.
                                        {dataCoverage.days < 365 ? (
                                            <div className="mt-2 space-y-1">
                                                <p className="text-yellow-400 font-medium">
                                                    ⚠️ Found <strong>{dataCoverage.days} complete days</strong> with hourly resolution.
                                                </p>
                                                <p className="opacity-80">
                                                    You need <strong>{dataCoverage.missingDays} more full days</strong> for a 100% reliable 12-month baseline.
                                                </p>
                                            </div>
                                        ) : (
                                            <p className="mt-2 text-emerald-400 font-medium flex items-center gap-1">
                                                <CheckCircle2 size={12} /> Full 12-month baseline reached ({dataCoverage.days} days available)!
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                                    <div 
                                        className={`h-full transition-all duration-1000 ${dataCoverage.percent === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                                        style={{ width: `${dataCoverage.percent}%` }}
                                    />
                                </div>
                                <div className="text-[10px] text-slate-500 italic">
                                    💡 Pro-Tip: For accurate battery simulation, hourly data resolution is required.
                                </div>
                            </div>
                        </div>

                        {/* RIGHT COL: VISUALS */}
                        <div className="flex flex-col justify-center gap-6">
                            
                            {/* Autonomy Bar */}
                            <div className="bg-slate-900 p-4 rounded-xl border border-slate-700">
                                <div className="flex justify-between mb-2">
                                    <span className="text-slate-400 font-medium">Autonomy Boost</span>
                                    <div className="flex gap-2">
                                            <span className="text-slate-500 line-through">{results.autonomyOriginal.toFixed(1)}%</span>
                                            <span className="text-white font-bold text-lg">{results.autonomySimulated.toFixed(1)}%</span>
                                    </div>
                                </div>
                                <div className="h-4 w-full bg-slate-800 rounded-full overflow-hidden relative">
                                    {/* Original Marker */}
                                    <div 
                                        className="h-full bg-slate-600 absolute top-0 left-0"
                                        style={{ width: `${results.autonomyOriginal}%` }}
                                    />
                                    {/* New Marker (only the diff) */}
                                    <div 
                                        className="h-full bg-gradient-to-r from-blue-600 to-purple-500 absolute top-0 left-0 transition-all duration-500 opacity-80"
                                        style={{ width: `${results.autonomySimulated}%` }}
                                    />
                                </div>
                            </div>

                            {/* ROI CARD ESSENTIAL */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 flex flex-col justify-between">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Coins size={18} className="text-yellow-500" />
                                        <span className="text-slate-400 text-xs font-bold uppercase">Invest</span>
                                    </div>
                                    <div className="text-2xl font-bold text-white">
                                        {financials.totalInvest.toLocaleString()} {config.currency}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">Total Upfront Cost</div>
                                </div>

                                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 flex flex-col justify-between">
                                    <div className="flex items-center gap-2 mb-2">
                                        <PiggyBank size={18} className="text-green-500" />
                                        <span className="text-slate-400 text-xs font-bold uppercase">Yearly Return</span>
                                    </div>
                                    <div className="text-2xl font-bold text-green-400">
                                        +{financials.totalYearlyBenefit.toLocaleString(undefined, { maximumFractionDigits: 0 })} {config.currency}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">Savings + Earnings</div>
                                </div>
                            </div>
                            
                            {/* ROI BIG VERDICT */}
                            {(addedPvPercent > 0 || addedBatteryKwh > 0) && (
                                <div className={`p-4 rounded-xl border flex items-center justify-between ${
                                    financials.roiYears < 10 
                                    ? 'bg-emerald-500/10 border-emerald-500/30' 
                                    : financials.roiYears < 15 
                                    ? 'bg-yellow-500/10 border-yellow-500/30'
                                    : 'bg-red-500/10 border-red-500/30'
                                }`}>
                                    <div>
                                        <div className="text-xs font-bold uppercase opacity-70 mb-1">
                                            Return on Investment (ROI)
                                        </div>
                                        <div className="text-2xl font-black">
                                            {financials.roiYears.toFixed(1)} Years
                                        </div>
                                    </div>
                                    <div>
                                        {financials.roiYears < 10 ? (
                                            <div className="flex items-center gap-2 text-emerald-400 font-bold">
                                                <CheckCircle2 size={32} />
                                                <span>Great!</span>
                                            </div>
                                        ) : financials.roiYears < 15 ? (
                                            <div className="flex items-center gap-2 text-yellow-400 font-bold">
                                                 <Info size={32} />
                                                 <span>Okay</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2 text-red-400 font-bold">
                                                 <AlertTriangle size={32} />
                                                 <span>Long term</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                        </div>
                     </div>
                 </div>
             )}
        </div>
    );
};

export default ScenarioPlanner;