import { InverterData, SystemConfig, HistoryData, TimeRange, Tariff } from '../types';

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

// --- Tariff API ---

export const getTariffs = async (): Promise<Tariff[]> => {
  const res = await fetch(`${API_BASE}/api/tariffs`);
  if (!res.ok) throw new Error("Failed to fetch tariffs");
  return res.json();
};

export const addTariff = async (tariff: Tariff): Promise<void> => {
  const res = await fetch(`${API_BASE}/api/tariffs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tariff)
  });
  if (!res.ok) throw new Error("Failed to add tariff");
};

export const deleteTariff = async (id: number): Promise<void> => {
  const res = await fetch(`${API_BASE}/api/tariffs/${id}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error("Failed to delete tariff");
};