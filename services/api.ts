import { InverterData, SystemConfig } from '../types';

const API_BASE = (import.meta as any).env?.PROD ? '' : 'http://localhost:3000'; // Adjust for dev mode

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