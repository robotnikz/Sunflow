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
        db.serialize(() => {
            // Main Log Table
            db.run(`CREATE TABLE IF NOT EXISTS energy_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                power_pv REAL,
                power_load REAL,
                power_grid REAL,
                power_battery REAL,
                soc REAL,
                energy_day_prod REAL,
                status_code INTEGER DEFAULT 1
            )`);
            
            // Migration: Add status_code column if it doesn't exist
            db.run("ALTER TABLE energy_log ADD COLUMN status_code INTEGER DEFAULT 1", (err) => {
                if (err) {
                    // Only log if the error is NOT about the column already existing
                    if (!err.message.includes("duplicate column name")) {
                        console.error("Migration error:", err.message);
                    }
                }
            });

            db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON energy_log(timestamp)`);

            // Tariffs Table
            db.run(`CREATE TABLE IF NOT EXISTS tariffs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                valid_from DATE NOT NULL,
                cost_per_kwh REAL NOT NULL,
                feed_in_tariff REAL NOT NULL
            )`, () => {
                db.get("SELECT count(*) as count FROM tariffs", (err, row) => {
                    if (row.count === 0) {
                        const oldConfig = getConfig();
                        console.log("Seeding initial tariff from config...");
                        const stmt = db.prepare("INSERT INTO tariffs (valid_from, cost_per_kwh, feed_in_tariff) VALUES (?, ?, ?)");
                        stmt.run("2000-01-01", oldConfig.costPerKwh || 0.30, oldConfig.feedInTariff || 0.08);
                        stmt.finalize();
                    }
                });
            });
        });
    }
});

const getConfig = () => {
    if (fs.existsSync(CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
    return { inverterIp: '', currency: 'EUR' };
};

const saveConfig = (cfg) => {
    const diskConfig = {
        inverterIp: cfg.inverterIp,
        currency: cfg.currency
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(diskConfig, null, 2));
};

const fetchFroniusData = async (ip) => {
    try {
        const url = `http://${ip}/solar_api/v1/GetPowerFlowRealtimeData.fcgi`;
        const response = await axios.get(url, { timeout: 3000 });
        return response.data;
    } catch (error) {
        return null;
    }
};

// Helper: Get Local SQLite-compatible Timestamp (YYYY-MM-DD HH:MM:SS)
const getLocalTimestamp = () => {
    const now = new Date();
    // Adjust to local time by subtracting the timezone offset
    const offsetMs = now.getTimezoneOffset() * 60 * 1000;
    const local = new Date(now.getTime() - offsetMs);
    // Slice ISO string to get YYYY-MM-DDTHH:MM:SS and replace T with space
    return local.toISOString().slice(0, 19).replace('T', ' ');
};

// Polling Job - 1 Minute Interval
setInterval(async () => {
    const config = getConfig();
    if (!config.inverterIp) return;

    const rawData = await fetchFroniusData(config.inverterIp);
    
    let p_pv = 0, p_load = 0, p_grid = 0, p_batt = 0, soc = 0, e_day = 0;
    let statusCode = 0; // 0 = Offline

    if (rawData && rawData.Body && rawData.Body.Data) {
        // Check Fronius API Response Code
        const apiCode = rawData.Head?.Status?.Code;
        
        if (apiCode === 0) {
            statusCode = 1; // 1 = Running/OK
        } else {
            statusCode = 2; // 2 = Error reported by Inverter
        }

        const site = rawData.Body.Data.Site;
        const inverters = rawData.Body.Data.Inverters;
        const inverterKey = Object.keys(inverters)[0];
        soc = inverters[inverterKey] ? inverters[inverterKey].SOC : 0;

        p_pv = site.P_PV || 0;
        p_load = Math.abs(site.P_Load || 0);
        p_grid = site.P_Grid || 0;
        p_batt = site.P_Akku || 0;
        e_day = site.E_Day || 0;
    } else {
        statusCode = 0; // Offline / Network Error
    }

    // Insert with Explicit LOCAL TIMESTAMP
    const timestamp = getLocalTimestamp();
    const stmt = db.prepare(`INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, energy_day_prod, status_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(timestamp, p_pv, p_load, p_grid, p_batt, soc, e_day, statusCode);
    stmt.finalize();

}, 60 * 1000); // 1 Minute

// --- API ---

app.get('/api/config', (req, res) => res.json(getConfig()));

app.post('/api/config', (req, res) => {
    saveConfig(req.body);
    res.json({ success: true });
});

app.get('/api/tariffs', (req, res) => {
    db.all("SELECT id, valid_from as validFrom, cost_per_kwh as costPerKwh, feed_in_tariff as feedInTariff FROM tariffs ORDER BY valid_from ASC", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/tariffs', (req, res) => {
    const { validFrom, costPerKwh, feedInTariff } = req.body;
    const stmt = db.prepare("INSERT INTO tariffs (valid_from, cost_per_kwh, feed_in_tariff) VALUES (?, ?, ?)");
    stmt.run(validFrom, costPerKwh, feedInTariff, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, success: true });
    });
    stmt.finalize();
});

app.delete('/api/tariffs/:id', (req, res) => {
    db.get("SELECT count(*) as count FROM tariffs", (err, row) => {
        if (row.count <= 1) return res.status(400).json({ error: "Cannot delete the last tariff." });
        const stmt = db.prepare("DELETE FROM tariffs WHERE id = ?");
        stmt.run(req.params.id, (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
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

const getTariffForTime = (tariffs, timestamp) => {
    let activeTariff = tariffs[0];
    const datePart = timestamp.substring(0, 10);
    for (const t of tariffs) {
        if (t.validFrom <= datePart) {
            activeTariff = t;
        } else {
            break;
        }
    }
    return activeTariff;
};

// History Endpoint
app.get('/api/history', (req, res) => {
    const range = req.query.range || 'day'; 
    const startDate = req.query.start; // YYYY-MM-DD
    const endDate = req.query.end;     // YYYY-MM-DD
    
    let queryTimeClause = "";
    let groupBy = 1; 

    // Dynamic Grouping Logic
    // If we request a huge timeframe (e.g. 6 months), we cannot return minute-by-minute data (too slow/heavy).
    // We must group data (downsampling).
    
    if (range === 'custom' && startDate && endDate) {
        // Construct full timestamp strings for SQLite comparison
        const startTs = `${startDate} 00:00:00`;
        const endTs = `${endDate} 23:59:59`;
        queryTimeClause = `timestamp BETWEEN '${startTs}' AND '${endTs}'`;

        // Calculate difference in days to determine grouping
        const d1 = new Date(startDate);
        const d2 = new Date(endDate);
        const diffTime = Math.abs(d2 - d1);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays <= 1) {
            groupBy = 1; // Every minute
        } else if (diffDays <= 7) {
            groupBy = 15; // Every 15 mins
        } else if (diffDays <= 30) {
            groupBy = 60; // Every hour
        } else if (diffDays <= 90) {
            groupBy = 120; // Every 2 hours
        } else {
            groupBy = 1440; // Daily averages (1440 mins)
        }
    } else {
        // Standard presets
        switch(range) {
            case 'hour': 
                queryTimeClause = "timestamp >= datetime('now', 'localtime', 'start of day', '+' || strftime('%H', 'now', 'localtime') || ' hours')"; 
                break;
            case 'day': 
                queryTimeClause = "timestamp >= datetime('now', 'localtime', 'start of day')"; 
                break;
            case 'week': 
                queryTimeClause = "timestamp >= datetime('now', 'localtime', '-6 days')"; 
                groupBy = 12; // ~12 mins
                break;
            case 'month': 
                queryTimeClause = "timestamp >= datetime('now', 'localtime', 'start of month')"; 
                groupBy = 60; // 1 Hour
                break;
            case 'year': 
                queryTimeClause = "timestamp >= datetime('now', 'localtime', 'start of year')"; 
                groupBy = 1440; // 1 Day
                break;
            default: 
                queryTimeClause = "timestamp >= datetime('now', 'localtime', '-24 hours')";
        }
    }

    db.all("SELECT * FROM tariffs ORDER BY valid_from ASC", [], (err, tariffRows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const tariffs = tariffRows.map(t => ({
            validFrom: t.valid_from,
            costPerKwh: t.cost_per_kwh,
            feedInTariff: t.feed_in_tariff
        }));

        const query = `
            SELECT 
                timestamp,
                power_pv, power_load, power_grid, power_battery, soc, status_code
            FROM energy_log 
            WHERE ${queryTimeClause}
            ORDER BY timestamp ASC
        `;

        db.all(query, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });

            const sampleDurationHours = 1 / 60; // Base data is always 1 minute intervals

            let stats = {
                production: 0, consumption: 0, imported: 0, exported: 0,
                batteryCharged: 0, batteryDischarged: 0,
                autonomy: 0, selfConsumption: 0, costSaved: 0, earnings: 0
            };

            // Calculate totals using ALL rows (high precision for stats)
            rows.forEach(r => {
                const tariff = getTariffForTime(tariffs, r.timestamp);
                const prod = (r.power_pv || 0) * sampleDurationHours / 1000;
                const cons = (r.power_load || 0) * sampleDurationHours / 1000;
                let imp = 0;
                let exp = 0;

                if (r.power_grid > 0) imp = (r.power_grid) * sampleDurationHours / 1000;
                else exp = Math.abs(r.power_grid) * sampleDurationHours / 1000;

                if (r.power_battery > 0) stats.batteryCharged += r.power_battery * sampleDurationHours / 1000;
                else stats.batteryDischarged += Math.abs(r.power_battery) * sampleDurationHours / 1000;

                stats.production += prod;
                stats.consumption += cons;
                stats.imported += imp;
                stats.exported += exp;

                const selfPoweredKwh = Math.max(0, cons - imp);
                stats.costSaved += selfPoweredKwh * tariff.costPerKwh;
                stats.earnings += exp * tariff.feedInTariff;
            });

            const totalSelfPowered = Math.max(0, stats.consumption - stats.imported);
            stats.autonomy = stats.consumption > 0 ? (totalSelfPowered / stats.consumption) * 100 : 0;
            stats.selfConsumption = stats.production > 0 ? (totalSelfPowered / stats.production) * 100 : 0;

            // Generate Chart Data (Downsampling)
            const chartData = [];
            
            // Simple Downsampling: Just pick the Nth row
            // Ideally, we would average the values between i and i+groupBy, 
            // but picking Nth row is faster and usually sufficient for trends.
            for (let i = 0; i < rows.length; i += groupBy) {
                chartData.push({
                    timestamp: rows[i].timestamp,
                    production: rows[i].power_pv,
                    consumption: rows[i].power_load,
                    soc: rows[i].soc,
                    grid: rows[i].power_grid, // Add Grid Power to chart data
                    status: rows[i].status_code !== undefined ? rows[i].status_code : 1 
                });
            }
            // Ensure the very last point is included if missed by loop
            if (rows.length > 0 && chartData[chartData.length-1].timestamp !== rows[rows.length-1].timestamp) {
                const last = rows[rows.length-1];
                chartData.push({
                    timestamp: last.timestamp,
                    production: last.power_pv,
                    consumption: last.power_load,
                    soc: last.soc,
                    grid: last.power_grid,
                    status: last.status_code !== undefined ? last.status_code : 1
                });
            }

            res.json({ chart: chartData, stats });
        });
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`SunFlow Backend running on http://localhost:${PORT}`);
});