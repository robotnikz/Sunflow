import React, { useState, useEffect } from 'react';
import { SystemConfig, Tariff, Expense } from '../types';
import { X, Save, Plus, Trash2, Calendar, DollarSign, PenTool } from 'lucide-react';
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

  const [activeTab, setActiveTab] = useState<'general' | 'tariffs' | 'expenses'>('general');

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
    onSave(formData);
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
    if (confirm("Are you sure?")) {
      try {
        await deleteTariff(id);
        loadData();
      } catch (e) {
        alert("Cannot delete the last remaining tariff.");
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
            General
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
        </div>
        
        {/* Content */}
        <div className="p-6 overflow-y-auto">
          
          {/* TAB: General */}
          {activeTab === 'general' && (
            <form onSubmit={handleConfigSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Inverter IP Address</label>
                <input 
                  type="text" 
                  value={formData.inverterIp}
                  onChange={(e) => setFormData({...formData, inverterIp: e.target.value})}
                  placeholder="e.g. 192.168.1.50"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500"
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
                <p className="text-xs text-slate-500 mt-1">Used to calculate recurring yearly costs.</p>
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

              <div className="pt-4 flex justify-end gap-3">
                <button 
                  type="submit" 
                  className="flex items-center gap-2 px-6 py-2 bg-yellow-500 text-slate-900 font-bold rounded-lg hover:bg-yellow-400 transition"
                >
                  <Save size={18} />
                  Save General Settings
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
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-slate-500 block mb-1">Feed-in / kWh</label>
                        <input 
                            type="number" step="0.001" required
                            value={newTariff.feedInTariff}
                            onChange={e => setNewTariff({...newTariff, feedInTariff: parseFloat(e.target.value)})}
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"
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
                                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"
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

        </div>
      </div>
    </div>
  );
};

export default SettingsModal;