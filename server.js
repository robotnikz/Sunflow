/**
 * Backend Server for SunFlow
 */

import express from 'express';
import { createRequire } from 'module';
import axios from 'axios';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const sqlite3 = require('sqlite3').verbose();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const DB_FILE = 'solar_data.db';
const CONFIG_FILE = 'config.json';

app.use(cors());
app.use(express.json());
app.use(express.static('dist'));

// Database Setup
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) console.error("Error opening database:", err.message);
    else {
        console.log("Connected to SQLite database.");
        db.run(`CREATE TABLE IF NOT EXISTS energy_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            power_pv REAL,
            power_load REAL,
            power_grid REAL,
            power_battery REAL,
            soc REAL,
            energy_day_prod REAL
        )`);
    }
});

const getConfig = () => {
    if (fs.existsSync(CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
    return { inverterIp: '', costPerKwh: 0.30, feedInTariff: 0.08, currency: 'EUR' };
};

const saveConfig = (cfg) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
};

const fetchFroniusData = async (ip) => {
    try {
        const url = `http://${ip}/solar_api/v1/GetPowerFlowRealtimeData.fcgi`;
        const response = await axios.get(url, { timeout: 3000 });
        return response.data;
    } catch (error) {
        // console.error(`Fronius Fetch Error: ${error.message}`);
        return null;
    }
};

// Polling Job
setInterval(async () => {
    const config = getConfig();
    if (!config.inverterIp) return;

    const rawData = await fetchFroniusData(config.inverterIp);
    if (rawData && rawData.Body && rawData.Body.Data) {
        const site = rawData.Body.Data.Site;
        const inverters = rawData.Body.Data.Inverters;
        const inverterKey = Object.keys(inverters)[0];
        const soc = inverters[inverterKey] ? inverters[inverterKey].SOC : 0;

        const p_pv = site.P_PV || 0;
        const p_load = Math.abs(site.P_Load || 0);
        const p_grid = site.P_Grid || 0;
        const p_batt = site.P_Akku || 0;
        const e_day = site.E_Day || 0;

        const stmt = db.prepare(`INSERT INTO energy_log (power_pv, power_load, power_grid, power_battery, soc, energy_day_prod) VALUES (?, ?, ?, ?, ?, ?)`);
        stmt.run(p_pv, p_load, p_grid, p_batt, soc, e_day);
        stmt.finalize();
    }
}, 5 * 60 * 1000); // 5 Minutes

// --- API ---

app.get('/api/config', (req, res) => res.json(getConfig()));

app.post('/api/config', (req, res) => {
    saveConfig(req.body);
    res.json({ success: true });
});

app.get('/api/data', async (req, res) => {
    const config = getConfig();
    if (!config.inverterIp) return res.status(500).json({ error: "No Inverter IP" });

    const rawData = await fetchFroniusData(config.inverterIp);
    
    let responseData = {
        power: { pv: 0, load: 0, grid: 0, battery: 0 },
        battery: { soc: 0, state: 'idle' },
        energy: { today: { production: 0, consumption: 0 } }
    };

    if (rawData && rawData.Body && rawData.Body.Data) {
        const site = rawData.Body.Data.Site;
        const inverters = rawData.Body.Data.Inverters;
        const invKey = Object.keys(inverters)[0];
        
        responseData.power = {
            pv: Math.round(site.P_PV || 0),
            load: Math.round(Math.abs(site.P_Load || 0)),
            grid: Math.round(site.P_Grid || 0),
            battery: Math.round(site.P_Akku || 0)
        };
        const soc = inverters[invKey]?.SOC || 0;
        responseData.battery = {
            soc: soc,
            state: (site.P_Akku > 5) ? 'charging' : (site.P_Akku < -5) ? 'discharging' : 'idle'
        };
        responseData.energy.today.production = (site.E_Day || 0) / 1000;
    }
    res.json(responseData);
});

// History Endpoint with Aggregation
app.get('/api/history', (req, res) => {
    const range = req.query.range || 'day'; // day, week, month, year
    const config = getConfig();
    
    let timeFilter;
    let groupBy;
    
    switch(range) {
        case 'week':
            timeFilter = "-7 days";
            groupBy = 4; // Approximate grouping for graph smoothness
            break;
        case 'month':
            timeFilter = "-30 days";
            groupBy = 12; 
            break;
        case 'year':
            timeFilter = "-365 days";
            groupBy = 288; // 1 day approx
            break;
        case 'day':
        default:
            timeFilter = "-24 hours";
            groupBy = 1;
            break;
    }

    const query = `
        SELECT 
            timestamp,
            power_pv, power_load, power_grid, power_battery, soc
        FROM energy_log 
        WHERE timestamp >= datetime('now', '${timeFilter}') 
        ORDER BY timestamp ASC
    `;

    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Helper to integrate power (Watts) over time to get Energy (kWh)
        // We log every 5 minutes. 
        // Energy (kWh) = Power (W) * (5/60) hours / 1000
        const sampleDurationHours = 5 / 60; 

        let stats = {
            production: 0, consumption: 0, imported: 0, exported: 0,
            batteryCharged: 0, batteryDischarged: 0,
            autonomy: 0, selfConsumption: 0, costSaved: 0, earnings: 0
        };

        rows.forEach(r => {
            stats.production += (r.power_pv || 0) * sampleDurationHours / 1000;
            stats.consumption += (r.power_load || 0) * sampleDurationHours / 1000;
            
            if (r.power_grid > 0) stats.imported += (r.power_grid) * sampleDurationHours / 1000;
            else stats.exported += Math.abs(r.power_grid) * sampleDurationHours / 1000;

            if (r.power_battery > 0) stats.batteryCharged += r.power_battery * sampleDurationHours / 1000;
            else stats.batteryDischarged += Math.abs(r.power_battery) * sampleDurationHours / 1000;
        });

        // Financials
        // Cost Saved = (Total Consumption - Imported from Grid) * Cost per kWh
        const selfPoweredKwh = Math.max(0, stats.consumption - stats.imported);
        stats.costSaved = selfPoweredKwh * config.costPerKwh;
        stats.earnings = stats.exported * config.feedInTariff;

        // Percentages
        stats.autonomy = stats.consumption > 0 ? (selfPoweredKwh / stats.consumption) * 100 : 0;
        stats.selfConsumption = stats.production > 0 ? (selfPoweredKwh / stats.production) * 100 : 0;

        // Resample rows for Chart (reduce points)
        const chartData = [];
        for (let i = 0; i < rows.length; i += groupBy) {
            chartData.push({
                timestamp: rows[i].timestamp,
                production: rows[i].power_pv,
                consumption: rows[i].power_load,
                soc: rows[i].soc
            });
        }

        res.json({ chart: chartData, stats });
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`SunFlow Backend running on http://localhost:${PORT}`);
});