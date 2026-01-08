/**
 * Backend Server for SolarSense
 * 
 * Responsibilities:
 * 1. Serve the React Frontend static files.
 * 2. Proxy requests to the Fronius Inverter (avoiding CORS).
 * 3. Poll the Inverter periodically and store history in SQLite.
 * 4. Serve aggregated API to the Frontend.
 */

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const DB_FILE = 'solar_data.db';
const CONFIG_FILE = 'config.json';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('dist')); // Assuming 'dist' is where Vite builds the frontend

// Database Setup
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error("Error opening database:", err.message);
    } else {
        console.log("Connected to SQLite database.");
        // Create table if not exists
        db.run(`CREATE TABLE IF NOT EXISTS energy_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            power_pv REAL,
            power_load REAL,
            power_grid REAL,
            power_battery REAL,
            soc REAL,
            energy_day_prod REAL,
            energy_day_cons REAL
        )`);
    }
});

// Helper: Load/Save Config
const getConfig = () => {
    if (fs.existsSync(CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
    return { inverterIp: '', costPerKwh: 0.30, feedInTariff: 0.08, currency: 'EUR' };
};

const saveConfig = (cfg) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
};

// Fronius API Fetcher
const fetchFroniusData = async (ip) => {
    try {
        const url = `http://${ip}/solar_api/v1/GetPowerFlowRealtimeData.fcgi`;
        const response = await axios.get(url, { timeout: 3000 });
        return response.data;
    } catch (error) {
        console.error(`Fronius Fetch Error: ${error.message}`);
        return null;
    }
};

// Background Job: Poll Data every 5 minutes for history
setInterval(async () => {
    const config = getConfig();
    if (!config.inverterIp) return;

    const rawData = await fetchFroniusData(config.inverterIp);
    if (rawData && rawData.Body && rawData.Body.Data) {
        const site = rawData.Body.Data.Site;
        const inverters = rawData.Body.Data.Inverters;
        // Find first inverter for SOC (Gen24 usually returns one key)
        const inverterKey = Object.keys(inverters)[0];
        const soc = inverters[inverterKey] ? inverters[inverterKey].SOC : 0;

        // Fronius returns Load as negative number usually, we normalize to positive for DB
        const p_pv = site.P_PV || 0;
        const p_load = Math.abs(site.P_Load || 0);
        const p_grid = site.P_Grid || 0;
        const p_batt = site.P_Akku || 0;
        const e_day = site.E_Day || 0; // Note: E_Day might need 'GetInverterRealtimeData' endpoint depending on firmware, using simplified assumption here

        const stmt = db.prepare(`INSERT INTO energy_log (power_pv, power_load, power_grid, power_battery, soc, energy_day_prod) VALUES (?, ?, ?, ?, ?, ?)`);
        stmt.run(p_pv, p_load, p_grid, p_batt, soc, e_day);
        stmt.finalize();
        console.log(`[Logged] PV: ${Math.round(p_pv)}W | Load: ${Math.round(p_load)}W | SOC: ${soc}%`);
    }
}, 5 * 60 * 1000); // 5 Minutes

// --- API Endpoints ---

// Get Config
app.get('/api/config', (req, res) => {
    res.json(getConfig());
});

// Set Config
app.post('/api/config', (req, res) => {
    saveConfig(req.body);
    res.json({ success: true });
});

// Get Realtime Data (Proxies to Inverter + gets recent history)
app.get('/api/data', async (req, res) => {
    const config = getConfig();
    if (!config.inverterIp) {
        return res.status(500).json({ error: "No Inverter IP configured" });
    }

    // 1. Fetch Realtime
    const rawData = await fetchFroniusData(config.inverterIp);
    
    // 2. Fetch History (Last 24 hours)
    db.all(`SELECT timestamp, power_pv, power_load, soc FROM energy_log WHERE timestamp >= datetime('now', '-24 hours') ORDER BY timestamp ASC`, [], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: "DB Error" });
        }

        // Process Realtime Data
        let responseData = {
            power: { pv: 0, load: 0, grid: 0, battery: 0 },
            battery: { soc: 0, state: 'idle' },
            energy: { today: { production: 0, consumption: 0 } },
            history: rows.map(r => ({
                timestamp: r.timestamp,
                production: r.power_pv,
                consumption: r.power_load,
                soc: r.soc
            }))
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
            
            // Note: For real cumulative energy, we'd need another API call to GetInverterRealtimeData
            // Here we estimate or use available fields.
            responseData.energy.today.production = (site.E_Day || 0) / 1000; 
        }

        res.json(responseData);
    });
});

// Serve frontend for any other route
app.get('*', (req, res) => {
    // If running in development without build, this might fail, but for production:
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`SolarSense Backend running on http://localhost:${PORT}`);
});