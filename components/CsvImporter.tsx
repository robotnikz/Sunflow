import React, { useState } from 'react';
import { Upload, FileText, Check, AlertCircle, Database, ArrowRight, Loader2, RotateCcw } from 'lucide-react';
import { previewCsv, importCsv, CsvPreview } from '../services/api';
import Papa from 'papaparse';

interface CsvImporterProps {
    onSuccess?: () => void;
}

const CsvImporter: React.FC<CsvImporterProps> = ({ onSuccess }) => {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<CsvPreview | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{success: boolean, imported: number, failed: number} | null>(null);
    const [isPivoted, setIsPivoted] = useState(false);
    const [availableEntities, setAvailableEntities] = useState<string[]>([]);
    const [pivotedPreview, setPivotedPreview] = useState<any[]>([]);
    const [previewMode, setPreviewMode] = useState<'daily' | 'monthly'>('daily');
    const [pivotTotals, setPivotTotals] = useState<Record<string, number> | null>(null);

    // Mapping State
    const [mapping, setMapping] = useState({
        timestamp: '',
        power_pv: '',
        power_load: '',
        power_grid: '',
        power_battery: '',
        soc: '',
        // Pivoted keys (Home Assistant)
        pivoted_pv: '',
        pivoted_load: '',
        pivoted_grid_in: '',
        pivoted_grid_out: '',
        pivoted_bat_charge: '',
        pivoted_bat_discharge: ''
    });

    // Generate preview when pivot mapping changes
    React.useEffect(() => {
        if (!isPivoted || !file) return;

        // If at least one field is mapped, try to generate a preview
        if(Object.values(mapping).some(v => v !== '')) {
             generatePivotPreview();
        }
    }, [mapping, isPivoted, file]);

    const generatePivotPreview = () => {
        if (!file) return;
        Papa.parse(file, {
            header: false,
            complete: (results) => {
                const rows = results.data as string[][];
                if (rows.length < 2) return;

                const headerRow = rows[0];
                const allDates = headerRow.slice(3);

                const entityRows: Record<string, string[]> = {};
                rows.forEach(r => {
                    const key = r[0] ? r[0] : (r[1] || '');
                    if (key) entityRows[key] = r;
                });

                const getVal = (fieldKey: string, colIdx: number): number => {
                    const entityId = mapping[fieldKey as keyof typeof mapping];
                    if (!entityId || !entityRows[entityId]) return 0;
                    const valStr = entityRows[entityId][3 + colIdx];
                    const cleanVal = valStr ? valStr.replace(',', '.') : '0';
                    return parseFloat(cleanVal) || 0;
                };

                let newPreview: any[] = [];
                const totals = {
                    solarProduction: 0,
                    homeConsumption: 0,
                    gridImport: 0,
                    gridExport: 0,
                    batteryCharge: 0,
                    batteryDischarge: 0,
                };

                if (allDates.length > 60) {
                    // Monthly Summary
                    setPreviewMode('monthly');
                    const monthlyData: Record<string, {
                        solarProduction: number;
                        homeConsumption: number;
                        gridImport: number;
                        gridExport: number;
                        batteryCharge: number;
                        batteryDischarge: number;
                        days: number;
                    }> = {};

                    allDates.forEach((dateStr, dateIdx) => {
                        const date = new Date(dateStr);
                        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

                        if (!monthlyData[monthKey]) {
                            monthlyData[monthKey] = { solarProduction: 0, homeConsumption: 0, gridImport: 0, gridExport: 0, batteryCharge: 0, batteryDischarge: 0, days: 0 };
                        }
                        
                        const solar = getVal('pivoted_pv', dateIdx);
                        const load = getVal('pivoted_load', dateIdx);
                        const gridIn = getVal('pivoted_grid_in', dateIdx);
                        const gridOut = getVal('pivoted_grid_out', dateIdx);
                        const batIn = getVal('pivoted_bat_charge', dateIdx);
                        const batOut = getVal('pivoted_bat_discharge', dateIdx);

                        monthlyData[monthKey].solarProduction += solar;
                        monthlyData[monthKey].homeConsumption += load;
                        monthlyData[monthKey].gridImport += gridIn;
                        monthlyData[monthKey].gridExport += gridOut;
                        monthlyData[monthKey].batteryCharge += batIn;
                        monthlyData[monthKey].batteryDischarge += batOut;
                        monthlyData[monthKey].days++;
                        
                        totals.solarProduction += solar;
                        totals.homeConsumption += load;
                        totals.gridImport += gridIn;
                        totals.gridExport += gridOut;
                        totals.batteryCharge += batIn;
                        totals.batteryDischarge += batOut;
                    });

                    newPreview = Object.keys(monthlyData).map(monthKey => {
                        const data = monthlyData[monthKey];
                        const totalHours = data.days * 24;
                        const netGridWatts = totalHours > 0 ? ((data.gridImport - data.gridExport) * 1000) / totalHours : 0;
                        const netBatteryWatts = totalHours > 0 ? ((data.batteryDischarge - data.batteryCharge) * 1000) / totalHours : 0;

                        return {
                            date: monthKey,
                            solarProduction: {
                                sourceKwh: data.solarProduction,
                                avgWatts: totalHours > 0 ? (data.solarProduction * 1000) / totalHours : 0,
                            },
                            homeConsumption: {
                                sourceKwh: data.homeConsumption,
                                avgWatts: totalHours > 0 ? (data.homeConsumption * 1000) / totalHours : 0,
                            },
                            gridImport: {
                                sourceKwh: data.gridImport,
                                avgWatts: totalHours > 0 ? (data.gridImport * 1000) / totalHours : 0,
                            },
                            gridExport: {
                                sourceKwh: data.gridExport,
                                avgWatts: totalHours > 0 ? (data.gridExport * 1000) / totalHours : 0,
                            },
                            batteryCharge: {
                                sourceKwh: data.batteryCharge,
                                avgWatts: totalHours > 0 ? (data.batteryCharge * 1000) / totalHours : 0,
                            },
                            batteryDischarge: {
                                sourceKwh: data.batteryDischarge,
                                avgWatts: totalHours > 0 ? (data.batteryDischarge * 1000) / totalHours : 0,
                            },
                            netGridWatts,
                            netBatteryWatts,
                        };
                    });

                } else {
                    // Daily Preview
                    setPreviewMode('daily');
                    newPreview = allDates.map((dateStr, dateIdx) => {
                        const solar = getVal('pivoted_pv', dateIdx);
                        const load = getVal('pivoted_load', dateIdx);
                        const gridIn = getVal('pivoted_grid_in', dateIdx);
                        const gridOut = getVal('pivoted_grid_out', dateIdx);
                        const batIn = getVal('pivoted_bat_charge', dateIdx);
                        const batOut = getVal('pivoted_bat_discharge', dateIdx);
                        
                        totals.solarProduction += solar;
                        totals.homeConsumption += load;
                        totals.gridImport += gridIn;
                        totals.gridExport += gridOut;
                        totals.batteryCharge += batIn;
                        totals.batteryDischarge += batOut;

                        // Calculate actual hours for this period to show correct avg Watts
                        const currentHeaderDate = new Date(dateStr);
                        let startDate;
                        if (dateIdx === 0) {
                            if (allDates.length > 1) {
                                const nextDate = new Date(allDates[1]);
                                startDate = new Date(currentHeaderDate.getTime() - (nextDate.getTime() - currentHeaderDate.getTime()));
                            } else startDate = new Date(currentHeaderDate.getTime() - (24 * 60 * 60 * 1000));
                        } else startDate = new Date(allDates[dateIdx-1]);
                        
                        const diffHours = Math.max(1, (currentHeaderDate.getTime() - startDate.getTime()) / (1000 * 60 * 60));

                        const netGridWatts = ((gridIn - gridOut) * 1000) / diffHours;
                        const netBatteryWatts = ((batOut - batIn) * 1000) / diffHours;

                        return {
                            date: dateStr.split('T')[0],
                            solarProduction: { sourceKwh: solar, avgWatts: (solar * 1000) / diffHours },
                            homeConsumption: { sourceKwh: load, avgWatts: (load * 1000) / diffHours },
                            gridImport: { sourceKwh: gridIn, avgWatts: (gridIn * 1000) / diffHours },
                            gridExport: { sourceKwh: gridOut, avgWatts: (gridOut * 1000) / diffHours },
                            batteryCharge: { sourceKwh: batIn, avgWatts: (batIn * 1000) / diffHours },
                            batteryDischarge: { sourceKwh: batOut, avgWatts: (batOut * 1000) / diffHours },
                            netGridWatts,
                            netBatteryWatts,
                        };
                    });
                }

                setPivotedPreview(newPreview);
                setPivotTotals(totals);
            }
        });
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const f = e.target.files[0];
            setFile(f);
            setLoading(true);
            setError(null);
            setIsPivoted(false);
            
            // Try Reset mapping
            setMapping({ 
                timestamp:'', power_pv:'', power_load:'', power_grid:'', power_battery:'', soc:'',
                pivoted_pv: '', pivoted_load: '', pivoted_grid_in: '', pivoted_grid_out: '', pivoted_bat_charge: '', pivoted_bat_discharge: ''
            });

            try {
                // Pre-check for HA format (client-side first lines check)
                const text = await f.slice(0, 1024).text();
                const firstLine = text.split('\n')[0];
                const isDailyHa = firstLine.startsWith('entity_id,type,unit,');
                
                if (isDailyHa) {
                    setIsPivoted(true);
                    setStep(2);
                    // Mock preview for pivot mode
                    const dates = firstLine.split(',').slice(3).map(d => d.trim());
                    setPreview({
                        headers: dates, 
                        preview: [] 
                    });
                    
                    // Parse all available entities
                    Papa.parse(f, {
                        header: true,
                        skipEmptyLines: true,
                        complete: (results) => {
                           const found = new Set<string>();
                           results.data.forEach((d: any) => {
                               // Use entity_id or fallback to type if missing (for calculated rows)
                               const id = d['entity_id'] ? d['entity_id'] : (d['type'] || '');
                               if(id) found.add(id);
                           });
                           setAvailableEntities(Array.from(found).sort());
                        }
                    });
                    
                    return; 
                }

                // Normal Flow
                const prev = await previewCsv(f);
                setPreview(prev);
                setStep(2);
                
                // Auto-Guess Mapping
                const headers = prev.headers.map(h => h.toLowerCase());
                const newMap = { ...mapping };
                
                prev.headers.forEach(h => {
                    const l = h.toLowerCase();
                    if (l.includes('time') || l.includes('date') || l.includes('ts')) newMap.timestamp = h;
                    else if (l.includes('pv') || l.includes('solar') || l.includes('yield')) newMap.power_pv = h;
                    else if (l.includes('load') || l.includes('cons') || l.includes('use')) newMap.power_load = h;
                    else if (l.includes('grid')) newMap.power_grid = h;
                    else if (l.includes('bat') && l.includes('p')) newMap.power_battery = h;
                    else if (l.includes('soc') || (l.includes('bat') && l.includes('%'))) newMap.soc = h;
                });
                setMapping(newMap);

            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        }
    };

    const handleImport = async () => {
        if (!file) return;
        setLoading(true);
        setError(null);

        try {
            if (isPivoted) {
                 await handlePivotedImport();
            } else {
                 const res = await importCsv(file, mapping);
                 setResult(res);
                 setStep(3);
                 if (onSuccess) onSuccess();
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePivotedImport = async () => {
        if (!file) return;
        
        return new Promise((resolve, reject) => {
            Papa.parse(file, {
                header: false, 
                skipEmptyLines: true,
                complete: async (results) => {
                    try {
                        const rows = results.data as string[][];
                        if (rows.length < 2) throw new Error("File is empty");
                        
                        const headerRow = rows[0];
                        const dates = headerRow.slice(3);
                        
                        const entityRows: Record<string, string[]> = {};
                        rows.forEach(r => {
                            const key = r[0] ? r[0] : (r[1] || '');
                            if(key) entityRows[key] = r;
                        });

                        const newCsvRows = [];
                        // Keep these headers to signal "aggregated energy" to server
                        newCsvRows.push(['timestamp', 'energy_pv_wh', 'energy_grid_in_wh', 'energy_grid_out_wh', 'energy_bat_charge_wh', 'energy_bat_discharge_wh', 'energy_load_wh']);

                        const getVal = (fieldKey: string, colIdx: number): number => {
                             const entityId = mapping[fieldKey as keyof typeof mapping];
                             if (!entityId || !entityRows[entityId]) return 0;
                             const valStr = entityRows[entityId][3 + colIdx]; 
                             const cleanVal = valStr ? valStr.replace(',', '.') : '0';
                             return parseFloat(cleanVal) || 0;
                        };

                        const isDaily = dates.length > 1 && 
                            Math.abs(new Date(dates[1]).getTime() - new Date(dates[0]).getTime()) > 3600000 * 20;

                        // Filter to Mon-Su if it's an 8-day weekly HA export (starts and ends on Monday midnight)
                        let datesToImport = dates;
                        if (dates.length === 8) {
                            const d0 = new Date(dates[0]);
                            const d7 = new Date(dates[7]);
                            // If first is Monday and last is also Monday (approx 7 days total)
                            if (d0.getDay() === 1 && d7.getDay() === 1) {
                                datesToImport = dates.slice(0, 7);
                            }
                        }

                        // HA columns like "2024-12-01T00:00:00" represent the month of December.
                        // We no longer subtract time, as the server handles strict boundaries.
                        datesToImport.forEach((dateStr, dateIdx) => {
                            const ts = new Date(dateStr);
                            const pad = (num: number) => String(num).padStart(2, '0');

                            if (isDaily) {
                                // Explode into 24 hours for better chart resolution
                                for (let h = 0; h < 24; h++) {
                                    const hTs = new Date(ts.getTime() + (h * 3600000));
                                    const tsStr = `${hTs.getFullYear()}-${pad(hTs.getMonth() + 1)}-${pad(hTs.getDate())} ${pad(hTs.getHours())}:00:00`;

                                    newCsvRows.push([
                                        tsStr, 
                                        ((getVal('pivoted_pv', dateIdx) * 1000) / 24).toFixed(0), 
                                        ((getVal('pivoted_grid_in', dateIdx) * 1000) / 24).toFixed(0), 
                                        ((getVal('pivoted_grid_out', dateIdx) * 1000) / 24).toFixed(0), 
                                        ((getVal('pivoted_bat_charge', dateIdx) * 1000) / 24).toFixed(0), 
                                        ((getVal('pivoted_bat_discharge', dateIdx) * 1000) / 24).toFixed(0), 
                                        ((getVal('pivoted_load', dateIdx) * 1000) / 24).toFixed(0)
                                    ]);
                                }
                            } else {
                                const tsStr = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}:00`;
                                newCsvRows.push([
                                    tsStr, 
                                    (getVal('pivoted_pv', dateIdx) * 1000).toFixed(0), 
                                    (getVal('pivoted_grid_in', dateIdx) * 1000).toFixed(0), 
                                    (getVal('pivoted_grid_out', dateIdx) * 1000).toFixed(0), 
                                    (getVal('pivoted_bat_charge', dateIdx) * 1000).toFixed(0), 
                                    (getVal('pivoted_bat_discharge', dateIdx) * 1000).toFixed(0), 
                                    (getVal('pivoted_load', dateIdx) * 1000).toFixed(0)
                                ]);
                            }
                        });

                        const csvContent = Papa.unparse(newCsvRows);
                        const blob = new Blob([csvContent], { type: 'text/csv' });
                        const newFile = new File([blob], "aggregated_import.csv", { type: 'text/csv' });

                        const transformMapping = {
                            timestamp: 'timestamp',
                            energy_pv: 'energy_pv_wh',
                            energy_grid_in: 'energy_grid_in_wh',
                            energy_grid_out: 'energy_grid_out_wh',
                            energy_bat_charge: 'energy_bat_charge_wh',
                            energy_bat_discharge: 'energy_bat_discharge_wh',
                            energy_load: 'energy_load_wh'
                        };

                        const res = await importCsv(newFile, transformMapping);
                        setResult(res);
                        setStep(3);
                        if (onSuccess) onSuccess();
                        resolve(res);

                    } catch (e: any) {
                        reject(e);
                    }
                }
            });
        });
    };

    return (
        <div className="bg-slate-900 rounded-xl border border-slate-700 p-6 h-full overflow-y-auto">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Database className="text-blue-400" />
                Data Import
            </h3>

            {/* STEP 1: UPLOAD */}
            {step === 1 && (
                <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-700 rounded-xl p-8 hover:border-blue-500/50 hover:bg-slate-800/50 transition-all cursor-pointer relative min-h-[200px]">
                    <input 
                        type="file" 
                        accept=".csv"
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        onChange={handleFileSelect}
                    />
                    <Upload size={48} className="text-slate-500 mb-4" />
                    <p className="text-slate-300 font-medium">Click to upload CSV</p>
                    <p className="text-slate-500 text-sm mt-2">Support for Home Assistant (Energy Panel), Fronius, InfluxDB</p>
                    {loading && <Loader2 className="animate-spin text-blue-400 mt-4" />}
                </div>
            )}

            {/* STEP 2: MAPPING */}
            {step === 2 && (
                <div className="space-y-6">
                    {isPivoted && (
                        <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-lg flex gap-3 text-emerald-200 text-sm">
                            <RotateCcw className="shrink-0" />
                            <div>
                                <strong>Home Assistant Format Detected</strong>
                                <p className="opacity-80 mt-1">Found column-based Daily Energy data. This will be automatically converted to <strong>hourly average power</strong> for the dashboard history.</p>
                            </div>
                        </div>
                    )}
                    
                    <div className="flex items-center gap-2 text-slate-400 text-sm">
                        <FileText size={16} />
                        File: <span className="text-white">{file?.name}</span>
                    </div>

                     {/* MAPPING UI - Adapts to Pivoted Mode */}
                     
                    {!isPivoted && preview && (
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {[
                                { key: 'timestamp', label: 'Timestamp (Required)', required: true },
                                { key: 'power_pv', label: 'PV Power (Watts)', required: false },
                                { key: 'power_load', label: 'Consumption (Watts)', required: false },
                                { key: 'power_grid', label: 'Grid Power (Watts, +Imp/-Exp)', required: false },
                                { key: 'power_battery', label: 'Battery Power (Watts)', required: false },
                                { key: 'soc', label: 'Battery State of Charge (%)', required: false },
                            ].map((field) => (
                                <div key={field.key} className="bg-slate-800 p-3 rounded-lg border border-slate-700">
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">{field.label}</label>
                                    <select 
                                        className="w-full bg-slate-900 border border-slate-600 text-white rounded p-2 text-sm focus:border-blue-500 outline-none"
                                        value={mapping[field.key as keyof typeof mapping]}
                                        onChange={(e) => setMapping({...mapping, [field.key]: e.target.value})}
                                    >
                                        <option value="">-- Ignore --</option>
                                        {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                                    </select>
                                </div>
                            ))}
                        </div>
                    )}

                   {isPivoted && (
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {[
                                { key: 'pivoted_pv', label: 'Solar Production', desc: 'Total PV Energy (kWh) - e.g. sensor.solar_yield' },
                                { key: 'pivoted_load', label: 'Home Consumption', desc: 'Total House Load (kWh) - e.g. calculated_consumption' },
                                { key: 'pivoted_grid_in', label: 'Grid Import', desc: 'Energy form Grid (kWh) - e.g. sensor.grid_consumption' },
                                { key: 'pivoted_grid_out', label: 'Grid Export', desc: 'Energy to Grid (kWh) - e.g. sensor.grid_return' },
                                { key: 'pivoted_bat_charge', label: 'Battery Charge', desc: 'Energy into Battery (kWh) - e.g. sensor.battery_in' },
                                { key: 'pivoted_bat_discharge', label: 'Battery Discharge', desc: 'Energy from Battery (kWh) - e.g. sensor.battery_out' },
                            ].map((field) => (
                                <div key={field.key} className="bg-slate-800 p-3 rounded-lg border border-slate-700">
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">{field.label}</label>
                                    <p className="text-[10px] text-slate-500 mb-2">{field.desc}</p>
                                    <select 
                                        className="w-full bg-slate-900 border border-slate-600 text-white rounded p-2 text-sm focus:border-blue-500 outline-none"
                                        value={mapping[field.key as keyof typeof mapping]}
                                        onChange={(e) => setMapping({...mapping, [field.key]: e.target.value})}
                                    >
                                        <option value="">-- Select Entity --</option>
                                        {availableEntities.map(e => <option key={e} value={e}>{e}</option>)}
                                    </select>
                                </div>
                            ))}
                        </div>
                    )}

                    {isPivoted && pivotedPreview.length > 0 && (
                        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
                             <h4 className="text-sm font-bold text-slate-300 mb-2 uppercase">
                                {previewMode === 'daily' ? 'Daily Preview' : 'Monthly Summary'}
                             </h4>

                             {pivotTotals && (
                                <div className="p-4 border rounded-lg bg-slate-800/50 border-slate-700">
                                    <h4 className="font-semibold text-slate-300 mb-2">Total kWh Summary</h4>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 text-sm">
                                      {Object.entries(pivotTotals).map(([key, value]) => (
                                        <div key={key} className="p-2 bg-slate-700/50 rounded">
                                          <div className="font-medium text-slate-400 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                                          <div className="font-bold text-lg text-slate-200">{value.toFixed(2)} <span className="text-xs font-normal">kWh</span></div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                             )}

                             <div className="overflow-x-auto max-h-64">
                                 <table className="w-full text-xs text-left">
                                     <thead>
                                         <tr className="text-slate-500 border-b border-slate-700">
                                             <th className="py-2 px-2 sticky left-0 bg-slate-800">{previewMode === 'daily' ? 'Date' : 'Month'}</th>
                                             <th className="py-2 px-2">Solar</th>
                                             <th className="py-2 px-2">Home Consumption</th>
                                             <th className="py-2 px-2">Grid Import</th>
                                             <th className="py-2 px-2">Grid Export</th>
                                             <th className="py-2 px-2">Net Grid</th>
                                             <th className="py-2 px-2">Battery Charge</th>
                                             <th className="py-2 px-2">Battery Discharge</th>
                                             <th className="py-2 px-2">Net Battery</th>
                                         </tr>
                                     </thead>
                                     <tbody>
                                         {pivotedPreview.map((row, i) => (
                                             <tr key={i} className="border-b border-slate-700/50 text-slate-300">
                                                 <td className="py-2 px-2 sticky left-0 bg-slate-800 font-medium text-slate-400">{row.date}</td>
                                                 <td className="py-2 px-2">
                                                     <div className="text-yellow-400">{row.solarProduction.sourceKwh.toFixed(2)} kWh</div>
                                                     <div className="text-[10px] text-slate-500">~{row.solarProduction.avgWatts.toFixed(0)} W avg</div>
                                                 </td>
                                                 <td className="py-2 px-2">
                                                     <div className="text-blue-400">{row.homeConsumption.sourceKwh.toFixed(2)} kWh</div>
                                                     <div className="text-[10px] text-slate-500">~{row.homeConsumption.avgWatts.toFixed(0)} W avg</div>
                                                 </td>
                                                 <td className="py-2 px-2">
                                                     <div className="text-red-400">{row.gridImport.sourceKwh.toFixed(2)} kWh</div>
                                                     <div className="text-[10px] text-slate-500">~{row.gridImport.avgWatts.toFixed(0)} W avg</div>
                                                 </td>
                                                 <td className="py-2 px-2">
                                                     <div className="text-emerald-400">{row.gridExport.sourceKwh.toFixed(2)} kWh</div>
                                                     <div className="text-[10px] text-slate-500">~{row.gridExport.avgWatts.toFixed(0)} W avg</div>
                                                 </td>
                                                  <td className="py-2 px-2">
                                                     <div className={`font-bold ${row.netGridWatts >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>{row.netGridWatts.toFixed(0)} W</div>
                                                 </td>
                                                 <td className="py-2 px-2">
                                                     <div className="text-emerald-400">{row.batteryCharge.sourceKwh.toFixed(2)} kWh</div>
                                                     <div className="text-[10px] text-slate-500">~{row.batteryCharge.avgWatts.toFixed(0)} W avg</div>
                                                 </td>
                                                 <td className="py-2 px-2">
                                                     <div className="text-yellow-400">{row.batteryDischarge.sourceKwh.toFixed(2)} kWh</div>
                                                     <div className="text-[10px] text-slate-500">~{row.batteryDischarge.avgWatts.toFixed(0)} W avg</div>
                                                 </td>
                                                 <td className="py-2 px-2">
                                                     <div className={`font-bold ${row.netBatteryWatts >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{row.netBatteryWatts.toFixed(0)} W</div>
                                                 </td>
                                             </tr>
                                         ))}
                                     </tbody>
                                 </table>
                             </div>
                        </div>
                    )}

                    <div className="flex justify-between items-center bg-blue-500/10 p-4 rounded-lg border border-blue-500/20">
                        <div className="flex items-center gap-3">
                            <InfoBox />
                            <div className="text-sm text-blue-300">
                                {isPivoted ? 'Data will be expanded to 24 data points per day.' : 'Rows with duplicate timestamps will be skipped.'}
                            </div>
                        </div>
                        <button 
                            onClick={handleImport}
                            disabled={loading || (!isPivoted && !mapping.timestamp)} 
                            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading && <Loader2 className="animate-spin" size={16} />}
                            {loading ? 'Processing...' : 'Start Import'}
                            <ArrowRight size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* STEP 3: SUCCESS */}
            {step === 3 && result && (
                <div className="text-center py-8">
                    <div className="inline-flex p-4 bg-emerald-500/10 rounded-full text-emerald-400 mb-4">
                        <Check size={48} />
                    </div>
                    <h4 className="text-2xl font-bold text-white mb-2">Import Complete</h4>
                    <p className="text-slate-400 mb-6">
                        Successfully imported <span className="text-white font-bold">{result.imported}</span> data points.
                        <br />
                        <span className="text-red-400">{result.failed}</span> rows failed or were duplicates.
                    </p>
                    <button 
                        onClick={() => { 
                            setStep(1); 
                            setFile(null); 
                            setResult(null); 
                            setIsPivoted(false); 
                            setMapping({
                                timestamp:'', power_pv:'', power_load:'', power_grid:'', power_battery:'', soc:'',
                                pivoted_pv: '', pivoted_load: '', pivoted_grid_in: '', pivoted_grid_out: '', pivoted_bat_charge: '', pivoted_bat_discharge: ''
                            }); 
                        }}
                        className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-2 rounded-lg"
                    >
                        Import Another File
                    </button>
                </div>
            )}

            {error && (
                <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 flex items-center gap-2 text-sm">
                    <AlertCircle size={16} />
                    {error}
                </div>
            )}
        </div>
    );
};

const InfoBox = () => <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold shrink-0">i</div>;

export default CsvImporter;