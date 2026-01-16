
import React, { useState, useEffect } from 'react';
import { SystemConfig, Tariff, Expense, Appliance } from '../types';
import { X, Save, Plus, Trash2, Calendar, DollarSign, Euro, PoundSterling, MapPin, Zap, History, HelpCircle, Calculator, CheckCircle2, AlertTriangle, ArrowRight, TrendingUp, SunMedium, Battery, Edit, Link2, Send, Sliders, Plug, Activity, Scale, Check, Bell, Upload } from 'lucide-react';
import { getTariffs, addTariff, deleteTariff, getExpenses, addExpense, deleteExpense, getConfig } from '../services/api';
import { ICON_MAP } from './SmartRecommendations';
import CsvImporter from './CsvImporter';

interface SettingsModalProps {
  currentConfig: SystemConfig;
  onSave: (config: SystemConfig) => void;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ currentConfig, onSave, onClose }) => {
  // Initialize state robustly immediately to prevent crashes on first render
  const [formData, setFormData] = useState<SystemConfig>(() => {
      // Define defaults
      const defaultTriggers = {
          errors: true,
          batteryFull: true,
          batteryEmpty: true,
          batteryHealth: false,
          smartAdvice: true
      };
      
      const config = { ...currentConfig };
      
      // Ensure notifications object exists
      if (!config.notifications) {
          config.notifications = {
              enabled: false,
              discordWebhook: '',
              triggers: defaultTriggers,
              smartAdviceCooldownMinutes: 120,
              sohThreshold: 75,
              minCyclesForSoh: 50
          };
      } else {
          // Ensure triggers exist and merge with defaults
          config.notifications.triggers = {
              ...defaultTriggers,
              ...(config.notifications.triggers || {})
          };
      }

      // Ensure other critical objects exist
      if (!config.appliances) config.appliances = [];
      if (!config.initialValues) {
          config.initialValues = { production: 0, import: 0, export: 0, financialReturn: 0 };
      }

      if (!config.smartUsage) {
          config.smartUsage = { reserveSocPct: 100 };
      } else if (config.smartUsage.reserveSocPct === undefined) {
          config.smartUsage.reserveSocPct = 100;
      }

      return config;
  });

  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  
  // Sync prop changes to state safely if config updates from parent
  useEffect(() => {
    setFormData(prev => {
        const baseNotifs = currentConfig.notifications || {
            enabled: false,
            discordWebhook: '',
            triggers: { errors: true, batteryFull: true, batteryEmpty: true, batteryHealth: false, smartAdvice: true },
            smartAdviceCooldownMinutes: 120,
            sohThreshold: 75,
            minCyclesForSoh: 50
        };

        const defaultTriggers = {
            errors: true,
            batteryFull: true,
            batteryEmpty: true,
            batteryHealth: false,
            smartAdvice: true
        };

        const robustNotifs = {
            ...baseNotifs,
            triggers: {
                ...defaultTriggers,
                ...(baseNotifs.triggers || {})
            }
        };

        return {
            ...currentConfig,
            initialValues: currentConfig.initialValues || prev.initialValues || {
                production: 0,
                import: 0,
                export: 0,
                financialReturn: 0
            },
            appliances: currentConfig.appliances || prev.appliances || [],
            notifications: robustNotifs,
            smartUsage: {
                ...(prev.smartUsage || {}),
                ...(currentConfig.smartUsage || {}),
                reserveSocPct: (currentConfig.smartUsage?.reserveSocPct ?? prev.smartUsage?.reserveSocPct ?? 100)
            }
        };
    });
  }, [currentConfig]);

  // Set defaults for optional fields if missing (run once)
  useEffect(() => {
    setFormData(prev => ({
        ...prev,
        degradationRate: prev.degradationRate !== undefined ? prev.degradationRate : 0.5,
        inflationRate: prev.inflationRate !== undefined ? prev.inflationRate : 2.0,
                batteryCapacity: prev.batteryCapacity !== undefined ? prev.batteryCapacity : 10.0,
                smartUsage: {
                        ...(prev.smartUsage || {}),
                        reserveSocPct: (prev.smartUsage?.reserveSocPct ?? 100)
                }
    }));
  }, []);

  // New Tariff State
  const [newTariff, setNewTariff] = useState<Partial<Tariff>>({ 
    validFrom: new Date().toISOString().split('T')[0], 
    costPerKwh: 0, 
    feedInTariff: 0 
  });

  // EEG Calculator State
  const [showFeedInCalc, setShowFeedInCalc] = useState(false);
  const [calcTier1Limit, setCalcTier1Limit] = useState(10); // Standard EEG limit (10 kWp)
  const [calcPrice1, setCalcPrice1] = useState(0.082);
  const [calcPrice2, setCalcPrice2] = useState(0.071);
  const [calcTestKwh, setCalcTestKwh] = useState(5000); // For verification

  // Helper to verify calc
  const getCalculatedRate = () => {
      const capacity = formData.systemCapacity || 0;
      if (capacity <= 0) return 0;
      
      // If capacity is under the limit, just return price 1
      if (capacity <= calcTier1Limit) return calcPrice1;

      // Weighted Average Calculation
      // (Tier1_kW * Price1 + Tier2_kW * Price2) / Total_kW
      const tier1Val = calcTier1Limit * calcPrice1;
      const tier2Val = (capacity - calcTier1Limit) * calcPrice2;
      return (tier1Val + tier2Val) / capacity;
  };
  
  const calculatedRate = getCalculatedRate();

  const applyBlendedRate = () => {
      // Also update the date to system start date if available, as this tariff likely applies from day 1
      const startDate = formData.systemStartDate || new Date().toISOString().split('T')[0];
      
      setNewTariff({ 
          ...newTariff, 
          feedInTariff: parseFloat(calculatedRate.toFixed(5)),
          validFrom: startDate
      });
      setShowFeedInCalc(false);
  };

  // New Expense State
  const [newExpense, setNewExpense] = useState<Partial<Expense>>({
    name: '',
    amount: 0,
    type: 'one_time',
    date: new Date().toISOString().split('T')[0]
  });

  // Appliance Edit State
  const [editingAppliance, setEditingAppliance] = useState<Partial<Appliance>>({
      name: '', watts: 0, kwhEstimate: 0, iconName: 'zap', color: 'text-slate-400', durationMinutes: 60, inputMode: 'kwh_per_run'
  });
  const [isEditingAppliance, setIsEditingAppliance] = useState(false);


  const [activeTab, setActiveTab] = useState<'general' | 'notifications' | 'tariffs' | 'expenses' | 'appliances' | 'history' | 'import'>('general');

  useEffect(() => {
    loadData();
  }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

  const loadData = async () => {
    try {
      const [tData, eData] = await Promise.all([getTariffs(), getExpenses()]);
      setTariffs(tData);
      setExpenses(eData);
    } catch (e) {
      console.error("Failed to load settings data", e);
    }
  };

  const handleConfigSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Ensure numbers are numbers before saving
    const cleanedConfig = {
        ...formData,
        initialValues: {
            production: Number(formData.initialValues?.production || 0),
            import: Number(formData.initialValues?.import || 0),
            export: Number(formData.initialValues?.export || 0),
            financialReturn: Number(formData.initialValues?.financialReturn || 0),
        },
        smartUsage: {
            ...(formData.smartUsage || {}),
            reserveSocPct: Math.min(100, Math.max(0, Number(formData.smartUsage?.reserveSocPct ?? 100)))
        }
    };
    onSave(cleanedConfig);
  };

  const handleTestNotification = async () => {
      const draftWebhook = (formData.notifications?.discordWebhook || '').trim();
      const savedWebhook = (currentConfig?.notifications?.discordWebhook || '').trim();

      if (!draftWebhook && !savedWebhook) {
          return alert("Please enter and save a Discord Webhook URL first.");
      }

      // To prevent SSRF and keep backend strict, /api/test-notification only tests the persisted config.
      if (draftWebhook && draftWebhook !== savedWebhook) {
          return alert("Please save settings first, then test the notification.");
      }
      
      try {
          const res = await fetch('/api/test-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({})
          });
          if(res.ok) alert("Test notification sent! Check your Discord channel.");
          else throw new Error("Failed");
      } catch(e) {
          alert("Failed to send test notification. Check the URL and server logs.");
      }
  };

  // Helper to safely update notification settings
  const updateNotification = (updates: any) => {
      const current = formData.notifications || { 
          enabled: false, 
          discordWebhook: '', 
          triggers: { errors: false, batteryFull: false, batteryEmpty: false, batteryHealth: false, smartAdvice: false }, 
          smartAdviceCooldownMinutes: 120,
          sohThreshold: 75,
          minCyclesForSoh: 50
      };
      const triggers = current.triggers || { errors: false, batteryFull: false, batteryEmpty: false, batteryHealth: false, smartAdvice: false };
      
      setFormData({
          ...formData,
          notifications: {
              ...current,
              ...updates,
              triggers: {
                  ...triggers,
                  ...(updates.triggers || {})
              }
          }
      });
  };

  // Helper to get currency symbol
  const getCurrencySymbol = () => {
      switch(formData.currency) {
          case 'EUR': return '€';
          case 'GBP': return '£';
          default: return '$';
      }
  };

  const getCurrencyIcon = (size: number) => {
      switch(formData.currency) {
          case 'EUR': return <Euro size={size} />;
          case 'GBP': return <PoundSterling size={size} />;
          default: return <DollarSign size={size} />;
      }
  };

  // Auto-Calculate History Estimation
  const handleEstimateFinancials = () => {
    const vals = formData.initialValues;
    if (!vals) {
        alert("Please ensure the values below are entered correctly.");
        return;
    }

    // Attempt to find the tariff valid at System Start Date
    const systemStart = formData.systemStartDate || new Date().toISOString().split('T')[0];
    let tariffToUse = tariffs.length > 0 ? tariffs[tariffs.length - 1] : { validFrom: 'Default', costPerKwh: 0.30, feedInTariff: 0.08 };
    
    // Sort tariffs by date ASC and pick the one valid at start date
    const sortedTariffs = [...tariffs].sort((a,b) => a.validFrom.localeCompare(b.validFrom));
    for (const t of sortedTariffs) {
        if (t.validFrom <= systemStart) {
            tariffToUse = t;
        }
    }
    
    // Parse values in case they are strings in local state
    const totalProd = Number(vals.production || 0);
    const totalExport = Number(vals.export || 0);
    
    if (totalProd === 0 && totalExport === 0) {
        alert("Please enter at least Production and Export values from your inverter history.");
        return;
    }

    // Self Consumption = Production - Export
    const selfConsumed = Math.max(0, totalProd - totalExport);
    
    const saved = selfConsumed * tariffToUse.costPerKwh;
    const earned = totalExport * tariffToUse.feedInTariff;
    
    const total = saved + earned;
    const sym = getCurrencySymbol();

    if (confirm(`Estimate Calculation (Legacy Data):\n\nUsing price valid from: ${tariffToUse.validFrom}\nFeed-in Rate: ${sym}${tariffToUse.feedInTariff}\n\nSelf-Consumed (${selfConsumed.toFixed(0)} kWh) × ${tariffToUse.costPerKwh} = ${sym}${saved.toFixed(2)}\nExported (${totalExport.toFixed(0)} kWh) × ${tariffToUse.feedInTariff} = ${sym}${earned.toFixed(2)}\n\nTotal Legacy Return: ${sym}${total.toFixed(2)}\n\nUpdate this value?`)) {
        setFormData({
            ...formData,
            initialValues: { ...vals, financialReturn: parseFloat(total.toFixed(2)) }
        });
    }
  };


  const handleAddTariff = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Safety check for 0 import cost
    if (newTariff.costPerKwh === 0) {
        if (!confirm("⚠️ Warning: Your Grid Cost is set to 0.\n\nThis means the system will calculate your savings from self-consumption as 0.\n\nThe 'Mixed Rate' calculator only calculates what you earn (Feed-in), not what you pay.\n\nAre you sure you want to proceed with 0 cost?")) {
            return;
        }
    }

    if (newTariff.validFrom && newTariff.costPerKwh !== undefined && newTariff.feedInTariff !== undefined) {
      await addTariff(newTariff as Tariff);
      loadData();
      setNewTariff({ validFrom: new Date().toISOString().split('T')[0], costPerKwh: 0, feedInTariff: 0 });
    }
  };

  const handleDeleteTariff = async (id: number) => {
    if (confirm("Are you sure you want to delete this price entry?")) {
      try {
        await deleteTariff(id);
        loadData();
      } catch (e: any) {
        alert("Could not delete tariff. You must have at least one tariff entry remaining.");
      }
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newExpense.name && newExpense.amount && newExpense.date && newExpense.type) {
      await addExpense(newExpense as Expense);
      loadData();
      setNewExpense({ name: '', amount: 0, type: 'one_time', date: new Date().toISOString().split('T')[0] });
    }
  };

  const handleDeleteExpense = async (id: number) => {
    if (confirm("Remove this expense?")) { await deleteExpense(id); loadData(); }
  };

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  const handleSaveAppliance = () => {
      const mode = (editingAppliance.inputMode || 'kwh_per_run') as Appliance['inputMode'];
      const watts = Number(editingAppliance.watts || 0);
      const durationMinutes = editingAppliance.durationMinutes === undefined ? undefined : Number(editingAppliance.durationMinutes);
      const kwhEstimate = Number(editingAppliance.kwhEstimate || 0);

      if (!editingAppliance.name) return;
      if (mode === 'power_duration') {
          if (!(watts > 0) || !(Number(durationMinutes) > 0)) return;
      } else {
          if (!(kwhEstimate > 0)) return;
      }

      const newApp: Appliance = {
          id: editingAppliance.id || Math.random().toString(36).substr(2, 9),
          name: editingAppliance.name,
          watts: Number.isFinite(watts) ? watts : 0,
          durationMinutes: (mode === 'power_duration' && Number.isFinite(Number(durationMinutes)) && Number(durationMinutes) > 0)
            ? Math.round(Number(durationMinutes))
            : undefined,
          kwhEstimate: Number.isFinite(kwhEstimate) ? kwhEstimate : 0,
          inputMode: mode,
          iconName: editingAppliance.iconName || 'zap',
          color: editingAppliance.color || 'text-slate-400'
      };
      let newAppliances = [...(formData.appliances || [])];
      if (editingAppliance.id) newAppliances = newAppliances.map(a => a.id === newApp.id ? newApp : a);
      else newAppliances.push(newApp);
      setFormData({ ...formData, appliances: newAppliances });
      setIsEditingAppliance(false);
      setEditingAppliance({ name: '', watts: 0, kwhEstimate: 0, iconName: 'zap', color: 'text-slate-400', durationMinutes: 60, inputMode: 'kwh_per_run' });
  };

  const handleDeleteAppliance = (id: string) => {
      if(confirm("Delete this device?")) {
          const newAppliances = formData.appliances?.filter(a => a.id !== id) || [];
          setFormData({ ...formData, appliances: newAppliances });
      }
  };

  const handlePowerTimeChange = (newWatts: number, newMinutes: number) => {
      const hours = newMinutes / 60;
      const kwh = (newWatts * hours) / 1000;
      setEditingAppliance(prev => ({ ...prev, watts: newWatts, durationMinutes: newMinutes, kwhEstimate: parseFloat(kwh.toFixed(2)), inputMode: 'power_duration' }));
  };

  const hasExpenses = expenses.length > 0;
  const hasTariffs = tariffs.length > 0;
  const hasStartDate = !!formData.systemStartDate;

  return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="sunflow-settings-title"
                className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
        
        {/* Header */}
        <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-900/50">
                    <h2 id="sunflow-settings-title" className="text-xl font-bold text-white">System Settings</h2>
                    <button aria-label="Close settings" onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700 bg-slate-900/30 overflow-x-auto">
          <button onClick={() => setActiveTab('general')} className={`flex-1 py-3 px-4 text-sm font-medium whitespace-nowrap transition-colors flex items-center justify-center gap-2 ${activeTab === 'general' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'text-slate-400 hover:text-slate-200'}`}>
            <Sliders size={16} /> General
          </button>
          <button onClick={() => setActiveTab('notifications')} className={`flex-1 py-3 px-4 text-sm font-medium whitespace-nowrap transition-colors flex items-center justify-center gap-2 ${activeTab === 'notifications' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'text-slate-400 hover:text-slate-200'}`}>
            <Bell size={16} /> Notifications
          </button>
          <button onClick={() => setActiveTab('appliances')} className={`flex-1 py-3 px-4 text-sm font-medium whitespace-nowrap transition-colors flex items-center justify-center gap-2 ${activeTab === 'appliances' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'text-slate-400 hover:text-slate-200'}`}>
            <Plug size={16} /> Appliances
          </button>
          <button onClick={() => setActiveTab('tariffs')} className={`flex-1 py-3 px-4 text-sm font-medium whitespace-nowrap transition-colors flex items-center justify-center gap-2 ${activeTab === 'tariffs' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'text-slate-400 hover:text-slate-200'}`}>
            {getCurrencyIcon(16)} Prices
          </button>
          <button onClick={() => setActiveTab('expenses')} className={`flex-1 py-3 px-4 text-sm font-medium whitespace-nowrap transition-colors flex items-center justify-center gap-2 ${activeTab === 'expenses' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'text-slate-400 hover:text-slate-200'}`}>
            <TrendingUp size={16} /> ROI
          </button>
          <button onClick={() => setActiveTab('history')} className={`flex-1 py-3 px-4 text-sm font-medium whitespace-nowrap transition-colors flex items-center justify-center gap-2 ${activeTab === 'history' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'text-slate-400 hover:text-slate-200'}`}>
            <History size={16} /> Calibration
          </button>
          <button onClick={() => setActiveTab('import')} className={`flex-1 py-3 px-4 text-sm font-medium whitespace-nowrap transition-colors flex items-center justify-center gap-2 ${activeTab === 'import' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'text-slate-400 hover:text-slate-200'}`}>
            <Upload size={16} /> Data Import
          </button>
        </div>
        
        {/* Content */}
        <div className="p-6 overflow-y-auto">
          
          {/* TAB: General */}
          {activeTab === 'general' && (
            <form onSubmit={handleConfigSubmit} className="space-y-6">
              <div className="space-y-4">
                  <h3 className="text-slate-300 font-bold border-b border-slate-700 pb-2">Connection & Date</h3>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Inverter IP Address</label>
                    <input type="text" value={formData.inverterIp} onChange={(e) => setFormData({...formData, inverterIp: e.target.value})} placeholder="e.g. 192.168.1.50" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">System Commissioning Date</label>
                    <input type="date" value={formData.systemStartDate} onChange={(e) => setFormData({...formData, systemStartDate: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500" required />
                    <p className="text-xs text-slate-500 mt-1">Used to calculate the timeline for recurring costs.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Currency Symbol</label>
                    <select value={formData.currency} onChange={(e) => setFormData({...formData, currency: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500">
                        <option value="EUR">EUR (€)</option>
                        <option value="USD">USD ($)</option>
                        <option value="GBP">GBP (£)</option>
                    </select>
                  </div>
              </div>
              <div className="space-y-4 pt-4">
                 <h3 className="text-slate-300 font-bold border-b border-slate-700 pb-2 flex items-center gap-2"><MapPin size={18}/> Location & Capacity</h3>
                 <div className="grid grid-cols-2 gap-4">
                     <div><label className="block text-sm font-medium text-slate-400 mb-2">Latitude</label><input type="text" value={formData.latitude || ''} onChange={(e) => setFormData({...formData, latitude: e.target.value})} placeholder="e.g. 52.52" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500" /></div>
                     <div><label className="block text-sm font-medium text-slate-400 mb-2">Longitude</label><input type="text" value={formData.longitude || ''} onChange={(e) => setFormData({...formData, longitude: e.target.value})} placeholder="e.g. 13.40" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500" /></div>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-medium text-slate-400 mb-2 flex items-center gap-2"><Zap size={14} className="text-yellow-500"/> Solar Capacity (kWp)</label><input type="number" step="0.1" value={formData.systemCapacity || ''} onChange={(e) => setFormData({...formData, systemCapacity: parseFloat(e.target.value)})} placeholder="e.g. 10.5" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" /></div>
                    <div><label className="block text-sm font-medium text-slate-400 mb-2 flex items-center gap-2"><Battery size={14} className="text-emerald-500"/> Battery Size (kWh)</label><input type="number" step="0.1" value={formData.batteryCapacity || ''} onChange={(e) => setFormData({...formData, batteryCapacity: parseFloat(e.target.value)})} placeholder="e.g. 7.7" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" /></div>
                 </div>
              </div>

              <div className="space-y-4 pt-4">
                 <h3 className="text-slate-300 font-bold border-b border-slate-700 pb-2 flex items-center gap-2"><Sliders size={18}/> Smart Usage</h3>
                 <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700/50">
                    <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium text-slate-400">Reserve until sunset</label>
                        <span className="text-sm font-bold text-slate-200">{Math.round(Number(formData.smartUsage?.reserveSocPct ?? 100))}%</span>
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Number(formData.smartUsage?.reserveSocPct ?? 100)}
                        onChange={(e) => setFormData({
                            ...formData,
                            smartUsage: {
                                ...(formData.smartUsage || {}),
                                reserveSocPct: Number(e.target.value)
                            }
                        })}
                        className="w-full accent-yellow-500"
                    />
                    <div className="mt-2 text-xs text-slate-500 space-y-1">
                        <p>
                            Smart Usage may use battery energy <strong>above</strong> this threshold during daytime.
                        </p>
                        <p>
                            Set to <strong>100%</strong> to keep current behavior (battery-first).
                        </p>
                    </div>
                 </div>
              </div>
              <div className="space-y-4 pt-4">
                 <h3 className="text-slate-300 font-bold border-b border-slate-700 pb-2 flex items-center gap-2"><SunMedium size={18}/> Solcast API (Forecasting)</h3>
                 <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700/50 mb-2">
                    <p className="text-xs text-slate-400">Required for Smart Recommendations. Create a free account at <a href="https://solcast.com" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">solcast.com</a> and create a "Rooftop Site".</p>
                 </div>
                 <div><label className="block text-sm font-medium text-slate-400 mb-2">API Key</label><input type="password" value={formData.solcastApiKey || ''} onChange={(e) => setFormData({...formData, solcastApiKey: e.target.value})} placeholder="e.g. XXXXXXXXXXXXXXXXXXXXXXXXXX" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500" /></div>
                 <div><label className="block text-sm font-medium text-slate-400 mb-2">Site Resource ID</label><input type="text" value={formData.solcastSiteId || ''} onChange={(e) => { let val = e.target.value; const urlMatch = val.match(/rooftop_sites\/([\w-]+)/); if (urlMatch && urlMatch[1]) { val = urlMatch[1]; } setFormData({...formData, solcastSiteId: val}) }} placeholder="e.g. 5a31-c8f1-8dcf-1cf1" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500" /><p className="text-[10px] text-slate-500 mt-1">The ID from your Solcast dashboard (e.g. 5a31...). You can also just paste the full "Resource Link" here, and we'll extract the ID automatically.</p></div>
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="submit" className="flex items-center gap-2 px-6 py-2 bg-yellow-500 text-slate-900 font-bold rounded-lg hover:bg-yellow-400 transition"><Save size={18} /> Save Settings</button>
              </div>
            </form>
          )}

          {/* ... Notifications ... */}
          {activeTab === 'notifications' && (
            <form onSubmit={handleConfigSubmit} className="space-y-6">
                 {/* (Standard Notifications Form) */}
                 <div className="flex items-center justify-between">
                    <h3 className="text-slate-300 font-bold flex items-center gap-2"><Link2 size={18} className="text-blue-400"/> Discord Integration</h3>
                    <div className="flex items-center gap-2">
                         <span className="text-sm text-slate-400">Enable</span>
                                                 <button
                                                     type="button"
                                                     role="switch"
                                                     aria-label="Enable notifications"
                                                     aria-checked={!!formData.notifications?.enabled}
                                                     onClick={() => updateNotification({ enabled: !formData.notifications?.enabled })}
                                                     className={`w-11 h-6 flex items-center rounded-full transition-colors ${formData.notifications?.enabled ? 'bg-green-500' : 'bg-slate-700'}`}
                                                 >
                             <div className={`w-4 h-4 rounded-full bg-white shadow-md transform transition-transform ${formData.notifications?.enabled ? 'translate-x-6' : 'translate-x-1'}`}></div>
                         </button>
                    </div>
                </div>
                 <div className={`space-y-6 transition-opacity ${formData.notifications?.enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                     <div><label className="block text-sm font-medium text-slate-400 mb-2">Webhook URL</label><div className="flex gap-2"><input type="text" value={formData.notifications?.discordWebhook || ''} onChange={(e) => updateNotification({ discordWebhook: e.target.value })} className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500 text-sm font-mono" /><button type="button" onClick={handleTestNotification} className="px-3 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg border border-slate-600 flex items-center gap-2 transition-colors"><Send size={16} /> <span className="text-xs font-bold hidden sm:inline">Test</span></button></div></div>
                     <div><h4 className="text-sm font-bold text-slate-300 mb-3 border-b border-slate-700 pb-1">Triggers</h4><div className="space-y-3"><div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/50 border border-slate-700/50"><div className="flex items-center gap-3"><AlertTriangle size={18} className="text-red-500" /><div><div className="text-sm font-medium text-slate-200">Inverter Errors</div></div></div><input type="checkbox" checked={formData.notifications?.triggers?.errors ?? false} onChange={(e) => updateNotification({ triggers: { errors: e.target.checked } })} className="w-5 h-5 accent-yellow-500 rounded bg-slate-700 border-slate-500" /></div><div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/50 border border-slate-700/50"><div className="flex items-center gap-3"><Battery size={18} className="text-green-500" /><div><div className="text-sm font-medium text-slate-200">Battery Full (100%)</div></div></div><input type="checkbox" checked={formData.notifications?.triggers?.batteryFull ?? false} onChange={(e) => updateNotification({ triggers: { batteryFull: e.target.checked } })} className="w-5 h-5 accent-yellow-500 rounded bg-slate-700 border-slate-500" /></div><div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/50 border border-slate-700/50"><div className="flex items-center gap-3"><Battery size={18} className="text-red-500" /><div><div className="text-sm font-medium text-slate-200">Battery Low (≤ 7%)</div></div></div><input type="checkbox" checked={formData.notifications?.triggers?.batteryEmpty ?? false} onChange={(e) => updateNotification({ triggers: { batteryEmpty: e.target.checked } })} className="w-5 h-5 accent-yellow-500 rounded bg-slate-700 border-slate-500" /></div>
                     
                     <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                                <Activity size={18} className="text-purple-500" />
                                <div><div className="text-sm font-medium text-slate-200">Battery Health (SOH) Low</div></div>
                            </div>
                            <input type="checkbox" checked={formData.notifications?.triggers?.batteryHealth ?? false} onChange={(e) => updateNotification({ triggers: { batteryHealth: e.target.checked } })} className="w-5 h-5 accent-yellow-500 rounded bg-slate-700 border-slate-500"/>
                        </div>
                        {formData.notifications?.triggers?.batteryHealth && (
                            <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-700/50 animate-fade-in">
                                <div>
                                    <label className="text-xs text-slate-500 block mb-1">Alert Threshold (%)</label>
                                    <input type="number" value={formData.notifications?.sohThreshold ?? 75} onChange={(e) => updateNotification({ sohThreshold: parseFloat(e.target.value) })} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white" />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 block mb-1">Min Cycles</label>
                                    <input type="number" value={formData.notifications?.minCyclesForSoh ?? 50} onChange={(e) => updateNotification({ minCyclesForSoh: parseFloat(e.target.value) })} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white" />
                                </div>
                            </div>
                        )}
                     </div>
                     
                     <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/50 border border-slate-700/50"><div className="flex items-center gap-3"><Zap size={18} className="text-blue-400 fill-blue-400" /><div><div className="text-sm font-medium text-slate-200">Smart Usage Suggestions</div></div></div><input type="checkbox" checked={formData.notifications?.triggers?.smartAdvice ?? false} onChange={(e) => updateNotification({ triggers: { smartAdvice: e.target.checked } })} className="w-5 h-5 accent-yellow-500 rounded bg-slate-700 border-slate-500" /></div></div></div>
                 </div>
                 <div className="pt-4 flex justify-end gap-3 border-t border-slate-700 mt-4"><button type="submit" className="flex items-center gap-2 px-6 py-2 bg-yellow-500 text-slate-900 font-bold rounded-lg hover:bg-yellow-400 transition shadow-lg shadow-yellow-500/20"><Save size={18} /> Save Notifications</button></div>
            </form>
          )}

           {/* ... Appliances ... */}
           {activeTab === 'appliances' && (
              <div className="space-y-6">
                {isEditingAppliance ? (
                      <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700 space-y-5">
                           <h3 className="text-slate-300 text-sm font-bold flex items-center gap-2">{editingAppliance.id ? <Edit size={16}/> : <Plus size={16}/>}{editingAppliance.id ? 'Edit Device' : 'Add New Device'}</h3>
                                                     <div>
                                                         <label className="text-xs text-slate-500 block mb-1 font-semibold uppercase tracking-wider">Device Name</label>
                                                         <input
                                                             type="text"
                                                             value={editingAppliance.name}
                                                             onChange={e => setEditingAppliance({ ...editingAppliance, name: e.target.value })}
                                                             className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white focus:border-yellow-500 focus:outline-none"
                                                         />
                                                     </div>

                                                     <div>
                                                         <label className="text-xs text-slate-500 block mb-2 font-semibold uppercase tracking-wider">Input Mode</label>
                                                         <div className="grid grid-cols-2 gap-2">
                                                             <button
                                                                 type="button"
                                                                 onClick={() => setEditingAppliance(prev => ({ ...prev, inputMode: 'kwh_per_run' }))}
                                                                 className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                                                                     (editingAppliance.inputMode || 'kwh_per_run') === 'kwh_per_run'
                                                                         ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-300'
                                                                         : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600'
                                                                 }`}
                                                             >
                                                                 kWh per run
                                                             </button>
                                                             <button
                                                                 type="button"
                                                                 onClick={() => setEditingAppliance(prev => ({ ...prev, inputMode: 'power_duration' }))}
                                                                 className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                                                                     (editingAppliance.inputMode || 'kwh_per_run') === 'power_duration'
                                                                         ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-300'
                                                                         : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600'
                                                                 }`}
                                                             >
                                                                 Watts + duration
                                                             </button>
                                                         </div>
                                                         <p className="text-[10px] text-slate-500 mt-2">
                                                             Tip: Many appliances have variable power draw (e.g. heating phases). In that case, entering <strong>kWh per run</strong> is usually more accurate.
                                                         </p>
                                                     </div>

                                                     {/* Power threshold (used by Smart Suggestions) */}
                                                     <div>
                                                         <label className="text-xs text-slate-500 block mb-1 font-semibold uppercase tracking-wider">Power (W) — for Smart Suggestions</label>
                                                         <input
                                                             type="number"
                                                             value={editingAppliance.watts ?? 0}
                                                             onChange={e => {
                                                                 const nextWatts = clamp(Number(e.target.value || 0), 0, 50000);
                                                                 if ((editingAppliance.inputMode || 'kwh_per_run') === 'power_duration') {
                                                                     handlePowerTimeChange(nextWatts, Number(editingAppliance.durationMinutes || 60));
                                                                 } else {
                                                                     setEditingAppliance(prev => ({ ...prev, watts: nextWatts }));
                                                                 }
                                                             }}
                                                             className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white focus:border-yellow-500 focus:outline-none"
                                                             placeholder="e.g. 2000"
                                                         />
                                                         <p className="text-[10px] text-slate-500 mt-1">
                                                             Set to <strong>0</strong> to disable Smart Suggestions for this device.
                                                         </p>
                                                     </div>

                                                     {(editingAppliance.inputMode || 'kwh_per_run') === 'kwh_per_run' ? (
                                                         <div>
                                                             <label className="text-xs text-slate-500 block mb-1 font-semibold uppercase tracking-wider">kWh per run</label>
                                                             <input
                                                                 type="number"
                                                                 step="0.01"
                                                                 value={editingAppliance.kwhEstimate ?? 0}
                                                                 onChange={e => setEditingAppliance(prev => ({ ...prev, kwhEstimate: clamp(Number(e.target.value || 0), 0, 200) }))}
                                                                 className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white focus:border-yellow-500 focus:outline-none"
                                                                 placeholder="e.g. 1.2"
                                                             />
                                                             <p className="text-[10px] text-slate-500 mt-1">
                                                                 Used for energy/ROI estimates.
                                                             </p>
                                                         </div>
                                                     ) : (
                                                         <div className="grid grid-cols-2 gap-3">
                                                             <div>
                                                                 <label className="text-xs text-slate-500 block mb-1 font-semibold uppercase tracking-wider">Duration (min)</label>
                                                                 <input
                                                                     type="number"
                                                                     value={editingAppliance.durationMinutes ?? 60}
                                                                     onChange={e => handlePowerTimeChange(Number(editingAppliance.watts || 0), clamp(Number(e.target.value || 0), 1, 24 * 60))}
                                                                     className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white focus:border-yellow-500 focus:outline-none"
                                                                 />
                                                             </div>
                                                             <div>
                                                                 <label className="text-xs text-slate-500 block mb-1 font-semibold uppercase tracking-wider">kWh per run (computed)</label>
                                                                 <input
                                                                     type="number"
                                                                     value={editingAppliance.kwhEstimate ?? 0}
                                                                     disabled
                                                                     className="w-full bg-slate-800/60 border border-slate-700 rounded px-3 py-2 text-slate-300"
                                                                 />
                                                             </div>
                                                         </div>
                                                     )}

                           <div className="flex justify-end gap-2 pt-4 border-t border-slate-700"><button onClick={() => setIsEditingAppliance(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm font-medium">Cancel</button><button onClick={handleSaveAppliance} className="px-6 py-2 bg-yellow-500 text-slate-900 font-bold rounded-lg hover:bg-yellow-400 transition shadow-lg shadow-yellow-500/20 text-sm">Save Device</button></div>
                      </div>
                  ) : (
                      <>
                                                <button onClick={() => { setEditingAppliance({ name: '', watts: 0, kwhEstimate: 0, iconName: 'zap', color: 'text-slate-400', durationMinutes: 60, inputMode: 'kwh_per_run' }); setIsEditingAppliance(true); }} className="w-full py-4 border-2 border-dashed border-slate-700 rounded-xl text-slate-400 hover:border-yellow-500 hover:text-yellow-500 hover:bg-yellow-500/5 transition-all flex items-center justify-center gap-2 font-medium"><Plus size={20}/> Add New Device</button>
                                                <div className="space-y-2">{formData.appliances?.map((app) => { const Icon = ICON_MAP[app.iconName] || Zap; const showWatts = (app.watts || 0) > 0; const showDuration = (app.durationMinutes || 0) > 0; return (<div key={app.id} className="bg-slate-900/50 p-3 rounded-xl border border-slate-700 flex items-center justify-between group hover:border-slate-500 transition-colors"><div className="flex items-center gap-4"><div className={`p-2.5 rounded-lg bg-slate-800 ${app.color}`}><Icon size={20} /></div><div><div className="text-sm font-bold text-slate-200">{app.name}</div><div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-2">{showWatts && (<span className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">{app.watts} W</span>)}{showDuration && (<span className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">{app.durationMinutes} min</span>)}<span className="text-emerald-400 font-medium">{app.kwhEstimate} kWh/run</span></div></div></div><div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => { const mode = (app as any).inputMode || 'kwh_per_run'; setEditingAppliance({ ...app, inputMode: mode, durationMinutes: (app.durationMinutes || (mode === 'power_duration' ? 60 : undefined)) }); setIsEditingAppliance(true); }} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-blue-400 transition" title="Edit"><Edit size={18}/></button><button onClick={() => handleDeleteAppliance(app.id)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-red-400 transition" title="Delete"><Trash2 size={18}/></button></div></div>); })}</div>
                        <div className="pt-4 flex justify-end gap-3 border-t border-slate-700 mt-4"><button onClick={handleConfigSubmit} className="flex items-center gap-2 px-6 py-2 bg-yellow-500 text-slate-900 font-bold rounded-lg hover:bg-yellow-400 transition shadow-lg shadow-yellow-500/20"><Save size={18} /> Save List</button></div>
                      </>
                  )}
              </div>
          )}

          {/* TAB: Tariffs */}
          {activeTab === 'tariffs' && (
            <div className="space-y-6">
              <div className="bg-blue-900/20 border border-blue-800 p-4 rounded-lg"><p className="text-sm text-blue-200">Manage your electricity prices. New prices apply from the "Valid From" date onwards.</p></div>
              <form onSubmit={handleAddTariff} className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                  <h3 className="text-slate-300 text-sm font-bold mb-3 flex items-center gap-2"><Plus size={16} className="text-green-400"/> Add Price Change</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div><label className="text-xs text-slate-500 block mb-1">Valid From</label><input type="date" required value={newTariff.validFrom} onChange={e => setNewTariff({...newTariff, validFrom: e.target.value})} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"/></div>
                      <div>
                          <label className="text-xs text-slate-500 block mb-1">Grid Cost / kWh</label>
                          <input type="number" step="0.001" required value={newTariff.costPerKwh} onChange={e => setNewTariff({...newTariff, costPerKwh: parseFloat(e.target.value)})} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/>
                          <p className="text-[9px] text-slate-500 mt-1">What you <strong>pay</strong> for electricity import (not part of EEG calc).</p>
                      </div>
                      <div>
                          <label className="text-xs text-slate-500 block mb-1 flex items-center justify-between">
                              Feed-in / kWh
                              <button type="button" onClick={() => setShowFeedInCalc(!showFeedInCalc)} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"><Scale size={10} /> Mixed Rate?</button>
                          </label>
                          <input type="number" step="0.00001" required value={newTariff.feedInTariff} onChange={e => setNewTariff({...newTariff, feedInTariff: parseFloat(e.target.value)})} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/>
                          <p className="text-[9px] text-slate-500 mt-1">What you <strong>earn</strong> for exporting solar energy.</p>
                      </div>
                  </div>
                  
                  {/* EEG Calculator Panel */}
                  {showFeedInCalc && (
                      <div className="mt-3 bg-slate-800 rounded-lg p-3 border border-slate-600 animate-fade-in">
                          <h4 className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1"><Calculator size={12}/> Weighted Average Calculator (EEG)</h4>
                          <p className="text-[10px] text-slate-400 mb-3">Calculate the blended price for your installed capacity (<strong>{formData.systemCapacity || 0} kWp</strong>). Your payment is proportional to the installed capacity ratio, NOT a simple average.</p>
                          <div className="grid grid-cols-3 gap-2">
                               <div>
                                  <label className="text-[9px] text-slate-500 block">Tier 1 Limit (kWp)</label>
                                  <input type="number" value={calcTier1Limit} onChange={e => setCalcTier1Limit(parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white" />
                               </div>
                               <div>
                                  <label className="text-[9px] text-slate-500 block">Tier 1 Price</label>
                                  <input type="number" step="0.001" value={calcPrice1} onChange={e => setCalcPrice1(parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white" />
                               </div>
                               <div>
                                  <label className="text-[9px] text-slate-500 block">Tier 2 Price</label>
                                  <input type="number" step="0.001" value={calcPrice2} onChange={e => setCalcPrice2(parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white" />
                               </div>
                          </div>
                          
                          {/* Verification Box */}
                          <div className="mt-3 p-2 bg-slate-900/50 rounded border border-slate-700/50 flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-slate-400">Verify with Annual Yield:</span>
                                  <input type="number" value={calcTestKwh} onChange={e => setCalcTestKwh(parseFloat(e.target.value))} className="w-16 bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-white text-center" />
                                  <span className="text-[10px] text-slate-400">kWh</span>
                              </div>
                              <div className="grid grid-cols-2 gap-x-2 text-[10px] text-slate-500 border-t border-slate-700/30 pt-1">
                                  <div>
                                      Tier 1 Share ({Math.min(100, (calcTier1Limit / (formData.systemCapacity || 1))*100).toFixed(1)}%):
                                      <br/><span className="text-white font-mono">{(calcTestKwh * Math.min(1, calcTier1Limit / (formData.systemCapacity || 1))).toFixed(0)} kWh</span>
                                  </div>
                                  <div>
                                      Tier 2 Share ({Math.max(0, 100 - (calcTier1Limit / (formData.systemCapacity || 1))*100).toFixed(1)}%):
                                      <br/><span className="text-white font-mono">{(calcTestKwh * (1 - Math.min(1, calcTier1Limit / (formData.systemCapacity || 1)))).toFixed(0)} kWh</span>
                                  </div>
                              </div>
                              <div className="text-[10px] text-emerald-400 font-bold flex justify-between border-t border-slate-700/30 pt-1">
                                   <span>Resulting Revenue:</span>
                                   <span>{getCurrencySymbol()} {(calcTestKwh * calculatedRate).toFixed(2)}</span>
                              </div>
                          </div>

                          <button type="button" onClick={applyBlendedRate} className="mt-2 w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded transition flex items-center justify-center gap-2"><Check size={12}/> Apply Rate: {calculatedRate.toFixed(5)}</button>
                      </div>
                  )}

                  <button type="submit" className="mt-3 w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded transition">Add Price Entry</button>
              </form>
              <div className="space-y-2"><h3 className="text-slate-400 text-sm font-bold">Price History</h3><div className="border border-slate-700 rounded-xl overflow-hidden"><table className="w-full text-sm text-left text-slate-300"><thead className="text-xs text-slate-500 uppercase bg-slate-900"><tr><th className="px-4 py-3">Valid From</th><th className="px-4 py-3">Grid Cost</th><th className="px-4 py-3">Feed-in</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-700 bg-slate-800">{tariffs.map((t) => (<tr key={t.id} className="hover:bg-slate-750"><td className="px-4 py-3 flex items-center gap-2"><Calendar size={14} className="text-slate-500"/>{t.validFrom}</td><td className="px-4 py-3 text-red-300">{getCurrencySymbol()} {t.costPerKwh.toFixed(3)}</td><td className="px-4 py-3 text-green-300">{getCurrencySymbol()} {t.feedInTariff.toFixed(5)}</td><td className="px-4 py-3 text-right"><button type="button" onClick={() => t.id && handleDeleteTariff(t.id)} className="text-slate-500 hover:text-red-400 transition"><Trash2 size={16} /></button></td></tr>))}</tbody></table></div></div>
            </div>
          )}

          {/* ... Expenses ... */}
           {activeTab === 'expenses' && (
            <div className="space-y-6">
                <div className="bg-slate-900/50 rounded-xl border border-slate-700 overflow-hidden"><div className="px-4 py-3 bg-slate-800/50 border-b border-slate-700 flex items-center justify-between"><h3 className="text-slate-300 text-sm font-bold flex items-center gap-2"><TrendingUp size={16} className="text-blue-400"/> Advanced Forecast Parameters</h3><button onClick={handleConfigSubmit} className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-white transition">Update Params</button></div><div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-6"><div><label className="block text-xs font-bold text-slate-400 mb-1">Module Degradation (% per year)</label><input type="number" step="0.1" value={formData.degradationRate} onChange={(e) => setFormData({...formData, degradationRate: parseFloat(e.target.value)})} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/><p className="text-[10px] text-slate-500 mt-1">PV modules lose efficiency over time. Default: 0.5%.</p></div><div><label className="block text-xs font-bold text-slate-400 mb-1">Expense Inflation (% per year)</label><input type="number" step="0.1" value={formData.inflationRate} onChange={(e) => setFormData({...formData, inflationRate: parseFloat(e.target.value)})} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/><p className="text-[10px] text-slate-500 mt-1">Annual increase in recurring maintenance costs. Default: 2.0%.</p></div></div></div>
                <div className="bg-emerald-900/20 border border-emerald-800 p-4 rounded-lg"><p className="text-sm text-emerald-200">Track your system costs (CAPEX) and recurring maintenance (OPEX) to calculate your Return on Investment.</p></div>
                <form onSubmit={handleAddExpense} className="bg-slate-900/50 p-4 rounded-xl border border-slate-700"><h3 className="text-slate-300 text-sm font-bold mb-3 flex items-center gap-2"><Plus size={16} className="text-green-400"/> Add Expense</h3><div className="grid grid-cols-1 md:grid-cols-4 gap-3"><div className="md:col-span-2"><label className="text-xs text-slate-500 block mb-1">Description</label><input type="text" placeholder="e.g. Initial Installation" required value={newExpense.name} onChange={e => setNewExpense({...newExpense, name: e.target.value})} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"/></div><div><label className="text-xs text-slate-500 block mb-1">Amount</label><input type="number" step="0.01" required value={newExpense.amount} onChange={e => setNewExpense({...newExpense, amount: parseFloat(e.target.value)})} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/></div><div><label className="text-xs text-slate-500 block mb-1">Type</label><select value={newExpense.type} onChange={e => setNewExpense({...newExpense, type: e.target.value as any})} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"><option value="one_time">One-time</option><option value="yearly">Yearly (Recurring)</option></select></div><div className="md:col-span-4"><label className="text-xs text-slate-500 block mb-1">Date Incurred (or Start Date for Yearly)</label><input type="date" required value={newExpense.date} onChange={e => setNewExpense({...newExpense, date: e.target.value})} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"/></div></div><button type="submit" className="mt-3 w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded transition">Add Expense</button></form>
                <div className="space-y-2"><h3 className="text-slate-400 text-sm font-bold">Expense Log</h3><div className="border border-slate-700 rounded-xl overflow-hidden"><table className="w-full text-sm text-left text-slate-300"><thead className="text-xs text-slate-500 uppercase bg-slate-900"><tr><th className="px-4 py-3">Expense</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Date</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-700 bg-slate-800">{expenses.map((e) => (<tr key={e.id} className="hover:bg-slate-750"><td className="px-4 py-3 font-medium text-white">{e.name}</td><td className="px-4 py-3"><span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${e.type === 'yearly' ? 'bg-blue-900/50 text-blue-300' : 'bg-slate-700 text-slate-300'}`}>{e.type === 'yearly' ? 'Yearly' : 'One-time'}</span></td><td className="px-4 py-3 text-slate-400">{e.date}</td><td className="px-4 py-3 text-right text-red-300">{getCurrencySymbol()}{e.amount.toLocaleString()}</td><td className="px-4 py-3 text-right"><button type="button" onClick={() => e.id && handleDeleteExpense(e.id)} className="text-slate-500 hover:text-red-400 transition"><Trash2 size={16} /></button></td></tr>))}</tbody></table></div></div>
            </div>
          )}
          {activeTab === 'history' && (
            <form onSubmit={handleConfigSubmit} className="space-y-8">
                 <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 shadow-inner">
                    <h3 className="text-slate-200 text-sm font-bold mb-3 flex items-center gap-2"><Calculator size={16} className="text-blue-400"/> ROI Calibration Checklist</h3>
                    <div className="space-y-3">
                        <div className={`flex items-center justify-between p-3 rounded-lg border ${hasStartDate ? 'bg-emerald-900/10 border-emerald-900/30' : 'bg-red-900/10 border-red-900/30'}`}><div className="flex items-center gap-3">{hasStartDate ? <CheckCircle2 size={18} className="text-emerald-500"/> : <AlertTriangle size={18} className="text-red-500"/>}<div><div className={`text-sm font-medium ${hasStartDate ? 'text-emerald-200' : 'text-red-200'}`}>System Start Date</div><div className="text-[10px] text-slate-400">Used to calculate recurring costs over time.</div></div></div>{!hasStartDate && (<button type="button" onClick={() => setActiveTab('general')} className="flex items-center gap-1 text-xs text-red-300 hover:text-white hover:underline">Set in General <ArrowRight size={12}/></button>)}</div>
                        <div className={`flex items-center justify-between p-3 rounded-lg border ${hasExpenses ? 'bg-emerald-900/10 border-emerald-900/30' : 'bg-red-900/10 border-red-900/30'}`}><div className="flex items-center gap-3">{hasExpenses ? <CheckCircle2 size={18} className="text-emerald-500"/> : <AlertTriangle size={18} className="text-red-500"/>}<div><div className={`text-sm font-medium ${hasExpenses ? 'text-emerald-200' : 'text-red-200'}`}>Installation Costs (Expenses)</div><div className="text-[10px] text-slate-400">Your initial investment is required to calculate ROI.</div></div></div>{!hasExpenses && (<button type="button" onClick={() => setActiveTab('expenses')} className="flex items-center gap-1 text-xs text-red-300 hover:text-white hover:underline">Add Expenses <ArrowRight size={12}/></button>)}</div>
                        <div className={`flex items-center justify-between p-3 rounded-lg border ${hasTariffs ? 'bg-emerald-900/10 border-emerald-900/30' : 'bg-red-900/10 border-red-900/30'}`}><div className="flex items-center gap-3">{hasTariffs ? <CheckCircle2 size={18} className="text-emerald-500"/> : <AlertTriangle size={18} className="text-red-500"/>}<div><div className={`text-sm font-medium ${hasTariffs ? 'text-emerald-200' : 'text-red-200'}`}>Electricity Tariffs</div><div className="text-[10px] text-slate-400">Needed to calculate how much money your solar saves you.</div></div></div>{!hasTariffs && (<button type="button" onClick={() => setActiveTab('tariffs')} className="flex items-center gap-1 text-xs text-red-300 hover:text-white hover:underline">Add Tariffs <ArrowRight size={12}/></button>)}</div>
                    </div>
                </div>
                <div className="space-y-6 pt-4 border-t border-slate-700 mt-6">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-slate-300 font-bold flex items-center gap-2"><History size={18}/> Pre-App History (Legacy Data)</h3>
                        <button 
                            type="button" 
                            onClick={() => setActiveTab('import')}
                            className="text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-1 rounded hover:bg-blue-500/20 transition-colors flex items-center gap-1"
                        >
                            <Upload size={10} /> Tip: Import HA History
                        </button>
                    </div>
                    
                    <div className="bg-purple-900/20 border border-purple-800 p-4 rounded-lg mb-4">
                        <p className="text-sm text-purple-200 flex items-start gap-2">
                            <HelpCircle size={18} className="shrink-0 mt-0.5"/>
                            <span>
                                <strong>Was the system running before you installed SunFlow?</strong><br/>
                                Enter the <i>Total Lifetime</i> values from your inverter or utility meter below. 
                                <br/><span className="text-xs text-purple-300/80 block mt-1">
                                    💡 <strong>Pro-Tip:</strong> You can upload your historical data from Home Assistant via the <strong>Data Import</strong> tab. 
                                    SunFlow will then calculate these values automatically for you after every import!
                                </span>
                            </span>
                        </p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-white mb-2 flex items-center gap-2">
                            <DollarSign size={16} className="text-green-400"/> Financial Return (Manual Offset)
                        </label>
                        <div className="flex gap-4">
                            <div className="flex-1 flex items-center bg-slate-900 border border-slate-600 rounded-lg overflow-hidden focus-within:border-yellow-500 transition-colors">
                                <div className="shrink-0 pl-3 pr-2 text-slate-400 font-bold border-r border-slate-700/50">{getCurrencySymbol()}</div>
                                <input 
                                    type="number" 
                                    step="0.01" 
                                    value={formData.initialValues?.financialReturn ?? ''} 
                                    onChange={(e) => setFormData({...formData, initialValues: { ...formData.initialValues || {}, financialReturn: e.target.value as any }})} 
                                    className="flex-1 bg-transparent border-none px-3 py-2 text-white focus:outline-none placeholder-slate-600 min-w-0" 
                                    placeholder="0.00"
                                />
                            </div>
                            <div className="flex-1 bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2 flex items-center justify-between">
                                <span className="text-xs text-slate-500 uppercase font-bold">In Database:</span>
                                <span className="text-sm font-bold text-emerald-400">
                                    {getCurrencySymbol()} {((formData as any).dbTotals?.financialReturn || 0).toFixed(2)}
                                </span>
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-2">
                            The "Manual Offset" is added to the values calculated from your database. Use this for returns earned BEFORE SunFlow started recording.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
                         <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/50 space-y-3">
                             <div>
                                <label className="block text-[10px] font-bold text-yellow-500 uppercase mb-1">Total Solar Yield</label>
                                <div className="text-xl font-bold text-white">{( (formData.initialValues?.production || 0) + ((formData as any).dbTotals?.production || 0) ).toLocaleString()} <span className="text-xs text-slate-500 font-normal">kWh</span></div>
                             </div>
                             <div className="pt-2 border-t border-slate-700/50">
                                <label className="block text-[9px] text-slate-500 uppercase mb-1">Manual Offset</label>
                                <div className="flex items-center bg-slate-800 border border-slate-600 rounded-md overflow-hidden transition-colors">
                                    <input type="number" step="1" value={formData.initialValues?.production ?? ''} onChange={(e) => setFormData({...formData, initialValues: { ...formData.initialValues || {}, production: parseInt(e.target.value) || 0 }})} className="w-full bg-transparent border-none px-2 py-1 text-sm text-white focus:outline-none" placeholder="0"/>
                                    <div className="px-2 text-[10px] text-slate-500 font-bold border-l border-slate-600">kWh</div>
                                </div>
                             </div>
                         </div>

                         <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/50 space-y-3">
                             <div>
                                <label className="block text-[10px] font-bold text-green-500 uppercase mb-1">Total Grid Export</label>
                                <div className="text-xl font-bold text-white">{( (formData.initialValues?.export || 0) + ((formData as any).dbTotals?.export || 0) ).toLocaleString()} <span className="text-xs text-slate-500 font-normal">kWh</span></div>
                             </div>
                             <div className="pt-2 border-t border-slate-700/50">
                                <label className="block text-[9px] text-slate-500 uppercase mb-1">Manual Offset</label>
                                <div className="flex items-center bg-slate-800 border border-slate-600 rounded-md overflow-hidden transition-colors">
                                    <input type="number" step="1" value={formData.initialValues?.export ?? ''} onChange={(e) => setFormData({...formData, initialValues: { ...formData.initialValues || {}, export: parseInt(e.target.value) || 0 }})} className="w-full bg-transparent border-none px-2 py-1 text-sm text-white focus:outline-none" placeholder="0"/>
                                    <div className="px-2 text-[10px] text-slate-500 font-bold border-l border-slate-600">kWh</div>
                                </div>
                             </div>
                         </div>

                         <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/50 space-y-3">
                             <div>
                                <label className="block text-[10px] font-bold text-red-400 uppercase mb-1">Total Grid Import</label>
                                <div className="text-xl font-bold text-white">{( (formData.initialValues?.import || 0) + ((formData as any).dbTotals?.import || 0) ).toLocaleString()} <span className="text-xs text-slate-500 font-normal">kWh</span></div>
                             </div>
                             <div className="pt-2 border-t border-slate-700/50">
                                <label className="block text-[9px] text-slate-500 uppercase mb-1">Manual Offset</label>
                                <div className="flex items-center bg-slate-800 border border-slate-600 rounded-md overflow-hidden transition-colors">
                                    <input type="number" step="1" value={formData.initialValues?.import ?? ''} onChange={(e) => setFormData({...formData, initialValues: { ...formData.initialValues || {}, import: parseInt(e.target.value) || 0 }})} className="w-full bg-transparent border-none px-2 py-1 text-sm text-white focus:outline-none" placeholder="0"/>
                                    <div className="px-2 text-[10px] text-slate-500 font-bold border-l border-slate-600">kWh</div>
                                </div>
                             </div>
                         </div>
                    </div>
                </div>
                <div className="pt-4 flex justify-end gap-3 border-t border-slate-700 mt-6"><button type="submit" className="flex items-center gap-2 px-6 py-2 bg-yellow-500 text-slate-900 font-bold rounded-lg hover:bg-yellow-400 transition shadow-lg shadow-yellow-500/20"><Save size={18} /> Save Calibration</button></div>
            </form>
          )}
          {activeTab === 'import' && (
             <CsvImporter onSuccess={async () => {
                // When an import is successful, the server automatically recalculates calibration.
                // We re-fetch the config here to show the new values in the Calibration tab.
                try {
                    const cfg = await getConfig();
                    setFormData(cfg);
                    // Also notify Dashboard to refresh stats
                    onSave(cfg);
                } catch(e) { console.error("Auto-refresh after import failed", e); }
             }} />
          )}

        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
