import { InverterData, SystemConfig, HistoryData, TimeRange } from '../types';

const API_BASE = ''; 

export const getRealtimeData = async (): Promise<InverterData> => {
  const res = await fetch(`${API_BASE}/api/data`);
  if (!res.ok) throw new Error("API call failed");
  return res.json();
};

export const getHistory = async (range: TimeRange): Promise<HistoryData> => {
  const res = await fetch(`${API_BASE}/api/history?range=${range}`);
  if (!res.ok) throw new Error("History call failed");
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