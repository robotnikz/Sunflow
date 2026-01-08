import React, { useState } from 'react';
import { SystemConfig } from '../types';
import { X, Save } from 'lucide-react';

interface SettingsModalProps {
  currentConfig: SystemConfig;
  onSave: (config: SystemConfig) => void;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ currentConfig, onSave, onClose }) => {
  const [formData, setFormData] = useState<SystemConfig>(currentConfig);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-md shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-900/50">
          <h2 className="text-xl font-bold text-white">System Settings</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
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
            <p className="text-xs text-slate-500 mt-1">Local IP of your Fronius Gen24</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Cost per kWh</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={formData.costPerKwh}
                  onChange={(e) => setFormData({...formData, costPerKwh: parseFloat(e.target.value)})}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500"
                />
             </div>
             <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Feed-in Tariff</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={formData.feedInTariff}
                  onChange={(e) => setFormData({...formData, feedInTariff: parseFloat(e.target.value)})}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-yellow-500"
                />
             </div>
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <button 
              type="button" 
              onClick={onClose}
              className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="flex items-center gap-2 px-6 py-2 bg-yellow-500 text-slate-900 font-bold rounded-lg hover:bg-yellow-400 transition"
            >
              <Save size={18} />
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SettingsModal;