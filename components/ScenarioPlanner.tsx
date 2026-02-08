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
    const [loadError, setLoadError] = useState<string | null>(null);
    
    // Scenarios
    const [addedPvPercent, setAddedPvPercent] = useState<number>(0); // 0 to 200%
    const [addedBatteryKwh, setAddedBatteryKwh] = useState<number>(0); // 0 to 20 kWh

    // Costs (Defaults: 1000/kWp, 400/kWh)
    const [costPerKwp, setCostPerKwp] = useState<number>(1000);
    const [costPerKwhBat, setCostPerKwhBat] = useState<number>(400);

    type UpgradeFocus = 'roi' | 'roiMax' | 'autonomy';
    const clampNumber = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

    const [upgradeFocus, setUpgradeFocus] = useState<UpgradeFocus>(() => {
        try {
            const v = window.localStorage.getItem('sunflow.scenarioPlanner.upgradeFocus');
            return (v === 'autonomy' || v === 'roi' || v === 'roiMax') ? v : 'roi';
        } catch {
            return 'roi';
        }
    });

    const [roiHorizonYears, setRoiHorizonYears] = useState<number>(() => {
        try {
            const raw = window.localStorage.getItem('sunflow.scenarioPlanner.roiHorizonYears');
            const parsed = raw ? Number(raw) : 20;
            return clampNumber(Number.isFinite(parsed) ? parsed : 20, 5, 30);
        } catch {
            return 20;
        }
    });

    const [simulationWindow, setSimulationWindow] = useState<SimulationWindow>('year');

    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        try {
            window.localStorage.setItem('sunflow.scenarioPlanner.upgradeFocus', upgradeFocus);
            window.localStorage.setItem('sunflow.scenarioPlanner.roiHorizonYears', String(clampNumber(roiHorizonYears, 5, 30)));
        } catch {
            // ignore
        }
    }, [upgradeFocus, roiHorizonYears]);

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
        if (!isOpen) return;

        // Fetch on every open so the simulator uses current data after imports/updates.
        setLoading(true);
        setLoadError(null);
        Promise.all([
            getSimulationData(),
            getTariffs()
        ])
            .then(([simData, tariffData]) => {
                setData(simData);
                setTariffs(tariffData);
            })
            .catch(err => {
                console.error("Sim data fail", err);
                setLoadError('Failed to load historical data. Please try again.');
                setData([]);
            })
            .finally(() => setLoading(false));
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
        curtailedWh: number;
        autonomyPct: number;
        endSocWh: number;
    };

    type BatteryModelParams = {
        initialSocWh: number;
        chargeEff: number;
        dischargeEff: number;
        maxChargeWhPerHour: number; // Wh/h (numerically equivalent to W avg over the hour)
        maxDischargeWhPerHour: number;
        maxExportWhPerHour?: number; // Optional export cap (Wh/h or W avg over the hour)
    };

    const simulate = (dataPoints: SimulationDataPoint[], pvPercent: number, batteryCapacityWh: number, model: BatteryModelParams): ScenarioSimResult => {
        let currentSocWh = Math.max(0, Math.min(batteryCapacityWh, model.initialSocWh));
        let totalLoadWh = 0;
        let totalPvWh = 0;
        let importedWh = 0;
        let exportedWh = 0;
        let curtailedWh = 0;

        // Conservative fallback when we cannot infer real power limits from measured battery flows.
        // If the model uses non-finite limits (Infinity), assume ~0.5C but cap at a typical
        // residential charge/discharge inverter power (≈5kW). This avoids over-promising
        // benefits for very large (simulated) batteries.
        const defaultMaxWhPerHour = Math.max(0, Math.min(batteryCapacityWh * 0.5, 5000));
        const maxChargeWhPerHour = Number.isFinite(model.maxChargeWhPerHour) ? Math.max(0, model.maxChargeWhPerHour) : defaultMaxWhPerHour;
        const maxDischargeWhPerHour = Number.isFinite(model.maxDischargeWhPerHour) ? Math.max(0, model.maxDischargeWhPerHour) : defaultMaxWhPerHour;

        dataPoints.forEach(point => {
            const loadWh = point.l;
            const pvWh = point.p * (1 + (pvPercent / 100));

            totalLoadWh += loadWh;
            totalPvWh += pvWh;

            const net = pvWh - loadWh;
            if (net > 0) {
                const space = batteryCapacityWh - currentSocWh;
                const chargeInput = Math.min(
                    net,
                    maxChargeWhPerHour,
                    model.chargeEff > 0 ? (space / model.chargeEff) : 0
                );
                const stored = chargeInput * model.chargeEff;
                currentSocWh += stored;
                const remainingExport = net - chargeInput;
                const exportCap = (model.maxExportWhPerHour !== null && model.maxExportWhPerHour !== undefined && Number.isFinite(model.maxExportWhPerHour))
                    ? Math.max(0, Number(model.maxExportWhPerHour))
                    : Infinity;
                const exported = Math.min(remainingExport, exportCap);
                exportedWh += exported;
                curtailedWh += Math.max(0, remainingExport - exported);
            } else {
                const deficit = Math.abs(net);

                // Battery can only deliver up to (stored * dischargeEff) to the load.
                const availableOut = currentSocWh * model.dischargeEff;
                const dischargeOut = Math.min(
                    deficit,
                    maxDischargeWhPerHour,
                    availableOut
                );
                const drawnFromBattery = model.dischargeEff > 0 ? (dischargeOut / model.dischargeEff) : 0;
                currentSocWh -= drawnFromBattery;
                importedWh += (deficit - dischargeOut);
            }
        });

        const autonomyPct = totalLoadWh > 0 ? 100 * (1 - (importedWh / totalLoadWh)) : 0;
        return { totalLoadWh, totalPvWh, importedWh, exportedWh, curtailedWh, autonomyPct, endSocWh: currentSocWh };
    };

    const percentile = (values: number[], p: number): number | null => {
        if (values.length === 0) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
        return sorted[idx];
    };

    const inferBatteryModel = (dataPoints: SimulationDataPoint[]) => {
        const charge = dataPoints
            .map(d => d.bc)
            .filter((v): v is number => v !== null && v !== undefined)
            .filter(v => v > 0);
        const discharge = dataPoints
            .map(d => d.bd)
            .filter((v): v is number => v !== null && v !== undefined)
            .filter(v => v > 0);

        // Only infer when we have a meaningful amount of measured data.
        const hasMeasured = (charge.length + discharge.length) >= 24;

        const sumCharge = charge.reduce((a, b) => a + b, 0);
        const sumDischarge = discharge.reduce((a, b) => a + b, 0);
        const rteRaw = (sumCharge > 0 && sumDischarge > 0) ? (sumDischarge / sumCharge) : null;
        const rte = rteRaw === null ? null : Math.max(0.6, Math.min(1.0, rteRaw));
        const eta = rte === null ? 1 : Math.sqrt(rte);

        const maxCharge = percentile(charge, 95);
        const maxDischarge = percentile(discharge, 95);

        // Conservative defaults if we cannot infer from measured flows.
        // Typical round-trip efficiency is ~0.88..0.93. We use ~0.92 (0.96^2).
        const defaultEta = 0.96;

        return {
            hasMeasured,
            chargeEff: hasMeasured ? eta : defaultEta,
            dischargeEff: hasMeasured ? eta : defaultEta,
            maxChargeWhPerHour: (hasMeasured && maxCharge !== null) ? Math.max(0, maxCharge) : Infinity,
            maxDischargeWhPerHour: (hasMeasured && maxDischarge !== null) ? Math.max(0, maxDischarge) : Infinity,
        };
    };

    const inferExportCapWhPerHour = (dataPoints: SimulationDataPoint[]) => {
        const exports = dataPoints
            .map(d => d.ge)
            .filter((v): v is number => v !== null && v !== undefined)
            .filter(v => v > 0);

        // Only infer when we have a meaningful amount of measured export data.
        if (exports.length < 24) return null as number | null;

        const p95 = percentile(exports, 95);
        if (p95 === null) return null;
        // Round to a stable value to avoid flickering in the UI.
        const rounded = Math.round(p95 / 50) * 50;
        return rounded > 0 ? rounded : null;
    };

    const estimateCyclicInitialSocWh = (
        dataPoints: SimulationDataPoint[],
        pvPercent: number,
        batteryCapacityWh: number,
        baseModel: Omit<BatteryModelParams, 'initialSocWh'>
    ) => {
        // If we don't have measured SoC, assume the dataset is representative and find a
        // stable (cyclic) initial SoC by iterating startSoC := endSoC.
        let guess = 0;
        for (let i = 0; i < 10; i += 1) {
            const res = simulate(dataPoints, pvPercent, batteryCapacityWh, { ...baseModel, initialSocWh: guess });
            const next = res.endSocWh;
            if (Math.abs(next - guess) < 1) {
                guess = next;
                break;
            }
            guess = next;
        }
        return Math.max(0, Math.min(batteryCapacityWh, guess));
    };

    const measuredBaseFromData = (dataPoints: SimulationDataPoint[]): ScenarioSimResult | null => {
        // If grid import/export is available, we can compute the baseline exactly from history.
        // This avoids assuming an “optimal” battery dispatch for the real system.
        const hasGi = dataPoints.some(d => d.gi !== null && d.gi !== undefined);
        const hasGe = dataPoints.some(d => d.ge !== null && d.ge !== undefined);
        if (!hasGi && !hasGe) return null;

        let totalLoadWh = 0;
        let totalPvWh = 0;
        let importedWh = 0;
        let exportedWh = 0;

        dataPoints.forEach(point => {
            totalLoadWh += point.l;
            totalPvWh += point.p;
            if (point.gi !== null && point.gi !== undefined) importedWh += Number(point.gi);
            if (point.ge !== null && point.ge !== undefined) exportedWh += Number(point.ge);
        });

        const autonomyPct = totalLoadWh > 0 ? 100 * (1 - (importedWh / totalLoadWh)) : 0;
        return { totalLoadWh, totalPvWh, importedWh, exportedWh, autonomyPct, endSocWh: 0 };
    };

    const simulations = useMemo(() => {
        if (!filteredHourlyData) return null;

        // Use configured battery capacity only. Avoid simulating a “phantom” battery when the user has none.
        const baseBatteryWh = (config.batteryCapacity || 0) * 1000;

        const inferredModel = inferBatteryModel(filteredHourlyData);
        const inferredExportCap = inferExportCapWhPerHour(filteredHourlyData);
        const baseModelNoInitial: Omit<BatteryModelParams, 'initialSocWh'> = {
            chargeEff: inferredModel.chargeEff,
            dischargeEff: inferredModel.dischargeEff,
            maxChargeWhPerHour: inferredModel.maxChargeWhPerHour,
            maxDischargeWhPerHour: inferredModel.maxDischargeWhPerHour,
            maxExportWhPerHour: inferredExportCap ?? undefined,
        };

        // Try to initialize SoC from historical data (when available).
        // We interpret `s` as a percentage of the *current/base* battery capacity.
        // For larger simulated batteries, we keep the absolute energy the same.
        const firstSocPct = filteredHourlyData.find(d => d.s !== null && d.s !== undefined)?.s;
        const initialSocPct = (firstSocPct === null || firstSocPct === undefined) ? null : Math.max(0, Math.min(100, Number(firstSocPct)));
        const initialEnergyWhBaseMeasured = initialSocPct === null ? null : (initialSocPct / 100) * baseBatteryWh;

        const baseMeasured = measuredBaseFromData(filteredHourlyData);

        const baseInitial = initialEnergyWhBaseMeasured ?? estimateCyclicInitialSocWh(filteredHourlyData, 0, baseBatteryWh, baseModelNoInitial);
        const pvOnlyInitial = initialEnergyWhBaseMeasured ?? estimateCyclicInitialSocWh(filteredHourlyData, addedPvPercent, baseBatteryWh, baseModelNoInitial);
        const pvPlusBatteryCap = baseBatteryWh + (addedBatteryKwh * 1000);
        const pvPlusBatteryInitial = initialEnergyWhBaseMeasured ?? estimateCyclicInitialSocWh(filteredHourlyData, addedPvPercent, pvPlusBatteryCap, baseModelNoInitial);

        // If we have measured SoC, keep the absolute starting energy identical across scenarios.
        // If not, use a cyclic estimate per scenario to reduce boundary effects.
        const initialEnergyWhBase = initialEnergyWhBaseMeasured ?? baseInitial;
        const initialEnergyWhPvOnly = initialEnergyWhBaseMeasured ?? pvOnlyInitial;
        const initialEnergyWhPvPlusBattery = initialEnergyWhBaseMeasured ?? pvPlusBatteryInitial;

        const baseSimulated = simulate(filteredHourlyData, 0, baseBatteryWh, { ...baseModelNoInitial, initialSocWh: initialEnergyWhBase });
        const base = baseMeasured ?? baseSimulated;
        const pvOnly = simulate(filteredHourlyData, addedPvPercent, baseBatteryWh, { ...baseModelNoInitial, initialSocWh: initialEnergyWhPvOnly });
        const pvPlusBattery = simulate(filteredHourlyData, addedPvPercent, pvPlusBatteryCap, { ...baseModelNoInitial, initialSocWh: initialEnergyWhPvPlusBattery });

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

        const horizonYears = clampNumber(roiHorizonYears, 5, 30);
        const netGainOverHorizon = (yearlyBenefit: number, invest: number) => (yearlyBenefit * horizonYears) - invest;

        return {
            totalInvest,
            totalYearlyBenefit: yearlyBenefitCombined,
            roiYears: roiYearsCombined,
            horizonYears,
            netGainHorizon: netGainOverHorizon(yearlyBenefitCombined, totalInvest),
            pvOnly: {
                invest: investPv,
                yearlyBenefit: yearlyBenefitPvOnly,
                roiYears: roiYearsPvOnly,
                netGainHorizon: netGainOverHorizon(yearlyBenefitPvOnly, investPv),
            },
            batteryIncremental: {
                invest: investBat,
                yearlyBenefit: yearlyBenefitBatteryIncremental,
                roiYears: roiYearsBatteryIncremental,
                netGainHorizon: netGainOverHorizon(yearlyBenefitBatteryIncremental, investBat),
            },
            estimatedBaseKwp
        };

    }, [simulations, costPerKwp, costPerKwhBat, addedPvPercent, addedBatteryKwh, windowedData, activeTariff, config.systemCapacity, dataCoverage.days, roiHorizonYears]);

    // PV recommendation (variant 1: PV-only, independent from battery add-on)
    const pvRecommendation = useMemo(() => {
        if (!filteredHourlyData) return null;
        if (!financials) return null;

        const MIN_YEARLY_BENEFIT = 5; // {currency}/year
        const horizonYears = clampNumber(roiHorizonYears, 5, 30);
        const maxReasonableRoiYears = horizonYears;

        const yearsCovered = Math.max(0.1, dataCoverage.days / 365);
        const gridCost = activeTariff.costPerKwh;
        const feedIn = activeTariff.feedInTariff;

        const baseBatteryWh = (config.batteryCapacity || 0) * 1000;
        const firstSocPct = filteredHourlyData.find(d => d.s !== null && d.s !== undefined)?.s;
        const initialSocPct = (firstSocPct === null || firstSocPct === undefined) ? null : Math.max(0, Math.min(100, Number(firstSocPct)));
        const inferredModel = inferBatteryModel(filteredHourlyData);
        const baseModelNoInitial: Omit<BatteryModelParams, 'initialSocWh'> = {
            chargeEff: inferredModel.chargeEff,
            dischargeEff: inferredModel.dischargeEff,
            maxChargeWhPerHour: inferredModel.maxChargeWhPerHour,
            maxDischargeWhPerHour: inferredModel.maxDischargeWhPerHour,
        };

        // Baseline: prefer measured grid flows if present.
        const measuredBase = measuredBaseFromData(filteredHourlyData);
        const initialEnergyWhBaseMeasured = initialSocPct === null ? null : (initialSocPct / 100) * baseBatteryWh;
        const initialEnergyWhForSweep = initialEnergyWhBaseMeasured ?? estimateCyclicInitialSocWh(filteredHourlyData, 0, baseBatteryWh, baseModelNoInitial);
        const simulatedBase = simulate(filteredHourlyData, 0, baseBatteryWh, { ...baseModelNoInitial, initialSocWh: initialEnergyWhForSweep });
        const base = measuredBase ?? simulatedBase;

        const benefitOverDataset = (from: ScenarioSimResult, to: ScenarioSimResult) => {
            const savedImportKwh = (from.importedWh - to.importedWh) / 1000;
            const extraExportKwh = (to.exportedWh - from.exportedWh) / 1000;
            return (savedImportKwh * gridCost) + (extraExportKwh * feedIn);
        };

        type Candidate = {
            addedPvPercent: number;
            addedKwp: number;
            invest: number;
            yearlyBenefit: number;
            roiYears: number;
            netGainHorizon: number;
            autonomyPct: number;
            autonomyDeltaPct: number;
        };

        const candidates: Candidate[] = [];
        for (let pvPercent = 0; pvPercent <= 200; pvPercent += 10) {
            const pvOnly = simulate(filteredHourlyData, pvPercent, baseBatteryWh, { ...baseModelNoInitial, initialSocWh: initialEnergyWhForSweep });
            const totalBenefit = benefitOverDataset(base, pvOnly);
            const yearlyBenefit = totalBenefit / yearsCovered;

            const addedKwp = financials.estimatedBaseKwp * (pvPercent / 100);
            const invest = addedKwp * costPerKwp;
            const roiYears = invest <= 0 ? 0 : (yearlyBenefit > 0 ? invest / yearlyBenefit : Infinity);
            const netGainHorizon = (yearlyBenefit * horizonYears) - invest;

            const autonomyPct = pvOnly.autonomyPct;
            const autonomyDeltaPct = autonomyPct - base.autonomyPct;

            candidates.push({ addedPvPercent: pvPercent, addedKwp, invest, yearlyBenefit, roiYears, netGainHorizon, autonomyPct, autonomyDeltaPct });
        }

        const addOns = candidates.filter(c => c.addedPvPercent > 0);
        if (addOns.length === 0) {
            return { recommended: null as Candidate | null, bestYearly: null as Candidate | null, thresholds: { minYearlyBenefit: MIN_YEARLY_BENEFIT, maxRoiYears: maxReasonableRoiYears, focus: upgradeFocus as UpgradeFocus } };
        }

        const positive = addOns.filter(c => c.yearlyBenefit > 0);
        const bestYearly = [...addOns].sort((a, b) => b.yearlyBenefit - a.yearlyBenefit)[0] || null;

        const AUTONOMY_NEAR_MAX_PCT = 0.25; // pick a “sensible” upgrade close to max autonomy

        if (upgradeFocus === 'autonomy') {
            const improving = addOns.filter(c => c.autonomyDeltaPct > 0.01);
            if (improving.length === 0) {
                return { recommended: null as Candidate | null, bestYearly, thresholds: { minYearlyBenefit: MIN_YEARLY_BENEFIT, maxRoiYears: maxReasonableRoiYears, focus: upgradeFocus as UpgradeFocus } };
            }

            const maxAutonomy = Math.max(...improving.map(c => c.autonomyPct));
            const nearMax = improving.filter(c => (maxAutonomy - c.autonomyPct) <= AUTONOMY_NEAR_MAX_PCT);
            const recommended = [...nearMax].sort((a, b) => {
                if (a.invest !== b.invest) return a.invest - b.invest;
                return a.addedPvPercent - b.addedPvPercent;
            })[0];

            return { recommended, bestYearly, thresholds: { minYearlyBenefit: MIN_YEARLY_BENEFIT, maxRoiYears: maxReasonableRoiYears, focus: upgradeFocus as UpgradeFocus } };
        }

        // ROI focus: require economic meaning + break-even within horizon
        const meaningful = positive.filter(c => (c.yearlyBenefit >= MIN_YEARLY_BENEFIT) && (c.roiYears <= maxReasonableRoiYears));
        if (meaningful.length === 0) {
            return { recommended: null as Candidate | null, bestYearly, thresholds: { minYearlyBenefit: MIN_YEARLY_BENEFIT, maxRoiYears: maxReasonableRoiYears, focus: upgradeFocus as UpgradeFocus } };
        }

        const recommended = [...meaningful].sort((a, b) => {
            if (upgradeFocus === 'roiMax') {
                if (b.addedPvPercent !== a.addedPvPercent) return b.addedPvPercent - a.addedPvPercent;
                if (b.netGainHorizon !== a.netGainHorizon) return b.netGainHorizon - a.netGainHorizon;
                return a.roiYears - b.roiYears;
            }
            if (b.netGainHorizon !== a.netGainHorizon) return b.netGainHorizon - a.netGainHorizon;
            return a.roiYears - b.roiYears;
        })[0];

        return { recommended, bestYearly, thresholds: { minYearlyBenefit: MIN_YEARLY_BENEFIT, maxRoiYears: maxReasonableRoiYears, focus: upgradeFocus as UpgradeFocus } };
    }, [filteredHourlyData, financials, dataCoverage.days, activeTariff, config.batteryCapacity, costPerKwp, upgradeFocus, roiHorizonYears]);

    // Auto-recommend battery size (0..30 kWh) for the currently selected PV slider.
    const batteryRecommendation = useMemo(() => {
        if (!filteredHourlyData) return null;
        if (!financials) return null;

        // Guardrails to avoid recommending upgrades with negligible impact.
        // These are heuristics (not hard truths) to prevent misleading suggestions.
        const MIN_YEARLY_BENEFIT = 5; // {currency}/year
        const MAX_REASONABLE_ROI_YEARS = clampNumber(roiHorizonYears, 5, 30);

        const yearsCovered = Math.max(0.1, dataCoverage.days / 365);
        const gridCost = activeTariff.costPerKwh;
        const feedIn = activeTariff.feedInTariff;

        const baseBatteryWh = (config.batteryCapacity || 0) * 1000;

        // If the user did not select a PV upgrade manually (slider at 0), but we have a PV suggestion,
        // base the battery recommendation on that PV upgrade so the combined plan is consistent.
        const pvBasisPercent = (addedPvPercent > 0)
            ? addedPvPercent
            : (pvRecommendation?.recommended?.addedPvPercent ?? 0);

        // For ROI guardrails we also consider the combined plan (PV basis + battery add-on)
        // and only recommend batteries that keep the total payback within the selected horizon.
        const investPvBasis = (financials.estimatedBaseKwp * (pvBasisPercent / 100)) * costPerKwp;
        const firstSocPct = filteredHourlyData.find(d => d.s !== null && d.s !== undefined)?.s;
        const initialSocPct = (firstSocPct === null || firstSocPct === undefined) ? null : Math.max(0, Math.min(100, Number(firstSocPct)));
        const inferredModel = inferBatteryModel(filteredHourlyData);
        const baseModelNoInitial: Omit<BatteryModelParams, 'initialSocWh'> = {
            chargeEff: inferredModel.chargeEff,
            dischargeEff: inferredModel.dischargeEff,
            maxChargeWhPerHour: inferredModel.maxChargeWhPerHour,
            maxDischargeWhPerHour: inferredModel.maxDischargeWhPerHour,
        };

        const initialEnergyWhBaseMeasured = initialSocPct === null ? null : (initialSocPct / 100) * baseBatteryWh;
        // For the recommendation sweep, keep the same absolute starting energy for all candidates
        // to make them comparable and avoid extra cyclic estimation work.
        const initialEnergyWhForSweep = initialEnergyWhBaseMeasured ?? estimateCyclicInitialSocWh(filteredHourlyData, pvBasisPercent, baseBatteryWh, baseModelNoInitial);

        // Baseline for combined ROI: prefer measured grid flows if present.
        const measuredBase = measuredBaseFromData(filteredHourlyData);
        const simulatedBase = simulate(filteredHourlyData, 0, baseBatteryWh, { ...baseModelNoInitial, initialSocWh: initialEnergyWhForSweep });
        const base = measuredBase ?? simulatedBase;

        const pvOnly = simulate(filteredHourlyData, pvBasisPercent, baseBatteryWh, { ...baseModelNoInitial, initialSocWh: initialEnergyWhForSweep });

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
            combinedRoiYears: number;
            autonomyPct: number;
            autonomyDeltaPct: number;
            netGainHorizon: number;
        };

        const candidates: Candidate[] = [];
        for (let kwh = 0; kwh <= 30; kwh += 1) {
            const sim = simulate(filteredHourlyData, pvBasisPercent, baseBatteryWh + (kwh * 1000), { ...baseModelNoInitial, initialSocWh: initialEnergyWhForSweep });
            const savedImportKwh = (pvOnly.importedWh - sim.importedWh) / 1000;
            const exportDeltaKwh = (sim.exportedWh - pvOnly.exportedWh) / 1000;

            const totalBenefit = (savedImportKwh * gridCost) + (exportDeltaKwh * feedIn);
            const yearlyBenefit = totalBenefit / yearsCovered;
            const yearlySavedImportKwh = savedImportKwh / yearsCovered;
            const yearlyExportDeltaKwh = exportDeltaKwh / yearsCovered;
            const invest = kwh * costPerKwhBat;
            const roiYears = invest <= 0 ? 0 : (yearlyBenefit > 0 ? invest / yearlyBenefit : Infinity);

            const totalBenefitCombined = benefitOverDataset(base, sim);
            const yearlyBenefitCombined = totalBenefitCombined / yearsCovered;
            const totalInvestCombined = investPvBasis + invest;
            const combinedRoiYears = totalInvestCombined <= 0 ? 0 : (yearlyBenefitCombined > 0 ? totalInvestCombined / yearlyBenefitCombined : Infinity);

            const autonomyPct = sim.autonomyPct;
            const autonomyDeltaPct = autonomyPct - pvOnly.autonomyPct;
            const netGainHorizon = (yearlyBenefit * clampNumber(roiHorizonYears, 5, 30)) - invest;
            candidates.push({ addedBatteryKwh: kwh, yearlyBenefit, yearlySavedImportKwh, yearlyExportDeltaKwh, invest, roiYears, combinedRoiYears, autonomyPct, autonomyDeltaPct, netGainHorizon });
        }

        const addOns = candidates.filter(c => c.addedBatteryKwh > 0);
        const positive = addOns.filter(c => c.yearlyBenefit > 0);
        const bestYearlyAny = [...addOns].sort((a, b) => b.yearlyBenefit - a.yearlyBenefit)[0] || null;

        const focus = upgradeFocus;

        // Only recommend if it is economically meaningful (ROI mode).
        const meaningfulRoi = positive.filter(c =>
            (c.yearlyBenefit >= MIN_YEARLY_BENEFIT) &&
            (c.roiYears <= MAX_REASONABLE_ROI_YEARS) &&
            // Combined plan guardrail: PV basis + battery must also pay back within the selected horizon.
            (c.combinedRoiYears <= MAX_REASONABLE_ROI_YEARS)
        );

        const autonomyImproving = addOns.filter(c => c.autonomyDeltaPct > 0.01);

        if (addOns.length === 0) {
            return {
                recommended: null as Candidate | null,
                bestYearly: bestYearlyAny,
                thresholds: { minYearlyBenefit: MIN_YEARLY_BENEFIT, maxRoiYears: MAX_REASONABLE_ROI_YEARS, focus },
            };
        }

        const AUTONOMY_NEAR_MAX_PCT = 0.25; // pick a “sensible” upgrade close to max autonomy

        if (focus === 'autonomy') {
            if (autonomyImproving.length === 0) {
                return {
                    recommended: null as Candidate | null,
                    bestYearly: bestYearlyAny,
                    thresholds: { minYearlyBenefit: MIN_YEARLY_BENEFIT, maxRoiYears: MAX_REASONABLE_ROI_YEARS, focus },
                };
            }

            // “Sensible autonomy”: pick the cheapest size that is very close to max autonomy.
            const maxAutonomy = Math.max(...autonomyImproving.map(c => c.autonomyPct));
            const nearMax = autonomyImproving.filter(c => (maxAutonomy - c.autonomyPct) <= AUTONOMY_NEAR_MAX_PCT);
            const recommended = [...nearMax].sort((a, b) => {
                if (a.invest !== b.invest) return a.invest - b.invest;
                return a.addedBatteryKwh - b.addedBatteryKwh;
            })[0];

            return { recommended, bestYearly: bestYearlyAny, thresholds: { minYearlyBenefit: MIN_YEARLY_BENEFIT, maxRoiYears: MAX_REASONABLE_ROI_YEARS, focus } };
        }

        // ROI focus: recommend only if it breaks even within the selected horizon.
        if (meaningfulRoi.length === 0) {
            return {
                recommended: null as Candidate | null,
                bestYearly: bestYearlyAny,
                thresholds: { minYearlyBenefit: MIN_YEARLY_BENEFIT, maxRoiYears: MAX_REASONABLE_ROI_YEARS, focus },
            };
        }

        // Prefer best net gain over horizon, then fastest payback.
        const recommended = [...meaningfulRoi].sort((a, b) => {
            if (focus === 'roiMax') {
                if (b.addedBatteryKwh !== a.addedBatteryKwh) return b.addedBatteryKwh - a.addedBatteryKwh;
                if (b.netGainHorizon !== a.netGainHorizon) return b.netGainHorizon - a.netGainHorizon;
                return a.roiYears - b.roiYears;
            }
            if (b.netGainHorizon !== a.netGainHorizon) return b.netGainHorizon - a.netGainHorizon;
            return a.roiYears - b.roiYears;
        })[0];

        return { recommended, bestYearly: bestYearlyAny, thresholds: { minYearlyBenefit: MIN_YEARLY_BENEFIT, maxRoiYears: MAX_REASONABLE_ROI_YEARS, focus } };
    }, [filteredHourlyData, financials, dataCoverage.days, activeTariff, config.batteryCapacity, addedPvPercent, costPerKwp, costPerKwhBat, upgradeFocus, roiHorizonYears, pvRecommendation]);

    const dataBasis = useMemo(() => {
        if (!filteredHourlyData) return null;

        const hasSoc = filteredHourlyData.some(d => d.s !== null && d.s !== undefined);
        const hasBatteryFlows = filteredHourlyData.some(d => (d.bc !== null && d.bc !== undefined) || (d.bd !== null && d.bd !== undefined));
        const hasGridFlows = filteredHourlyData.some(d => (d.gi !== null && d.gi !== undefined) || (d.ge !== null && d.ge !== undefined));

        const inferred = inferBatteryModel(filteredHourlyData);
        const inferredExportCap = inferExportCapWhPerHour(filteredHourlyData);

        // We use measured SoC if present. Otherwise: cyclic estimate (steady-state) to avoid boundary artifacts.
        const startSocMethod = hasSoc ? 'Measured SoC' : 'Estimated (steady-state)';

        const roundTripEffPct = inferred.hasMeasured
            ? Math.round((inferred.chargeEff * inferred.dischargeEff) * 100)
            : null;

        return {
            hasSoc,
            hasBatteryFlows,
            hasGridFlows,
            startSocMethod,
            inferred,
            roundTripEffPct,
            inferredExportCap,
        };
    }, [filteredHourlyData]);

    const recommendationConfidence = useMemo(() => {
        if (!dataBasis) {
            return { level: 'none' as const, label: 'No data', detail: 'No usable hourly data.' };
        }

        // Window-relative heuristic: “6/7 days” should not be penalized like “6/365 days”.
        // We also factor in whether measured grid flows exist (strongly improves trustworthiness)
        // and whether the timeframe contains many partial (non-hourly) days.
        const days = dataCoverage.days;
        const expectedDays = windowBounds.expectedDays;
        const coveragePct = expectedDays > 0 ? (days / expectedDays) * 100 : 0;
        const hasGrid = dataBasis.hasGridFlows;
        const hasBatteryFlows = dataBasis.hasBatteryFlows;
        const hourlyQualityPct = dataCoverage.quality; // among days with any data: how many are complete hourly days

        const baseDetail = `Complete days: ${days}/${expectedDays} (${Math.round(coveragePct)}%).`;
        const qualityHint = hourlyQualityPct < 80 ? ` Hourly quality is only ${Math.round(hourlyQualityPct)}% (many partial days).` : '';

        const mk = (level: 'high' | 'medium' | 'low' | 'veryLow', label: string, extra: string) => {
            const flows = hasGrid
                ? (hasBatteryFlows ? 'Measured grid + battery flows.' : 'Measured grid flows.')
                : 'No measured grid flows.';
            return { level, label, detail: `${baseDetail} ${flows} ${extra}${qualityHint}`.trim() };
        };

        // Cap confidence if grid flows are missing (we then rely more on simulation assumptions).
        const gridCap = hasGrid ? null : ('low' as const);

        if (expectedDays <= 7) {
            if (days >= 6) return mk(gridCap === 'low' ? 'low' : 'high', gridCap === 'low' ? 'Low' : 'High', 'Short window, good coverage.');
            if (days >= 4) return mk('medium', 'Medium', 'Short window, decent coverage.');
            if (days >= 2) return mk('low', 'Low', 'Short window, limited coverage.');
            return mk('veryLow', 'Very low', 'Too few complete days in this window.');
        }

        if (expectedDays <= 31) {
            if (days >= 27 && hasGrid) return mk('high', 'High', 'Month window, strong coverage.');
            if (days >= 21 && hasGrid) return mk('medium', 'Medium', 'Month window, good coverage.');
            if (days >= 14) return mk('low', 'Low', 'Month window, partial coverage.');
            return mk('veryLow', 'Very low', 'Too few complete days in this window.');
        }

        if (expectedDays <= 182) {
            if (days >= 160 && hasGrid) return mk('high', 'High', '6-month window, strong coverage.');
            if (days >= 120 && hasGrid) return mk('medium', 'Medium', '6-month window, good coverage.');
            if (days >= 60) return mk('low', 'Low', '6-month window, partial coverage.');
            return mk('veryLow', 'Very low', 'Too few complete days in this window.');
        }

        // Year-ish windows
        if (days >= 300 && hasGrid) {
            return mk('high', 'High', 'Long history, strong coverage.');
        }
        if (days >= 180 && hasGrid) {
            return mk('medium', 'Medium', 'Long history, good coverage.');
        }
        if (days >= 90) {
            return mk('low', 'Low', 'Long history, partial coverage.');
        }

        return mk('veryLow', 'Very low', 'Too few complete days in this window.');
    }, [dataBasis, dataCoverage.days, dataCoverage.quality, windowBounds.expectedDays]);

    const loadProfileInsight = useMemo(() => {
        if (!filteredHourlyData) return null;

        let loadTotalWh = 0;
        let loadEveningWh = 0;
        let loadDayWh = 0;

        filteredHourlyData.forEach(p => {
            const h = new Date(p.t).getHours();
            loadTotalWh += p.l;
            if (h >= 17 && h <= 23) loadEveningWh += p.l;
            if (h >= 10 && h <= 15) loadDayWh += p.l;
        });

        if (loadTotalWh <= 0) return null;

        const eveningPct = (loadEveningWh / loadTotalWh) * 100;
        const dayPct = (loadDayWh / loadTotalWh) * 100;

        // Heuristic categories for explainability (not for sizing decisions).
        let hint: string | null = null;
        if (eveningPct >= 45) {
            hint = `Your consumption is evening-heavy (~${Math.round(eveningPct)}% between 17–23h). Batteries usually help most by shifting midday PV surplus into the evening.`;
        } else if (dayPct >= 45) {
            hint = `Your consumption is daytime-heavy (~${Math.round(dayPct)}% between 10–15h). PV upgrades often deliver more direct self-consumption than batteries in this profile.`;
        }

        return {
            eveningPct,
            dayPct,
            hint,
        };
    }, [filteredHourlyData]);

    const plannerWarnings = useMemo(() => {
        if (!financials) return [] as Array<{ type: 'info' | 'warn'; text: string }>;

        const warnings: Array<{ type: 'info' | 'warn'; text: string }> = [];

        // 1) Plausibility: PV-to-battery ratio (rule-of-thumb)
        const baseKwp = financials.estimatedBaseKwp;
        const pvTotalKwp = baseKwp * (1 + (addedPvPercent / 100));
        const batTotalKwh = (config.batteryCapacity || 0) + addedBatteryKwh;

        if (pvTotalKwp > 0 && batTotalKwh > 0) {
            const ratio = batTotalKwh / pvTotalKwp; // kWh per kWp
            if (ratio >= 3) {
                warnings.push({
                    type: 'warn',
                    text: `Battery seems large vs PV (${ratio.toFixed(1)} kWh per kWp). In winter/low-sun periods it often won't fill, and ROI can look better in simulation than in reality.`,
                });
            } else if (ratio >= 2.2) {
                warnings.push({
                    type: 'info',
                    text: `Battery-to-PV ratio is on the high side (${ratio.toFixed(1)} kWh per kWp). Consider sizing storage to evening/night usage rather than winter charging.`,
                });
            }
        }

        // 2) Seasonal reality: annualization from a short/partial window
        const expected = windowBounds.expectedDays;
        const completeDays = dataCoverage.days;
        const coveragePct = expected > 0 ? (completeDays / expected) * 100 : 0;
        const annualizedFromShortWindow = simulationWindow !== 'year';
        const weakCoverage = coveragePct < 80;
        if (annualizedFromShortWindow) {
            warnings.push({
                type: 'warn',
                text: `Yearly return is annualized from ${WINDOW_LABEL[simulationWindow].toLowerCase()}. This can be very seasonal (summer vs winter).`,
            });
        } else if (weakCoverage) {
            warnings.push({
                type: 'warn',
                text: `Yearly return is annualized from incomplete data coverage (${Math.round(coveragePct)}%). Missing periods can skew ROI (especially seasonality).`,
            });
        }

        // 3) Economic optimism guardrail: very fast payback
        if ((addedPvPercent > 0 || addedBatteryKwh > 0) && Number.isFinite(financials.roiYears) && financials.roiYears > 0 && financials.roiYears < 5) {
            warnings.push({
                type: 'warn',
                text: `Payback < 5 years is unusually fast. Double-check costs (€/kWp, €/kWh) and note: export limits, inverter clipping and O&M are not modeled here.`,
            });
        }

        // 4) Technical constraints not modeled
        if ((addedPvPercent > 0 || addedBatteryKwh > 0)) {
            warnings.push({
                type: 'info',
                text: 'This planner does not model roof limits, inverter AC clipping, export caps, or battery power limits specific to your hardware (unless inferred from measured battery flows).',
            });
        }

        // 5) Explainability hint from load profile
        if (loadProfileInsight?.hint) {
            warnings.push({ type: 'info', text: loadProfileInsight.hint });
        }

        return warnings;
    }, [financials, addedPvPercent, addedBatteryKwh, config.batteryCapacity, dataCoverage.days, simulationWindow, windowBounds.expectedDays, loadProfileInsight, dataBasis]);


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

             {!loading && loadError && (
                 <div className="text-center py-10 bg-slate-900/50 rounded-xl border border-dashed border-slate-700">
                     <AlertTriangle className="text-red-400 mx-auto mb-3" size={48} />
                     <h3 className="text-white font-bold text-lg">Could not load data</h3>
                     <p className="text-slate-400 text-sm max-w-md mx-auto mt-2">{loadError}</p>
                 </div>
             )}

             {!loading && !loadError && data.length === 0 && (
                 <div className="text-center py-10 bg-slate-900/50 rounded-xl border border-dashed border-slate-700">
                     <Info className="text-blue-400 mx-auto mb-3" size={48} />
                     <h3 className="text-white font-bold text-lg">No historical data available</h3>
                     <p className="text-slate-400 text-sm max-w-md mx-auto mt-2">
                         Import or collect some history first, then reopen the simulator. The planner needs hourly data to simulate upgrades.
                     </p>
                 </div>
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

                            {/* Recommendation focus */}
                            <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-700">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="text-xs font-bold uppercase text-slate-400">Recommendation focus</div>
                                    <div className="text-[10px] text-slate-500">How suggestions are picked</div>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setUpgradeFocus('roi')}
                                        className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                                            upgradeFocus === 'roi'
                                                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
                                                : 'bg-slate-900/40 border-slate-700 text-slate-300 hover:bg-slate-900/60'
                                        }`}
                                    >
                                        ROI (best value)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setUpgradeFocus('roiMax')}
                                        className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                                            upgradeFocus === 'roiMax'
                                                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
                                                : 'bg-slate-900/40 border-slate-700 text-slate-300 hover:bg-slate-900/60'
                                        }`}
                                    >
                                        ROI (max upgrade)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setUpgradeFocus('autonomy')}
                                        className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                                            upgradeFocus === 'autonomy'
                                                ? 'bg-blue-500/15 border-blue-500/30 text-blue-200'
                                                : 'bg-slate-900/40 border-slate-700 text-slate-300 hover:bg-slate-900/60'
                                        }`}
                                    >
                                        Autonomy (sensible)
                                    </button>
                                </div>

                                <div className="mt-3 flex items-center justify-between gap-3">
                                    <label htmlFor="roiHorizonYears" className={`text-xs ${upgradeFocus === 'roi' ? 'text-slate-300' : 'text-slate-500'}`}>
                                        ROI horizon
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            id="roiHorizonYears"
                                            type="number"
                                            min={5}
                                            max={30}
                                            step={1}
                                            disabled={upgradeFocus === 'autonomy'}
                                            value={roiHorizonYears}
                                            onChange={(e) => setRoiHorizonYears(clampNumber(Number(e.target.value), 5, 30))}
                                            className={`w-16 px-2 py-1 rounded border bg-slate-950/40 text-right text-xs ${
                                                upgradeFocus !== 'autonomy'
                                                    ? 'border-slate-700 text-slate-200'
                                                    : 'border-slate-800 text-slate-600'
                                            }`}
                                        />
                                        <span className={`text-xs ${upgradeFocus !== 'autonomy' ? 'text-slate-400' : 'text-slate-600'}`}>years</span>
                                    </div>
                                </div>

                                <div className="mt-3 text-[10px] text-slate-500 leading-relaxed">
                                    <div>
                                        <strong>How it works:</strong> We simulate PV and battery upgrades on your hourly history.
                                    </div>
                                    <div>
                                        Benefit/year = saved import × buy price + extra export × sell price; ROI = invest / benefit.
                                    </div>
                                    <div>
                                        <strong>ROI (best value):</strong> picks the highest net gain within the ROI horizon. <strong>ROI (max upgrade):</strong> picks the largest upgrade that still pays back within the horizon.
                                    </div>
                                    <div>
                                        <strong>Autonomy (sensible):</strong> picks the cheapest upgrade that is very close to the maximum autonomy in this timeframe.
                                    </div>
                                </div>
                            </div>
                            
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
                                    aria-label="ADD PV Power"
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
                                    aria-label="ADD Storage"
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
                                        <strong>Accuracy:</strong> Uses only complete (hourly) days.
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

                                        {dataBasis && (
                                            <div className="mt-3 pt-3 border-t border-blue-500/20">
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="text-[10px] uppercase tracking-wide text-blue-300/80">Recommendation confidence</div>
                                                    <div className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                                        recommendationConfidence.level === 'high'
                                                            ? 'border-emerald-400/40 text-emerald-300'
                                                            : recommendationConfidence.level === 'medium'
                                                                ? 'border-blue-400/40 text-blue-300'
                                                                : recommendationConfidence.level === 'low'
                                                                    ? 'border-yellow-400/40 text-yellow-300'
                                                                    : 'border-red-400/40 text-red-300'
                                                    }`}>
                                                        {recommendationConfidence.label}
                                                    </div>
                                                </div>
                                                <div className="text-[10px] text-slate-500 mb-2">{recommendationConfidence.detail}</div>

                                                <div className="text-[10px] uppercase tracking-wide text-blue-300/80 mb-2">
                                                    Data used
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    <span className={`px-2 py-0.5 rounded-full border text-[10px] ${dataBasis.hasSoc ? 'border-emerald-400/40 text-emerald-300' : 'border-slate-500/30 text-slate-400'}`}>
                                                        SoC: {dataBasis.hasSoc ? 'yes' : 'no'}
                                                    </span>
                                                    <span className={`px-2 py-0.5 rounded-full border text-[10px] ${dataBasis.hasBatteryFlows ? 'border-emerald-400/40 text-emerald-300' : 'border-slate-500/30 text-slate-400'}`}>
                                                        Battery flows: {dataBasis.hasBatteryFlows ? 'yes' : 'no'}
                                                    </span>
                                                    <span className={`px-2 py-0.5 rounded-full border text-[10px] ${dataBasis.hasGridFlows ? 'border-emerald-400/40 text-emerald-300' : 'border-slate-500/30 text-slate-400'}`}>
                                                        Grid flows: {dataBasis.hasGridFlows ? 'yes' : 'no'}
                                                    </span>
                                                    <span className="px-2 py-0.5 rounded-full border text-[10px] border-slate-500/30 text-slate-300">
                                                        Start SoC: {dataBasis.startSocMethod}
                                                    </span>
                                                    {dataBasis.roundTripEffPct !== null && (
                                                        <span className="px-2 py-0.5 rounded-full border text-[10px] border-slate-500/30 text-slate-300">
                                                            RTE (est.): {dataBasis.roundTripEffPct}%
                                                        </span>
                                                    )}
                                                    {dataBasis.inferredExportCap !== null && dataBasis.inferredExportCap !== undefined && (
                                                        <span className="px-2 py-0.5 rounded-full border text-[10px] border-slate-500/30 text-slate-300">
                                                            Export cap (est.): {Math.round(dataBasis.inferredExportCap)} W
                                                        </span>
                                                    )}
                                                    {dataBasis.inferred.hasMeasured && (
                                                        <span className="px-2 py-0.5 rounded-full border text-[10px] border-slate-500/30 text-slate-300">
                                                            Power limits: inferred
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                                    <div 
                                        className={`h-full transition-all duration-1000 ${dataCoverage.percent === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                                        style={{ width: `${dataCoverage.percent}%` }}
                                    />
                                </div>
                                <div className="text-[10px] text-slate-500">
                                    Tip: short windows benefit strongly from measured SoC.
                                </div>
                            </div>
                        </div>

                        {/* RIGHT COL: VISUALS */}
                        <div className="flex flex-col justify-center gap-6">
                            {/* Summary (less stacked cards) */}
                            <div className="bg-slate-900/60 p-5 rounded-xl border border-slate-700">
                                <div className="flex items-center justify-between">
                                    <div className="text-xs font-bold uppercase text-slate-400">Summary</div>
                                    {(addedPvPercent > 0 || addedBatteryKwh > 0) && (
                                        <div className={`text-[11px] px-2 py-0.5 rounded-full border ${
                                            financials.roiYears < 10
                                                ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
                                                : financials.roiYears < 15
                                                    ? 'border-yellow-500/30 text-yellow-300 bg-yellow-500/10'
                                                    : 'border-red-500/30 text-red-300 bg-red-500/10'
                                        }`}>
                                            ROI: {Number.isFinite(financials.roiYears) ? `${financials.roiYears.toFixed(1)}y` : '∞'}
                                        </div>
                                    )}
                                </div>

                                <div className="mt-3">
                                    <div className="flex justify-between mb-2">
                                        <span className="text-slate-400 text-sm font-medium">Autonomy</span>
                                        <div className="flex gap-2 items-baseline">
                                            {(addedPvPercent === 0 && addedBatteryKwh === 0) ? (
                                                <span className="text-white font-bold text-lg">{results.autonomyOriginal.toFixed(1)}%</span>
                                            ) : (
                                                <>
                                                    <span className="text-slate-500 line-through text-sm">{results.autonomyOriginal.toFixed(1)}%</span>
                                                    <span className="text-white font-bold text-lg">{results.autonomySimulated.toFixed(1)}%</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden relative">
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
                                                <div
                                                    className="h-full bg-gradient-to-r from-blue-600 to-purple-500 absolute top-0 left-0 transition-all duration-500 opacity-80"
                                                    style={{ width: `${results.autonomySimulated}%` }}
                                                />
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-4 grid grid-cols-2 gap-4">
                                    <div>
                                        <div className="text-xs text-slate-400 flex items-center gap-2">
                                            <Coins size={16} className="text-yellow-500" /> Invest
                                        </div>
                                        <div className="text-xl font-bold text-white mt-1">
                                            {financials.totalInvest.toLocaleString()} {config.currency}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-slate-400 flex items-center gap-2">
                                            <PiggyBank size={16} className="text-green-500" /> Yearly return
                                        </div>
                                        <div className="text-xl font-bold text-green-400 mt-1">
                                            +{financials.totalYearlyBenefit.toLocaleString(undefined, { maximumFractionDigits: 0 })} {config.currency}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-3 text-xs text-slate-400 flex items-center justify-between">
                                    <span>Net gain over {financials.horizonYears}y</span>
                                    <span className={`${financials.netGainHorizon >= 0 ? 'text-emerald-300' : 'text-red-300'} font-semibold`}>
                                        {financials.netGainHorizon >= 0 ? '+' : ''}{financials.netGainHorizon.toLocaleString(undefined, { maximumFractionDigits: 0 })} {config.currency}
                                    </span>
                                </div>
                            </div>

                            {/* Details: ROI breakdown + battery suggestion (collapsed to reduce UI noise) */}
                            {(batteryRecommendation || addedPvPercent > 0 || addedBatteryKwh > 0) && (
                                <details open className="bg-slate-900/40 p-4 rounded-xl border border-slate-700">
                                    <summary className="cursor-pointer select-none text-xs font-bold uppercase text-slate-400">
                                        Details
                                    </summary>
                                    <div className="mt-3 text-xs text-slate-300 space-y-3">
                                        {plannerWarnings.length > 0 && (
                                            <div className="space-y-2">
                                                {plannerWarnings.slice(0, 4).map((w, idx) => (
                                                    <div
                                                        key={idx}
                                                        className={`rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
                                                            w.type === 'warn'
                                                                ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-200'
                                                                : 'bg-slate-900/50 border-slate-700 text-slate-300'
                                                        }`}
                                                    >
                                                        {w.text}
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {(addedPvPercent > 0 || addedBatteryKwh > 0 || pvRecommendation?.recommended || batteryRecommendation?.recommended) && (
                                            <div className="text-[10px] text-slate-500 leading-relaxed">
                                                <strong>Next steps:</strong> sanity-check roof space + inverter/export limits, then request real quotes (€/kWp, €/kWh). If your goal is evening coverage, compare suggested battery size to your typical evening/night consumption.
                                            </div>
                                        )}

                                        {(addedPvPercent > 0 || addedBatteryKwh > 0) && (
                                            <div>
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
                                                    Battery ROI uses PV-only → PV+Battery (captures PV→Battery coupling).
                                                </div>
                                            </div>
                                        )}

                                        {batteryRecommendation && (
                                            <div>
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="text-xs font-bold uppercase text-slate-400">Battery Suggestion</div>
                                                    <div className="text-[10px] text-slate-500">Current PV slider + timeframe</div>
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
                                                            <span className="text-slate-400">Combined ROI (PV + Battery)</span>
                                                            <span className="text-emerald-400 font-semibold">{batteryRecommendation.recommended.combinedRoiYears.toFixed(1)}y</span>
                                                        </div>
                                                        <div className="flex items-center justify-between mt-1">
                                                            <span className="text-slate-400">Net gain ({financials.horizonYears}y)</span>
                                                            <span className={`${batteryRecommendation.recommended.netGainHorizon >= 0 ? 'text-emerald-300' : 'text-red-300'} font-semibold`}>
                                                                {batteryRecommendation.recommended.netGainHorizon >= 0 ? '+' : ''}{batteryRecommendation.recommended.netGainHorizon.toLocaleString(undefined, { maximumFractionDigits: 0 })} {config.currency}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center justify-between mt-1">
                                                            <span className="text-slate-400">Yearly benefit (battery)</span>
                                                            <span className="text-emerald-300 font-semibold">+{batteryRecommendation.recommended.yearlyBenefit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {config.currency}</span>
                                                        </div>

                                                        {batteryRecommendation.thresholds?.focus === 'autonomy' && (
                                                            <div className="flex items-center justify-between mt-1">
                                                                <span className="text-slate-400">Autonomy Δ (PV → PV+Battery)</span>
                                                                <span className="text-blue-300 font-semibold">+{batteryRecommendation.recommended.autonomyDeltaPct.toFixed(2)}%</span>
                                                            </div>
                                                        )}
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
                                                                <span>
                                                                    {batteryRecommendation.thresholds.focus === 'roi'
                                                                        ? ` (ROI focus: needs ≥ ${batteryRecommendation.thresholds.minYearlyBenefit} ${config.currency}/yr and payback ≤ ${batteryRecommendation.thresholds.maxRoiYears}y; also combined PV+Battery payback must be ≤ ${batteryRecommendation.thresholds.maxRoiYears}y.)`
                                                                        : ' (Autonomy focus: no battery size improves autonomy in this timeframe.)'}
                                                                </span>
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

                                        {pvRecommendation && (
                                            <div>
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="text-xs font-bold uppercase text-slate-400">PV Suggestion</div>
                                                    <div className="text-[10px] text-slate-500">PV-only (base → PV), same timeframe</div>
                                                </div>

                                                {pvRecommendation.recommended ? (
                                                    <div className="text-sm text-slate-200">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-slate-400">Recommended add-on</span>
                                                            <span className="text-white font-bold">+{pvRecommendation.recommended.addedPvPercent}%</span>
                                                        </div>
                                                        <div className="flex items-center justify-between mt-1">
                                                            <span className="text-slate-400">Added PV</span>
                                                            <span className="text-yellow-300 font-semibold">+{pvRecommendation.recommended.addedKwp.toFixed(1)} kWp</span>
                                                        </div>
                                                        <div className="flex items-center justify-between mt-1">
                                                            <span className="text-slate-400">PV ROI (PV-only)</span>
                                                            <span className="text-emerald-400 font-semibold">{pvRecommendation.recommended.roiYears.toFixed(1)}y</span>
                                                        </div>
                                                        <div className="flex items-center justify-between mt-1">
                                                            <span className="text-slate-400">Net gain ({financials.horizonYears}y)</span>
                                                            <span className={`${pvRecommendation.recommended.netGainHorizon >= 0 ? 'text-emerald-300' : 'text-red-300'} font-semibold`}>
                                                                {pvRecommendation.recommended.netGainHorizon >= 0 ? '+' : ''}{pvRecommendation.recommended.netGainHorizon.toLocaleString(undefined, { maximumFractionDigits: 0 })} {config.currency}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center justify-between mt-1">
                                                            <span className="text-slate-400">Yearly benefit (PV)</span>
                                                            <span className="text-emerald-300 font-semibold">+{pvRecommendation.recommended.yearlyBenefit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {config.currency}</span>
                                                        </div>

                                                        {pvRecommendation.thresholds?.focus === 'autonomy' && (
                                                            <div className="flex items-center justify-between mt-1">
                                                                <span className="text-slate-400">Autonomy Δ (base → PV)</span>
                                                                <span className="text-blue-300 font-semibold">+{pvRecommendation.recommended.autonomyDeltaPct.toFixed(2)}%</span>
                                                            </div>
                                                        )}

                                                        {pvRecommendation.bestYearly && pvRecommendation.bestYearly.addedPvPercent !== pvRecommendation.recommended.addedPvPercent && (
                                                            <div className="mt-2 text-[10px] text-slate-500">
                                                                Max yearly benefit at +{pvRecommendation.bestYearly.addedPvPercent}%.
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="text-xs text-slate-400">
                                                        <div>
                                                            No worthwhile PV recommendation for this timeframe.
                                                            {pvRecommendation.thresholds && (
                                                                <span>
                                                                    {pvRecommendation.thresholds.focus === 'roi'
                                                                        ? ` (ROI focus: needs ≥ ${pvRecommendation.thresholds.minYearlyBenefit} ${config.currency}/yr and payback ≤ ${pvRecommendation.thresholds.maxRoiYears}y.)`
                                                                        : ' (Autonomy focus: no PV size improves autonomy in this timeframe.)'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </details>
                            )}

                        </div>
                     </div>
                 </div>
             )}
        </div>
    );
};

export default ScenarioPlanner;