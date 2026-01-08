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
                    if (!err.message.includes("duplicate column name")) {
                        console.error("Migration error (status_code):", err.message);
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

            // Expenses Table (For ROI)
            db.run(`CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                amount REAL NOT NULL,
                type TEXT NOT NULL, -- 'one_time' or 'yearly'
                date DATE NOT NULL
            )`);
        });
    }
});

const getConfig = () => {
    if (fs.existsSync(CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
    return { inverterIp: '', currency: 'EUR', systemStartDate: new Date().toISOString().split('T')[0] };
};

const saveConfig = (cfg) => {
    const diskConfig = {
        inverterIp: cfg.inverterIp,
        currency: cfg.currency,
        systemStartDate: cfg.systemStartDate || new Date().toISOString().split('T')[0],
        latitude: cfg.latitude,
        longitude: cfg.longitude,
        systemCapacity: cfg.systemCapacity,
        initialValues: cfg.initialValues
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

// TARIFFS
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

// EXPENSES
app.get('/api/expenses', (req, res) => {
    db.all("SELECT id, name, amount, type, date FROM expenses ORDER BY date ASC", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/expenses', (req, res) => {
    const { name, amount, type, date } = req.body;
    const stmt = db.prepare("INSERT INTO expenses (name, amount, type, date) VALUES (?, ?, ?, ?)");
    stmt.run(name, amount, type, date, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, success: true });
    });
    stmt.finalize();
});

app.delete('/api/expenses/:id', (req, res) => {
    const stmt = db.prepare("DELETE FROM expenses WHERE id = ?");
    stmt.run(req.params.id, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// REALTIME DATA
app.get('/api/data', async (req, res) => {
    const config = getConfig();
    if (!config.inverterIp) return res.status(500).json({ error: "No Inverter IP" });

    const rawData = await fetchFroniusData(config.inverterIp);
    
    let responseData = {
        power: { pv: 0, load: 0, grid: 0, battery: 0 },
        battery: { soc: 0, state: 'idle' },
        energy: { today: { production: 0, consumption: 0 } },
        autonomy: 0,
        selfConsumption: 0
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
        
        // Populate Realtime Efficiency
        responseData.autonomy = Math.round(site.rel_Autonomy || 0);
        responseData.selfConsumption = Math.round(site.rel_SelfConsumption || 0);
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

// ROI / Amortization Endpoint
app.get('/api/roi', (req, res) => {
    const config = getConfig();
    const initialFinancialReturn = config.initialValues?.financialReturn || 0;
    
    db.all("SELECT * FROM expenses", [], (err, expenses) => {
        if (err) return res.status(500).json({ error: err.message });

        db.all("SELECT * FROM tariffs ORDER BY valid_from ASC", [], (err, tariffs) => {
            if (err) return res.status(500).json({ error: err.message });
            
            const tariffList = tariffs.map(t => ({
                validFrom: t.valid_from,
                costPerKwh: t.cost_per_kwh,
                feedInTariff: t.feed_in_tariff
            }));

            // Calculate Total Invested
            let totalInvested = 0;
            const now = new Date();
            // const systemStart = new Date(config.systemStartDate || '2000-01-01');
            
            expenses.forEach(exp => {
                if (exp.type === 'one_time') {
                    totalInvested += exp.amount;
                } else if (exp.type === 'yearly') {
                    // Calculate years since expense date or system start
                    const expDate = new Date(exp.date);
                    const diffTime = Math.abs(now.getTime() - expDate.getTime());
                    const diffYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);
                    totalInvested += exp.amount * diffYears;
                }
            });

            // Calculate Total Returns (All Time)
            const query = "SELECT timestamp, power_pv, power_load, power_grid FROM energy_log ORDER BY timestamp ASC";
            
            db.all(query, [], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                
                let dbReturned = 0;
                let returnLast90Days = 0;
                const sampleDurationHours = 1 / 60; // 1 minute
                
                const ninetyDaysAgo = new Date();
                ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
                
                // Track oldest data point within the 90 day window to calculate effective average
                let oldestInWindow = null;

                rows.forEach(r => {
                    const tsDate = new Date(r.timestamp);
                    const tariff = getTariffForTime(tariffList, r.timestamp);
                    
                    const cons = (r.power_load || 0) * sampleDurationHours / 1000;
                    let imp = 0;
                    let exp = 0;

                    if (r.power_grid > 0) imp = (r.power_grid) * sampleDurationHours / 1000;
                    else exp = Math.abs(r.power_grid) * sampleDurationHours / 1000;

                    const selfPoweredKwh = Math.max(0, cons - imp);
                    const saved = selfPoweredKwh * tariff.costPerKwh;
                    const earned = exp * tariff.feedInTariff;
                    const value = saved + earned;

                    dbReturned += value;

                    if (tsDate >= ninetyDaysAgo) {
                        returnLast90Days += value;
                        if (!oldestInWindow) oldestInWindow = tsDate;
                    }
                });

                // Add Initial/Historical Value to the DB calculated value
                const totalReturned = dbReturned + initialFinancialReturn;

                // Forecast Logic
                const netValue = totalReturned - totalInvested;
                let breakEvenDate = null;
                const roiPercent = totalInvested > 0 ? (totalReturned / totalInvested) * 100 : 0;

                if (netValue < 0) {
                    let dailyReturn = 0;
                    const systemStart = config.systemStartDate ? new Date(config.systemStartDate) : null;
                    
                    // Priority: Use Total Lifecycle Average if System Start Date is available
                    // Formula: (Historical $ + App-Tracked $) / Days since System Commissioning
                    if (systemStart && systemStart < now) {
                        const lifeTimeMs = now.getTime() - systemStart.getTime();
                        const lifeTimeDays = lifeTimeMs / (1000 * 60 * 60 * 24);
                        
                        // Prevent division by tiny numbers just in case
                        if (lifeTimeDays > 1) {
                            dailyReturn = totalReturned / lifeTimeDays;
                        }
                    }

                    // Fallback: If no start date or calculation failed, use DB-only short-term average
                    if (dailyReturn === 0) {
                        let durationDays = 1;
                        if (oldestInWindow) {
                            const diffTime = Math.abs(now.getTime() - oldestInWindow.getTime());
                            durationDays = diffTime / (1000 * 60 * 60 * 24);
                        }
                        const effectiveDays = Math.min(90, Math.max(0.1, durationDays));
                        dailyReturn = returnLast90Days / effectiveDays;
                    }

                    // Calculate Forecast Date
                    if (dailyReturn > 0.001) {
                        const remaining = Math.abs(netValue);
                        const daysLeft = remaining / dailyReturn;
                        const date = new Date();
                        date.setDate(date.getDate() + daysLeft);
                        
                        // Cap date at 100 years to prevent "Year 5000" bugs
                        if (daysLeft < 36500) {
                             breakEvenDate = date.toISOString();
                        }
                    }
                }

                res.json({
                    totalInvested,
                    totalReturned,
                    netValue,
                    roiPercent,
                    breakEvenDate,
                    expenses
                });
            });
        });
    });
});

// HISTORY
app.get('/api/history', (req, res) => {
    const range = req.query.range || 'day'; 
    const startDate = req.query.start; 
    const endDate = req.query.end;     
    
    let queryTimeClause = "";
    let groupBy = 1; 

    // Dynamic Grouping Logic
    if (range === 'custom' && startDate && endDate) {
        const startTs = `${startDate} 00:00:00`;
        const endTs = `${endDate} 23:59:59`;
        queryTimeClause = `timestamp BETWEEN '${startTs}' AND '${endTs}'`;

        const d1 = new Date(startDate);
        const d2 = new Date(endDate);
        const diffTime = Math.abs(d2 - d1);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays <= 1) groupBy = 1; 
        else if (diffDays <= 7) groupBy = 15;
        else if (diffDays <= 30) groupBy = 60; 
        else if (diffDays <= 90) groupBy = 120; 
        else groupBy = 1440; 
    } else {
        switch(range) {
            case 'hour': 
                queryTimeClause = "timestamp >= datetime('now', 'localtime', 'start of day', '+' || strftime('%H', 'now', 'localtime') || ' hours')"; 
                break;
            case 'day': 
                queryTimeClause = "timestamp >= datetime('now', 'localtime', 'start of day')"; 
                break;
            case 'week': 
                queryTimeClause = "timestamp >= datetime('now', 'localtime', '-6 days')"; 
                groupBy = 12; 
                break;
            case 'month': 
                queryTimeClause = "timestamp >= datetime('now', 'localtime', 'start of month')"; 
                groupBy = 60; 
                break;
            case 'year': 
                queryTimeClause = "timestamp >= datetime('now', 'localtime', 'start of year')"; 
                groupBy = 1440; 
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

            const sampleDurationHours = 1 / 60; 

            let stats = {
                production: 0, consumption: 0, imported: 0, exported: 0,
                batteryCharged: 0, batteryDischarged: 0,
                autonomy: 0, selfConsumption: 0, costSaved: 0, earnings: 0
            };

            // Calculate totals using ALL rows
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

            // Generate Chart Data
            const chartData = [];
            
            for (let i = 0; i < rows.length; i += groupBy) {
                // Calculate Autonomy/Self Consumption for this specific point
                const row = rows[i];
                const pProd = row.power_pv || 0;
                const pCons = row.power_load || 0;
                const pGrid = row.power_grid || 0; // +Import, -Export
                
                let pImp = 0;
                if (pGrid > 0) pImp = pGrid;
                
                let pExp = 0;
                if (pGrid < 0) pExp = Math.abs(pGrid);

                let pointAutonomy = 0;
                if (pCons > 0) {
                    // Autonomy = (Consumption - Import) / Consumption
                    pointAutonomy = ((pCons - pImp) / pCons) * 100;
                    if (pointAutonomy < 0) pointAutonomy = 0; 
                }

                let pointSelfCon = 0;
                if (pProd > 0) {
                    // SelfCons = (Production - Export) / Production
                    pointSelfCon = ((pProd - pExp) / pProd) * 100;
                }

                chartData.push({
                    timestamp: row.timestamp,
                    production: row.power_pv,
                    consumption: row.power_load,
                    soc: row.soc,
                    grid: row.power_grid, 
                    autonomy: Math.round(pointAutonomy),
                    selfConsumption: Math.round(pointSelfCon),
                    status: row.status_code !== undefined ? row.status_code : 1 
                });
            }

            // Ensure last point
            if (rows.length > 0 && chartData.length > 0 && chartData[chartData.length-1].timestamp !== rows[rows.length-1].timestamp) {
                const last = rows[rows.length-1];
                // Recalc for last point
                const pProd = last.power_pv || 0;
                const pCons = last.power_load || 0;
                const pGrid = last.power_grid || 0;
                let pImp = pGrid > 0 ? pGrid : 0;
                let pExp = pGrid < 0 ? Math.abs(pGrid) : 0;
                let aut = (pCons > 0) ? ((pCons - pImp)/pCons)*100 : 0;
                let self = (pProd > 0) ? ((pProd - pExp)/pProd)*100 : 0;

                chartData.push({
                    timestamp: last.timestamp,
                    production: last.power_pv,
                    consumption: last.power_load,
                    soc: last.soc,
                    grid: last.power_grid,
                    autonomy: Math.round(Math.max(0, aut)),
                    selfConsumption: Math.round(Math.max(0, self)),
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