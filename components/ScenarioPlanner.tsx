import React, { useState, useEffect, useMemo } from 'react';
import { Settings2, Calculator, ArrowRight, TrendingUp, Zap, Battery, Info, PiggyBank, Coins, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { SimulationDataPoint, SystemConfig, Tariff } from '../types';
import { getSimulationData, getTariffs } from '../services/api';

interface ScenarioPlannerProps {
    config: SystemConfig;
}

type SimulationWindow = 'week' | 'month' | 'halfYear' | 'year';

const WINDOW_DAYS: Record<SimulationWindow, number> = {
    week: 7,
    month: 30,
    halfYear: 182,
    year: 365,
};

const WINDOW_LABEL: Record<SimulationWindow, string> = {
    week: 'Last week',
    month: 'Last month',
    halfYear: 'Last 6 months',
    year: 'Last 365 days',
};

const toLocalDateKey = (timestampMs: number): string => {
    const d = new Date(timestampMs);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const getWindowBounds = (window: SimulationWindow): { startMs: number; endMs: number; expectedDays: number } => {
    const expectedDays = WINDOW_DAYS[window];
    // Use local-day boundaries: [start, end) where end is start of tomorrow.
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1);

    const start = new Date(end);
    start.setDate(start.getDate() - expectedDays);

    return { startMs: start.getTime(), endMs: end.getTime(), expectedDays };
};

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

    const [simulationWindow, setSimulationWindow] = useState<SimulationWindow>('year');

    const [isOpen, setIsOpen] = useState(false);

    const windowBounds = useMemo(() => getWindowBounds(simulationWindow), [simulationWindow]);

    const windowedData = useMemo(() => {
        if (data.length === 0) return [];
        return data.filter(d => d.t >= windowBounds.startMs && d.t < windowBounds.endMs);
    }, [data, windowBounds.startMs, windowBounds.endMs]);

    const dataCoverage = useMemo(() => {
        if (windowedData.length === 0) return { days: 0, percent: 0, missingDays: windowBounds.expectedDays, quality: 0 };
        
        // Group points by local date to check for completeness
        const dayCounts: Record<string, number> = {};
        windowedData.forEach(d => {
            const dateKey = toLocalDateKey(d.t);
            dayCounts[dateKey] = (dayCounts[dateKey] || 0) + 1;
        });

        // A day is "complete" if it has at least 23 hourly data points
        const completeDays = Object.values(dayCounts).filter(count => count >= 23).length;
        const totalDaysWithSomeData = Object.keys(dayCounts).length;

        const days = completeDays;
        const missingDays = Math.max(0, windowBounds.expectedDays - days);
        const percent = Math.min(100, Math.round((days / windowBounds.expectedDays) * 100));
        
        // Quality factor: how many of the days that have data are actually "hourly" resolution
        const quality = totalDaysWithSomeData > 0 ? (completeDays / totalDaysWithSomeData) * 100 : 0;

        return { days, percent, missingDays, quality };
    }, [windowedData, windowBounds.expectedDays]);

    // Only use full (hourly) days for battery simulations.
    const filteredHourlyData = useMemo(() => {
        if (windowedData.length === 0) return null as SimulationDataPoint[] | null;

        const dayCounts: Record<string, number> = {};
        windowedData.forEach(d => {
            const dateKey = toLocalDateKey(d.t);
            dayCounts[dateKey] = (dayCounts[dateKey] || 0) + 1;
        });

        const validDates = new Set(
            Object.keys(dayCounts).filter(date => dayCounts[date] >= 23)
        );

        const filtered = windowedData.filter(d => validDates.has(toLocalDateKey(d.t)));
        return filtered.length > 0 ? filtered : null;
    }, [windowedData]);

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
    type ScenarioSimResult = {
        totalLoadWh: number;
        totalPvWh: number;
        importedWh: number;
        exportedWh: number;
        autonomyPct: number;
    };

    const simulate = (dataPoints: SimulationDataPoint[], pvPercent: number, batteryCapacityWh: number): ScenarioSimResult => {
        let currentSocWh = 0;
        let totalLoadWh = 0;
        let totalPvWh = 0;
        let importedWh = 0;
        let exportedWh = 0;

        dataPoints.forEach(point => {
            const loadWh = point.l;
            const pvWh = point.p * (1 + (pvPercent / 100));

            totalLoadWh += loadWh;
            totalPvWh += pvWh;

            const net = pvWh - loadWh;
            if (net > 0) {
                const space = batteryCapacityWh - currentSocWh;
                const charge = Math.min(net, space);
                currentSocWh += charge;
                exportedWh += (net - charge);
            } else {
                const discharge = Math.min(Math.abs(net), currentSocWh);
                currentSocWh -= discharge;
                importedWh += (Math.abs(net) - discharge);
            }
        });

        const autonomyPct = totalLoadWh > 0 ? 100 * (1 - (importedWh / totalLoadWh)) : 0;
        return { totalLoadWh, totalPvWh, importedWh, exportedWh, autonomyPct };
    };

    const simulations = useMemo(() => {
        if (!filteredHourlyData) return null;

        const baseBatteryWh = (config.batteryCapacity || 5) * 1000;

        const base = simulate(filteredHourlyData, 0, baseBatteryWh);
        const pvOnly = simulate(filteredHourlyData, addedPvPercent, baseBatteryWh);
        const pvPlusBattery = simulate(filteredHourlyData, addedPvPercent, baseBatteryWh + (addedBatteryKwh * 1000));

        return { base, pvOnly, pvPlusBattery };
    }, [filteredHourlyData, addedPvPercent, addedBatteryKwh, config.batteryCapacity]);

    // Backwards-compatible view model for the existing UI
    const results = useMemo(() => {
        if (!simulations) return null;
        return {
            autonomyOriginal: simulations.base.autonomyPct,
            autonomySimulated: simulations.pvPlusBattery.autonomyPct,
        };
    }, [simulations]);


    // Financial Calculation
    const financials = useMemo(() => {
        if (!simulations) return null;

        // Normalize to 1 Year (since data could span multiple years or just a few months)
        const yearsCovered = Math.max(0.1, dataCoverage.days / 365);
        
        // Use active tariff from settings
        const gridCost = activeTariff.costPerKwh; 
        const feedIn = activeTariff.feedInTariff; 

        const benefitOverDataset = (from: ScenarioSimResult, to: ScenarioSimResult) => {
            const savedImportKwh = (from.importedWh - to.importedWh) / 1000;
            const extraExportKwh = (to.exportedWh - from.exportedWh) / 1000;
            return (savedImportKwh * gridCost) + (extraExportKwh * feedIn);
        };

        // Benefits over the entire dataset
        // - PV-only: base -> pvOnly
        // - Combined: base -> pvPlusBattery
        // - Battery incremental: pvOnly -> pvPlusBattery (this captures the dependency you described)
        const totalBenefitPvOnly = benefitOverDataset(simulations.base, simulations.pvOnly);
        const totalBenefitCombined = benefitOverDataset(simulations.base, simulations.pvPlusBattery);
        const totalBenefitBatteryIncremental = benefitOverDataset(simulations.pvOnly, simulations.pvPlusBattery);

        // Normalize to YEARLY benefits
        const yearlyBenefitPvOnly = totalBenefitPvOnly / yearsCovered;
        const yearlyBenefitCombined = totalBenefitCombined / yearsCovered;
        const yearlyBenefitBatteryIncremental = totalBenefitBatteryIncremental / yearsCovered;

        let estimatedBaseKwp = 5;
        if (config.systemCapacity && config.systemCapacity > 0) {
             estimatedBaseKwp = config.systemCapacity;
        } else if (windowedData.length > 0) {
            const maxP = Math.max(...windowedData.map(d => d.p));
            estimatedBaseKwp = Math.ceil(maxP / 1000); // 4500W -> 5kWp
        }

        const addedKwp = estimatedBaseKwp * (addedPvPercent / 100);
        const investPv = addedKwp * costPerKwp;
        const investBat = addedBatteryKwh * costPerKwhBat;
        const totalInvest = investPv + investBat;

        const safeRoiYears = (invest: number, yearlyBenefit: number) => {
            if (invest <= 0) return 0;
            if (yearlyBenefit <= 0) return Infinity;
            return invest / yearlyBenefit;
        };

        const roiYearsCombined = safeRoiYears(totalInvest, yearlyBenefitCombined);
        const roiYearsPvOnly = safeRoiYears(investPv, yearlyBenefitPvOnly);
        const roiYearsBatteryIncremental = safeRoiYears(investBat, yearlyBenefitBatteryIncremental);

        return {
            totalInvest,
            totalYearlyBenefit: yearlyBenefitCombined,
            roiYears: roiYearsCombined,
            pvOnly: {
                invest: investPv,
                yearlyBenefit: yearlyBenefitPvOnly,
                roiYears: roiYearsPvOnly,
            },
            batteryIncremental: {
                invest: investBat,
                yearlyBenefit: yearlyBenefitBatteryIncremental,
                roiYears: roiYearsBatteryIncremental,
            },
            estimatedBaseKwp
        };

    }, [simulations, costPerKwp, costPerKwhBat, addedPvPercent, addedBatteryKwh, windowedData, activeTariff, config.systemCapacity, dataCoverage.days]);

    // Auto-recommend battery size (0..30 kWh) for the currently selected PV slider.
    const batteryRecommendation = useMemo(() => {
        if (!filteredHourlyData) return null;
        if (!financials) return null;

        // Guardrails to avoid recommending upgrades with negligible impact.
        // These are heuristics (not hard truths) to prevent misleading suggestions.
        const MIN_YEARLY_BENEFIT = 5; // {currency}/year
        const MAX_REASONABLE_ROI_YEARS = 25;

        const yearsCovered = Math.max(0.1, dataCoverage.days / 365);
        const gridCost = activeTariff.costPerKwh;
        const feedIn = activeTariff.feedInTariff;

        const baseBatteryWh = (config.batteryCapacity || 5) * 1000;
        const pvOnly = simulate(filteredHourlyData, addedPvPercent, baseBatteryWh);

        const benefitOverDataset = (from: ScenarioSimResult, to: ScenarioSimResult) => {
            const savedImportKwh = (from.importedWh - to.importedWh) / 1000;
            const extraExportKwh = (to.exportedWh - from.exportedWh) / 1000;
            return (savedImportKwh * gridCost) + (extraExportKwh * feedIn);
        };

        type Candidate = {
            addedBatteryKwh: number;
            yearlyBenefit: number;
            yearlySavedImportKwh: number;
            yearlyExportDeltaKwh: number;
            invest: number;
            roiYears: number;
        };

        const candidates: Candidate[] = [];
        for (let kwh = 0; kwh <= 30; kwh += 1) {
            const sim = simulate(filteredHourlyData, addedPvPercent, baseBatteryWh + (kwh * 1000));
            const savedImportKwh = (pvOnly.importedWh - sim.importedWh) / 1000;
            const exportDeltaKwh = (sim.exportedWh - pvOnly.exportedWh) / 1000;

            const totalBenefit = (savedImportKwh * gridCost) + (exportDeltaKwh * feedIn);
            const yearlyBenefit = totalBenefit / yearsCovered;
            const yearlySavedImportKwh = savedImportKwh / yearsCovered;
            const yearlyExportDeltaKwh = exportDeltaKwh / yearsCovered;
            const invest = kwh * costPerKwhBat;
            const roiYears = invest <= 0 ? 0 : (yearlyBenefit > 0 ? invest / yearlyBenefit : Infinity);
            candidates.push({ addedBatteryKwh: kwh, yearlyBenefit, yearlySavedImportKwh, yearlyExportDeltaKwh, invest, roiYears });
        }

        const addOns = candidates.filter(c => c.addedBatteryKwh > 0);
        const positive = addOns.filter(c => c.yearlyBenefit > 0);
        const bestYearlyAny = [...addOns].sort((a, b) => b.yearlyBenefit - a.yearlyBenefit)[0] || null;

        // Only recommend if it is economically meaningful.
        const meaningful = positive.filter(c => (c.yearlyBenefit >= MIN_YEARLY_BENEFIT) && (c.roiYears <= MAX_REASONABLE_ROI_YEARS));

        if (positive.length === 0) {
            return {
                recommended: null as Candidate | null,
                bestYearly: bestYearlyAny,
                thresholds: { minYearlyBenefit: MIN_YEARLY_BENEFIT, maxRoiYears: MAX_REASONABLE_ROI_YEARS },
            };
        }

        if (meaningful.length === 0) {
            return {
                recommended: null as Candidate | null,
                bestYearly: bestYearlyAny,
                thresholds: { minYearlyBenefit: MIN_YEARLY_BENEFIT, maxRoiYears: MAX_REASONABLE_ROI_YEARS },
            };
        }

        const recommended = [...meaningful].sort((a, b) => a.roiYears - b.roiYears)[0];
        return { recommended, bestYearly: bestYearlyAny, thresholds: { minYearlyBenefit: MIN_YEARLY_BENEFIT, maxRoiYears: MAX_REASONABLE_ROI_YEARS } };
    }, [filteredHourlyData, financials, dataCoverage.days, activeTariff, config.batteryCapacity, addedPvPercent, costPerKwhBat]);


    if (!isOpen) {
        return (
             <button 
                onClick={() => setIsOpen(true)}
                className="w-full bg-gradient-to-r from-indigo-700/60 to-purple-700/60 hover:from-indigo-600/60 hover:to-purple-600/60 p-4 rounded-xl shadow-lg border border-white/10 flex items-center justify-between group transition-all"
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
                        Based on {WINDOW_LABEL[simulationWindow].toLowerCase()} (until today). Financials at {activeTariff.costPerKwh.toFixed(2)} {config.currency}/kWh buy & {activeTariff.feedInTariff.toFixed(2)} {config.currency}/kWh sell.
                    </p>
                 </div>
                 <button 
                          type="button"
                    onClick={() => setIsOpen(false)}
                          className="px-3 py-2 rounded-lg border bg-slate-900/40 border-slate-700 text-slate-300 hover:bg-slate-900/60 transition-colors text-sm font-medium"
                 >
                    Close
                 </button>
             </div>

             {/* Timeframe Selector */}
             <div className="flex flex-wrap items-center gap-2 mb-6">
                 <div className="text-xs text-slate-400 font-bold uppercase tracking-wide">Timeframe</div>
                 <div className="flex bg-slate-900 border border-slate-700 rounded-lg p-1">
                     {(Object.keys(WINDOW_LABEL) as SimulationWindow[]).map((key) => (
                         <button
                             key={key}
                             onClick={() => setSimulationWindow(key)}
                             className={`px-3 py-1 text-xs rounded-md transition-colors ${
                                 simulationWindow === key
                                     ? 'bg-purple-600 text-white'
                                     : 'text-slate-300 hover:text-white hover:bg-slate-800'
                             }`}
                         >
                             {WINDOW_LABEL[key]}
                         </button>
                     ))}
                 </div>
             </div>

             {loading && (
                 <div className="text-center py-10 text-slate-400">Loading historical data...</div>
             )}

             {!loading && !results && data.length > 0 && (
                 <div className="text-center py-10 bg-slate-900/50 rounded-xl border border-dashed border-slate-700">
                     <AlertTriangle className="text-yellow-500 mx-auto mb-3" size={48} />
                     <h3 className="text-white font-bold text-lg">No usable hourly data in selected timeframe</h3>
                     <p className="text-slate-400 text-sm max-w-md mx-auto mt-2">
                         The simulator requires at least one full day (24h) of hourly data in the selected timeframe to calculate battery behavior.
                         Try selecting a longer timeframe or import hourly-resolution data.
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
                                        <strong>Accuracy Check:</strong> More complete days means more reliable results.
                                        {dataCoverage.days < windowBounds.expectedDays ? (
                                            <div className="mt-2 space-y-1">
                                                <p className="text-yellow-400 font-medium">
                                                    ⚠️ Found <strong>{dataCoverage.days} complete days</strong> with hourly resolution.
                                                </p>
                                                <p className="opacity-80">
                                                    You need <strong>{dataCoverage.missingDays} more full days</strong> for a 100% reliable baseline for this timeframe.
                                                </p>
                                            </div>
                                        ) : (
                                            <p className="mt-2 text-emerald-400 font-medium flex items-center gap-1">
                                                <CheckCircle2 size={12} /> Baseline reached ({dataCoverage.days} days available)!
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
                                            {(addedPvPercent === 0 && addedBatteryKwh === 0) ? (
                                                <span className="text-white font-bold text-lg">{results.autonomyOriginal.toFixed(1)}%</span>
                                            ) : (
                                                <>
                                                    <span className="text-slate-500 line-through">{results.autonomyOriginal.toFixed(1)}%</span>
                                                    <span className="text-white font-bold text-lg">{results.autonomySimulated.toFixed(1)}%</span>
                                                </>
                                            )}
                                    </div>
                                </div>
                                <div className="h-4 w-full bg-slate-800 rounded-full overflow-hidden relative">
                                    {/* Original Marker */}
                                    {(addedPvPercent === 0 && addedBatteryKwh === 0) ? (
                                        <div 
                                            className="h-full bg-gradient-to-r from-blue-600 to-purple-500 absolute top-0 left-0 transition-all duration-500 opacity-80"
                                            style={{ width: `${results.autonomyOriginal}%` }}
                                        />
                                    ) : (
                                        <>
                                            <div 
                                                className="h-full bg-slate-600 absolute top-0 left-0"
                                                style={{ width: `${results.autonomyOriginal}%` }}
                                            />
                                            {/* New Marker (only the diff) */}
                                            <div 
                                                className="h-full bg-gradient-to-r from-blue-600 to-purple-500 absolute top-0 left-0 transition-all duration-500 opacity-80"
                                                style={{ width: `${results.autonomySimulated}%` }}
                                            />
                                        </>
                                    )}
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

                            {/* ROI Breakdown: makes PV/battery dependency explicit */}
                            {(addedPvPercent > 0 || addedBatteryKwh > 0) && (
                                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 text-xs text-slate-300">
                                    <div className="font-bold uppercase text-slate-400 mb-2">ROI Breakdown</div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-400">PV-only (base → PV)</span>
                                        <span className="text-yellow-300 font-semibold">
                                            {financials.pvOnly.invest > 0
                                                ? (Number.isFinite(financials.pvOnly.roiYears) ? `${financials.pvOnly.roiYears.toFixed(1)}y` : '∞')
                                                : '—'}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between mt-1">
                                        <span className="text-slate-400">Battery incremental (PV → PV+Battery)</span>
                                        <span className="text-green-300 font-semibold">
                                            {financials.batteryIncremental.invest > 0
                                                ? (Number.isFinite(financials.batteryIncremental.roiYears) ? `${financials.batteryIncremental.roiYears.toFixed(1)}y` : '∞')
                                                : '—'}
                                        </span>
                                    </div>
                                    <div className="mt-2 text-[10px] text-slate-500">
                                        Battery ROI is calculated using the current PV slider (captures PV→Battery coupling).
                                    </div>
                                </div>
                            )}

                            {/* Recommendation */}
                            {batteryRecommendation && (
                                <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-700">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="text-xs font-bold uppercase text-slate-400">Battery Suggestion</div>
                                        <div className="text-[10px] text-slate-500">Based on current PV slider + timeframe</div>
                                    </div>

                                    {batteryRecommendation.recommended ? (
                                        <div className="text-sm text-slate-200">
                                            <div className="flex items-center justify-between">
                                                <span className="text-slate-400">Recommended add-on</span>
                                                <span className="text-white font-bold">+{batteryRecommendation.recommended.addedBatteryKwh} kWh</span>
                                            </div>
                                            <div className="flex items-center justify-between mt-1">
                                                <span className="text-slate-400">Battery ROI (incremental)</span>
                                                <span className="text-emerald-400 font-semibold">{batteryRecommendation.recommended.roiYears.toFixed(1)}y</span>
                                            </div>
                                            <div className="flex items-center justify-between mt-1">
                                                <span className="text-slate-400">Yearly benefit (battery)</span>
                                                <span className="text-emerald-300 font-semibold">+{batteryRecommendation.recommended.yearlyBenefit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {config.currency}</span>
                                            </div>
                                            {batteryRecommendation.bestYearly && batteryRecommendation.bestYearly.addedBatteryKwh !== batteryRecommendation.recommended.addedBatteryKwh && (
                                                <div className="mt-2 text-[10px] text-slate-500">
                                                    Max yearly benefit at +{batteryRecommendation.bestYearly.addedBatteryKwh} kWh.
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="text-xs text-slate-400">
                                            <div>
                                                No worthwhile battery recommendation for this PV setting in the selected timeframe.
                                                {batteryRecommendation.thresholds && (
                                                    <span> (Needs ≥ {batteryRecommendation.thresholds.minYearlyBenefit} {config.currency}/yr and ROI ≤ {batteryRecommendation.thresholds.maxRoiYears}y.)</span>
                                                )}
                                            </div>
                                            {batteryRecommendation.bestYearly && (
                                                <div className="mt-2 text-[10px] text-slate-500">
                                                    Best-case add-on: +{batteryRecommendation.bestYearly.addedBatteryKwh} kWh → {batteryRecommendation.bestYearly.yearlyBenefit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {config.currency}/yr,
                                                    saves ~{batteryRecommendation.bestYearly.yearlySavedImportKwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh import/yr,
                                                    export Δ ~{batteryRecommendation.bestYearly.yearlyExportDeltaKwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh/yr.
                                                </div>
                                            )}
                                        </div>
                                    )}
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