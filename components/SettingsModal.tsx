
import React, { useState, useEffect } from 'react';
import { SystemConfig, Tariff, Expense } from '../types';
import { X, Save, Plus, Trash2, Calendar, DollarSign, PenTool, MapPin, Zap, History, HelpCircle, Calculator, CheckCircle2, AlertTriangle, ArrowRight, TrendingUp, SunMedium, Battery } from 'lucide-react';
import { getTariffs, addTariff, deleteTariff, getExpenses, addExpense, deleteExpense } from '../services/api';

interface SettingsModalProps {
  currentConfig: SystemConfig;
  onSave: (config: SystemConfig) => void;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ currentConfig, onSave, onClose }) => {
  const [formData, setFormData] = useState<SystemConfig>(currentConfig);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  
  // Sync prop changes to state (important if config is loaded async after modal is ready)
  useEffect(() => {
    setFormData(prev => ({
        ...currentConfig,
        // Ensure initialValues is populated if missing in props but present in state
        initialValues: currentConfig.initialValues || prev.initialValues || {
            production: 0,
            import: 0,
            export: 0,
            financialReturn: 0
        }
    }));
  }, [currentConfig]);

  // Initialize defaults if missing
  useEffect(() => {
    if (!formData.initialValues) {
        setFormData(prev => ({
            ...prev,
            initialValues: {
                production: 0,
                import: 0,
                export: 0,
                financialReturn: 0
            }
        }));
    }
    // Set defaults for new fields if not present
    if (formData.degradationRate === undefined) setFormData(prev => ({ ...prev, degradationRate: 0.5 }));
    if (formData.inflationRate === undefined) setFormData(prev => ({ ...prev, inflationRate: 2.0 }));
    if (formData.batteryCapacity === undefined) setFormData(prev => ({ ...prev, batteryCapacity: 10.0 })); // Default 10kWh
  }, []);

  // New Tariff State
  const [newTariff, setNewTariff] = useState<Partial<Tariff>>({ 
    validFrom: new Date().toISOString().split('T')[0], 
    costPerKwh: 0, 
    feedInTariff: 0 
  });

  // New Expense State
  const [newExpense, setNewExpense] = useState<Partial<Expense>>({
    name: '',
    amount: 0,
    type: 'one_time',
    date: new Date().toISOString().split('T')[0]
  });

  const [activeTab, setActiveTab] = useState<'general' | 'tariffs' | 'expenses' | 'history'>('general');

  useEffect(() => {
    loadData();
  }, []);

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
        }
    };
    onSave(cleanedConfig);
  };

  // Auto-Calculate History Estimation
  const handleEstimateFinancials = () => {
    const vals = formData.initialValues;
    if (!vals) {
        alert("Please ensure the values below are entered correctly.");
        return;
    }

    // Use most recent tariff or default
    const latestTariff = tariffs.length > 0 ? tariffs[tariffs.length - 1] : { costPerKwh: 0.30, feedInTariff: 0.08 };
    
    // Parse values in case they are strings in local state
    const totalProd = Number(vals.production || 0);
    const totalExport = Number(vals.export || 0);
    
    if (totalProd === 0 && totalExport === 0) {
        alert("Please enter at least Production and Export values from your inverter history.");
        return;
    }

    // Self Consumption = Production - Export (simplified, assuming all non-export is self consumed or battery loss)
    const selfConsumed = Math.max(0, totalProd - totalExport);
    
    const saved = selfConsumed * latestTariff.costPerKwh;
    const earned = totalExport * latestTariff.feedInTariff;
    
    const total = saved + earned;

    if (confirm(`Estimate based on current/latest prices:\n\nSelf-Consumed (${selfConsumed.toFixed(0)} kWh) × ${latestTariff.costPerKwh} = ${formData.currency === 'EUR' ? '€' : '$'}${saved.toFixed(2)}\nExported (${totalExport.toFixed(0)} kWh) × ${latestTariff.feedInTariff} = ${formData.currency === 'EUR' ? '€' : '$'}${earned.toFixed(2)}\n\nTotal Estimate: ${formData.currency === 'EUR' ? '€' : '$'}${total.toFixed(2)}\n\nApply this value?`)) {
        setFormData({
            ...formData,
            initialValues: { ...vals, financialReturn: parseFloat(total.toFixed(2)) }
        });
    }
  };

  // Tariff Handlers
  const handleAddTariff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newTariff.validFrom && newTariff.costPerKwh !== undefined && newTariff.feedInTariff !== undefined) {
      await addTariff(newTariff as Tariff);
      loadData();
      setNewTariff({ 
        validFrom: new Date().toISOString().split('T')[0], 
        costPerKwh: 0, 
        feedInTariff: 0 
      });
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

  // Expense Handlers
  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newExpense.name && newExpense.amount && newExpense.date && newExpense.type) {
      await addExpense(newExpense as Expense);
      loadData();
      setNewExpense({
        name: '',
        amount: 0,
        type: 'one_time',
        date: new Date().toISOString().split('T')[0]
      });
    }
  };

  const handleDeleteExpense = async (id: number) => {
    if (confirm("Remove this expense?")) {
        await deleteExpense(id);
        loadData();
    }
  };

  const hasExpenses = expenses.length > 0;
  const hasTariffs = tariffs.length > 0;
  const hasStartDate = !!formData.systemStartDate;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-900/50">
          <h2 className="text-xl font-bold text-white">System Settings</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700 bg-slate-900/30 overflow-x-auto">
          <button 
            onClick={() => setActiveTab('general')}
            className={`flex-1 py-3 px-4 text-sm font-medium whitespace-nowrap transition-colors ${activeTab === 'general' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'text-slate-400 hover:text-slate-200'}`}
          >
            General & Location
          </button>
          <button 
            onClick={() => setActiveTab('tariffs')}
            className={`flex-1 py-3 px-4 text-sm font-medium whitespace-nowrap transition-colors ${activeTab === 'tariffs' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Prices & Tariffs
          </button>
          <button 
            onClick={() => setActiveTab('expenses')}
            className={`flex-1 py-3 px-4 text-sm font-medium whitespace-nowrap transition-colors ${activeTab === 'expenses' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Expenses & ROI
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-3 px-4 text-sm font-medium whitespace-nowrap transition-colors ${activeTab === 'history' ? 'text-yellow-500 border-b-2 border-yellow-500' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Calibration
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
                    <input 
                      type="text" 
                      value={formData.inverterIp}
                      onChange={(e) => setFormData({...formData, inverterIp: e.target.value})}
                      placeholder="e.g. 192.168.1.50"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">System Commissioning Date</label>
                    <input 
                      type="date" 
                      value={formData.systemStartDate}
                      onChange={(e) => setFormData({...formData, systemStartDate: e.target.value})}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500"
                      required
                    />
                    <p className="text-xs text-slate-500 mt-1">Used to calculate the timeline for recurring costs.</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Currency Symbol</label>
                    <select 
                      value={formData.currency}
                      onChange={(e) => setFormData({...formData, currency: e.target.value})}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500"
                    >
                        <option value="EUR">EUR (€)</option>
                        <option value="USD">USD ($)</option>
                        <option value="GBP">GBP (£)</option>
                    </select>
                  </div>
              </div>

              <div className="space-y-4 pt-4">
                 <h3 className="text-slate-300 font-bold border-b border-slate-700 pb-2 flex items-center gap-2">
                    <MapPin size={18}/> Location & Capacity
                 </h3>
                 <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">Latitude</label>
                        <input 
                          type="text" 
                          value={formData.latitude || ''}
                          onChange={(e) => setFormData({...formData, latitude: e.target.value})}
                          placeholder="e.g. 52.52"
                          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500"
                        />
                     </div>
                     <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">Longitude</label>
                        <input 
                          type="text" 
                          value={formData.longitude || ''}
                          onChange={(e) => setFormData({...formData, longitude: e.target.value})}
                          placeholder="e.g. 13.40"
                          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500"
                        />
                     </div>
                 </div>
                 
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
                            <Zap size={14} className="text-yellow-500"/> Solar Capacity (kWp)
                        </label>
                        <input 
                        type="number" step="0.1"
                        value={formData.systemCapacity || ''}
                        onChange={(e) => setFormData({...formData, systemCapacity: parseFloat(e.target.value)})}
                        placeholder="e.g. 10.5"
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
                            <Battery size={14} className="text-emerald-500"/> Battery Size (kWh)
                        </label>
                        <input 
                        type="number" step="0.1"
                        value={formData.batteryCapacity || ''}
                        onChange={(e) => setFormData({...formData, batteryCapacity: parseFloat(e.target.value)})}
                        placeholder="e.g. 7.7"
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                    </div>
                 </div>
              </div>

              {/* Solcast Configuration */}
              <div className="space-y-4 pt-4">
                 <h3 className="text-slate-300 font-bold border-b border-slate-700 pb-2 flex items-center gap-2">
                    <SunMedium size={18}/> Solcast API (Forecasting)
                 </h3>
                 <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700/50 mb-2">
                    <p className="text-xs text-slate-400">
                        Required for Smart Recommendations. Create a free account at <a href="https://solcast.com" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">solcast.com</a> and create a "Rooftop Site".
                    </p>
                 </div>
                 <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">API Key</label>
                    <input 
                      type="password" 
                      value={formData.solcastApiKey || ''}
                      onChange={(e) => setFormData({...formData, solcastApiKey: e.target.value})}
                      placeholder="e.g. XXXXXXXXXXXXXXXXXXXXXXXXXX"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500"
                    />
                 </div>
                 <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Site Resource ID</label>
                    <input 
                      type="text" 
                      value={formData.solcastSiteId || ''}
                      onChange={(e) => {
                        let val = e.target.value;
                        // Smart Paste: If user pastes the full URL, extract the ID
                        const urlMatch = val.match(/rooftop_sites\/([\w-]+)/);
                        if (urlMatch && urlMatch[1]) {
                            val = urlMatch[1];
                        }
                        setFormData({...formData, solcastSiteId: val})
                      }}
                      placeholder="e.g. 5a31-c8f1-8dcf-1cf1"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                        The ID from your Solcast dashboard (e.g. 5a31...). You can also just paste the full "Resource Link" here, and we'll extract the ID automatically.
                    </p>
                 </div>
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button 
                  type="submit" 
                  className="flex items-center gap-2 px-6 py-2 bg-yellow-500 text-slate-900 font-bold rounded-lg hover:bg-yellow-400 transition"
                >
                  <Save size={18} />
                  Save Settings
                </button>
              </div>
            </form>
          )}

          {/* TAB: Tariffs */}
          {activeTab === 'tariffs' && (
            <div className="space-y-6">
              <div className="bg-blue-900/20 border border-blue-800 p-4 rounded-lg">
                <p className="text-sm text-blue-200">
                  Manage your electricity prices. New prices apply from the "Valid From" date onwards.
                </p>
              </div>

              {/* Add New Tariff Form */}
              <form onSubmit={handleAddTariff} className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                <h3 className="text-slate-300 text-sm font-bold mb-3 flex items-center gap-2">
                    <Plus size={16} className="text-green-400"/> Add Price Change
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                        <label className="text-xs text-slate-500 block mb-1">Valid From</label>
                        <input 
                            type="date" 
                            required
                            value={newTariff.validFrom}
                            onChange={e => setNewTariff({...newTariff, validFrom: e.target.value})}
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-slate-500 block mb-1">Grid Cost / kWh</label>
                        <input 
                            type="number" step="0.001" required
                            value={newTariff.costPerKwh}
                            onChange={e => setNewTariff({...newTariff, costPerKwh: parseFloat(e.target.value)})}
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-slate-500 block mb-1">Feed-in / kWh</label>
                        <input 
                            type="number" step="0.001" required
                            value={newTariff.feedInTariff}
                            onChange={e => setNewTariff({...newTariff, feedInTariff: parseFloat(e.target.value)})}
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                    </div>
                </div>
                <button type="submit" className="mt-3 w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded transition">
                    Add Price Entry
                </button>
              </form>

              {/* Tariff List */}
              <div className="space-y-2">
                  <h3 className="text-slate-400 text-sm font-bold">Price History</h3>
                  <div className="border border-slate-700 rounded-xl overflow-hidden">
                    <table className="w-full text-sm text-left text-slate-300">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-900">
                            <tr>
                                <th className="px-4 py-3">Valid From</th>
                                <th className="px-4 py-3">Grid Cost</th>
                                <th className="px-4 py-3">Feed-in</th>
                                <th className="px-4 py-3 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700 bg-slate-800">
                            {tariffs.map((t) => (
                                <tr key={t.id} className="hover:bg-slate-750">
                                    <td className="px-4 py-3 flex items-center gap-2">
                                        <Calendar size={14} className="text-slate-500"/>
                                        {t.validFrom}
                                    </td>
                                    <td className="px-4 py-3 text-red-300">{t.costPerKwh.toFixed(3)}</td>
                                    <td className="px-4 py-3 text-green-300">{t.feedInTariff.toFixed(3)}</td>
                                    <td className="px-4 py-3 text-right">
                                        <button 
                                            type="button"
                                            onClick={() => t.id && handleDeleteTariff(t.id)}
                                            className="text-slate-500 hover:text-red-400 transition"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                  </div>
              </div>
            </div>
          )}

          {/* TAB: Expenses */}
          {activeTab === 'expenses' && (
            <div className="space-y-6">
                
                {/* Advanced Forecast Parameters */}
                <div className="bg-slate-900/50 rounded-xl border border-slate-700 overflow-hidden">
                    <div className="px-4 py-3 bg-slate-800/50 border-b border-slate-700 flex items-center justify-between">
                         <h3 className="text-slate-300 text-sm font-bold flex items-center gap-2">
                            <TrendingUp size={16} className="text-blue-400"/> Advanced Forecast Parameters
                        </h3>
                        <button onClick={handleConfigSubmit} className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-white transition">Update Params</button>
                    </div>
                    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-6">
                         <div>
                            <label className="block text-xs font-bold text-slate-400 mb-1">Module Degradation (% per year)</label>
                            <input 
                                type="number" step="0.1"
                                value={formData.degradationRate}
                                onChange={(e) => setFormData({...formData, degradationRate: parseFloat(e.target.value)})}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <p className="text-[10px] text-slate-500 mt-1">
                                PV modules lose efficiency over time. Default: 0.5%.
                            </p>
                         </div>
                         <div>
                            <label className="block text-xs font-bold text-slate-400 mb-1">Expense Inflation (% per year)</label>
                            <input 
                                type="number" step="0.1"
                                value={formData.inflationRate}
                                onChange={(e) => setFormData({...formData, inflationRate: parseFloat(e.target.value)})}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <p className="text-[10px] text-slate-500 mt-1">
                                Annual increase in recurring maintenance costs. Default: 2.0%.
                            </p>
                         </div>
                    </div>
                </div>

                <div className="bg-emerald-900/20 border border-emerald-800 p-4 rounded-lg">
                    <p className="text-sm text-emerald-200">
                    Track your system costs (CAPEX) and recurring maintenance (OPEX) to calculate your Return on Investment.
                    </p>
                </div>

                {/* Add Expense Form */}
                <form onSubmit={handleAddExpense} className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                    <h3 className="text-slate-300 text-sm font-bold mb-3 flex items-center gap-2">
                        <Plus size={16} className="text-green-400"/> Add Expense
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div className="md:col-span-2">
                            <label className="text-xs text-slate-500 block mb-1">Description</label>
                            <input 
                                type="text" placeholder="e.g. Initial Installation" required
                                value={newExpense.name}
                                onChange={e => setNewExpense({...newExpense, name: e.target.value})}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 block mb-1">Amount</label>
                            <input 
                                type="number" step="0.01" required
                                value={newExpense.amount}
                                onChange={e => setNewExpense({...newExpense, amount: parseFloat(e.target.value)})}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-slate-500 block mb-1">Type</label>
                            <select 
                                value={newExpense.type}
                                onChange={e => setNewExpense({...newExpense, type: e.target.value as any})}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"
                            >
                                <option value="one_time">One-time</option>
                                <option value="yearly">Yearly (Recurring)</option>
                            </select>
                        </div>
                        <div className="md:col-span-4">
                            <label className="text-xs text-slate-500 block mb-1">Date Incurred (or Start Date for Yearly)</label>
                            <input 
                                type="date" required
                                value={newExpense.date}
                                onChange={e => setNewExpense({...newExpense, date: e.target.value})}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"
                            />
                        </div>
                    </div>
                    <button type="submit" className="mt-3 w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded transition">
                        Add Expense
                    </button>
                </form>

                {/* Expense List */}
                <div className="space-y-2">
                  <h3 className="text-slate-400 text-sm font-bold">Expense Log</h3>
                  <div className="border border-slate-700 rounded-xl overflow-hidden">
                    <table className="w-full text-sm text-left text-slate-300">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-900">
                            <tr>
                                <th className="px-4 py-3">Expense</th>
                                <th className="px-4 py-3">Type</th>
                                <th className="px-4 py-3">Date</th>
                                <th className="px-4 py-3 text-right">Amount</th>
                                <th className="px-4 py-3 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700 bg-slate-800">
                            {expenses.map((e) => (
                                <tr key={e.id} className="hover:bg-slate-750">
                                    <td className="px-4 py-3 font-medium text-white">{e.name}</td>
                                    <td className="px-4 py-3">
                                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${e.type === 'yearly' ? 'bg-blue-900/50 text-blue-300' : 'bg-slate-700 text-slate-300'}`}>
                                            {e.type === 'yearly' ? 'Yearly' : 'One-time'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-slate-400">{e.date}</td>
                                    <td className="px-4 py-3 text-right text-red-300">
                                        {currentConfig.currency === 'EUR' ? '€' : '$'}{e.amount.toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <button 
                                            type="button"
                                            onClick={() => e.id && handleDeleteExpense(e.id)}
                                            className="text-slate-500 hover:text-red-400 transition"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                  </div>
                </div>
            </div>
          )}

          {/* TAB: History & Calibration */}
          {activeTab === 'history' && (
            <form onSubmit={handleConfigSubmit} className="space-y-8">
                {/* ... (Existing History Tab Content - Preserved) */}
                <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 shadow-inner">
                    <h3 className="text-slate-200 text-sm font-bold mb-3 flex items-center gap-2">
                        <Calculator size={16} className="text-blue-400"/> ROI Calibration Checklist
                    </h3>
                    {/* ... (Checklist implementation same as before) */}
                    <div className="space-y-3">
                        <div className={`flex items-center justify-between p-3 rounded-lg border ${hasStartDate ? 'bg-emerald-900/10 border-emerald-900/30' : 'bg-red-900/10 border-red-900/30'}`}>
                            <div className="flex items-center gap-3">
                                {hasStartDate ? <CheckCircle2 size={18} className="text-emerald-500"/> : <AlertTriangle size={18} className="text-red-500"/>}
                                <div>
                                    <div className={`text-sm font-medium ${hasStartDate ? 'text-emerald-200' : 'text-red-200'}`}>System Start Date</div>
                                    <div className="text-[10px] text-slate-400">Used to calculate recurring costs over time.</div>
                                </div>
                            </div>
                            {!hasStartDate && (
                                <button type="button" onClick={() => setActiveTab('general')} className="flex items-center gap-1 text-xs text-red-300 hover:text-white hover:underline">
                                    Set in General <ArrowRight size={12}/>
                                </button>
                            )}
                        </div>
                        {/* ... Expenses Check ... */}
                        <div className={`flex items-center justify-between p-3 rounded-lg border ${hasExpenses ? 'bg-emerald-900/10 border-emerald-900/30' : 'bg-red-900/10 border-red-900/30'}`}>
                            <div className="flex items-center gap-3">
                                {hasExpenses ? <CheckCircle2 size={18} className="text-emerald-500"/> : <AlertTriangle size={18} className="text-red-500"/>}
                                <div>
                                    <div className={`text-sm font-medium ${hasExpenses ? 'text-emerald-200' : 'text-red-200'}`}>Installation Costs (Expenses)</div>
                                    <div className="text-[10px] text-slate-400">Your initial investment is required to calculate ROI.</div>
                                </div>
                            </div>
                            {!hasExpenses && (
                                <button type="button" onClick={() => setActiveTab('expenses')} className="flex items-center gap-1 text-xs text-red-300 hover:text-white hover:underline">
                                    Add Expenses <ArrowRight size={12}/>
                                </button>
                            )}
                        </div>
                        {/* ... Tariffs Check ... */}
                        <div className={`flex items-center justify-between p-3 rounded-lg border ${hasTariffs ? 'bg-emerald-900/10 border-emerald-900/30' : 'bg-red-900/10 border-red-900/30'}`}>
                            <div className="flex items-center gap-3">
                                {hasTariffs ? <CheckCircle2 size={18} className="text-emerald-500"/> : <AlertTriangle size={18} className="text-red-500"/>}
                                <div>
                                    <div className={`text-sm font-medium ${hasTariffs ? 'text-emerald-200' : 'text-red-200'}`}>Electricity Tariffs</div>
                                    <div className="text-[10px] text-slate-400">Needed to calculate how much money your solar saves you.</div>
                                </div>
                            </div>
                            {!hasTariffs && (
                                <button type="button" onClick={() => setActiveTab('tariffs')} className="flex items-center gap-1 text-xs text-red-300 hover:text-white hover:underline">
                                    Add Tariffs <ArrowRight size={12}/>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
                {/* ... (Legacy data fields - preserved) */}
                <div className="space-y-6 pt-4 border-t border-slate-700 mt-6">
                    <h3 className="text-slate-300 font-bold flex items-center gap-2">
                        <History size={18}/> Pre-App History (Legacy Data)
                    </h3>
                    <div className="bg-purple-900/20 border border-purple-800 p-4 rounded-lg mb-4">
                        <p className="text-sm text-purple-200 flex items-start gap-2">
                            <HelpCircle size={18} className="shrink-0 mt-0.5"/>
                            <span>
                                <strong>Was the system running before you installed SunFlow?</strong><br/>
                                Enter the <i>Total Lifetime</i> values from your inverter/meter below. SunFlow will calculate the difference between these values and the data it has recorded to estimate your total lifetime earnings accurately.
                            </span>
                        </p>
                    </div>
                    {/* ... (Legacy fields implementation) ... */}
                    <div>
                        <label className="block text-sm font-medium text-white mb-2 flex items-center gap-2">
                           <DollarSign size={16} className="text-green-400"/> Legacy Financial Return
                        </label>
                        <div className="flex gap-2">
                            <div className="flex-1 flex items-center bg-slate-900 border border-slate-600 rounded-lg overflow-hidden focus-within:border-yellow-500 transition-colors">
                                <div className="shrink-0 pl-3 pr-2 text-slate-400 font-bold border-r border-slate-700/50">
                                    {formData.currency === 'EUR' ? '€' : '$'}
                                </div>
                                <input 
                                    type="number" step="0.01"
                                    value={formData.initialValues?.financialReturn ?? ''}
                                    onChange={(e) => setFormData({
                                        ...formData, 
                                        initialValues: { ...formData.initialValues || {}, financialReturn: e.target.value as any }
                                    })}
                                    className="flex-1 bg-transparent border-none px-3 py-2 text-white focus:outline-none placeholder-slate-600 min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    placeholder="0.00"
                                />
                            </div>
                            <button 
                                type="button"
                                onClick={handleEstimateFinancials}
                                className="px-3 bg-slate-700 hover:bg-slate-600 rounded-lg border border-slate-600 text-slate-300 transition-colors flex items-center gap-1"
                                title="Estimate based on kWh values below"
                            >
                                <Calculator size={16} /> <span className="text-xs font-medium hidden sm:inline">Auto-Calc</span>
                            </button>
                        </div>
                    </div>
                    {/* ... (Rest of legacy fields) ... */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
                         {/* Production */}
                         <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700/50">
                            <label className="block text-xs font-bold text-yellow-500 uppercase mb-2">Total Solar Production</label>
                            <div className="flex items-center bg-slate-800 border border-slate-600 rounded-lg overflow-hidden focus-within:border-yellow-500 transition-colors">
                                <input 
                                    type="number" step="0.1"
                                    value={formData.initialValues?.production ?? ''}
                                    onChange={(e) => setFormData({
                                        ...formData, 
                                        initialValues: { ...formData.initialValues || {}, production: e.target.value as any }
                                    })}
                                    className="flex-1 bg-transparent border-none px-3 py-2 text-white focus:outline-none placeholder-slate-600 min-w-0"
                                    placeholder="0"
                                />
                                <div className="shrink-0 px-3 py-2 bg-slate-700 text-slate-200 text-xs font-bold border-l border-slate-600">kWh</div>
                            </div>
                         </div>
                         {/* Export */}
                         <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700/50">
                            <label className="block text-xs font-bold text-green-500 uppercase mb-2">Total Grid Export</label>
                            <div className="flex items-center bg-slate-800 border border-slate-600 rounded-lg overflow-hidden focus-within:border-green-500 transition-colors">
                                <input 
                                    type="number" step="0.1"
                                    value={formData.initialValues?.export ?? ''}
                                    onChange={(e) => setFormData({
                                        ...formData, 
                                        initialValues: { ...formData.initialValues || {}, export: e.target.value as any }
                                    })}
                                    className="flex-1 bg-transparent border-none px-3 py-2 text-white focus:outline-none placeholder-slate-600 min-w-0"
                                    placeholder="0"
                                />
                                <div className="shrink-0 px-3 py-2 bg-slate-700 text-slate-200 text-xs font-bold border-l border-slate-600">kWh</div>
                            </div>
                         </div>
                         {/* Import */}
                         <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700/50">
                            <label className="block text-xs font-bold text-red-400 uppercase mb-2">Total Grid Import</label>
                            <div className="flex items-center bg-slate-800 border border-slate-600 rounded-lg overflow-hidden focus-within:border-red-500 transition-colors">
                                <input 
                                    type="number" step="0.1"
                                    value={formData.initialValues?.import ?? ''}
                                    onChange={(e) => setFormData({
                                        ...formData, 
                                        initialValues: { ...formData.initialValues || {}, import: e.target.value as any }
                                    })}
                                    className="flex-1 bg-transparent border-none px-3 py-2 text-white focus:outline-none placeholder-slate-600 min-w-0"
                                    placeholder="0"
                                />
                                <div className="shrink-0 px-3 py-2 bg-slate-700 text-slate-200 text-xs font-bold border-l border-slate-600">kWh</div>
                            </div>
                         </div>
                    </div>
                </div>

                <div className="pt-4 flex justify-end gap-3 border-t border-slate-700 mt-6">
                    <button 
                    type="submit" 
                    className="flex items-center gap-2 px-6 py-2 bg-yellow-500 text-slate-900 font-bold rounded-lg hover:bg-yellow-400 transition shadow-lg shadow-yellow-500/20"
                    >
                    <Save size={18} />
                    Save Calibration
                    </button>
                </div>
            </form>
          )}

        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
