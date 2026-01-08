import { InverterData, SystemConfig } from '../types';

// Use relative paths so calls go through Vite proxy in dev 
// or directly to same origin in prod.
const API_BASE = ''; 

export const getRealtimeData = async (): Promise<InverterData> => {
  const res = await fetch(`${API_BASE}/api/data`);
  if (!res.ok) throw new Error("API call failed");
  return res.json();
};

export const getConfig = async (): Promise<SystemConfig> => {
  const res = await fetch(`${API_BASE}/api/config`);
  if (!res.ok) throw new Error("API call failed");
  return res.json();
};

export const saveConfig = async (config: SystemConfig): Promise<void> => {
  const res = await fetch(`${API_BASE}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  if (!res.ok) throw new Error("API call failed");
};