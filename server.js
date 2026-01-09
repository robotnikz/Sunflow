
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
const semver = require('semver');
const packageJson = require('./package.json');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const REPO_OWNER = 'robotnikz';
const REPO_NAME = 'Sunflow';

// Data Directory Setup (Crucial for Docker persistence)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)){
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_FILE = path.join(DATA_DIR, 'solar_data.db');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

app.use(cors());
app.use(express.json());
// Serve static files from the React build
app.use(express.static(path.join(__dirname, 'dist')));

// Database Setup
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) console.error("Error opening database:", err.message);
    else {
        console.log(`Connected to SQLite database at ${DB_FILE}`);
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

const DEFAULT_APPLIANCES = [
  { id: 'phone', name: 'Charge Phone', watts: 15, kwhEstimate: 0.02, iconName: 'smartphone', color: 'text-blue-400' },
  { id: 'laptop', name: 'Laptop', watts: 60, kwhEstimate: 0.15, iconName: 'laptop', color: 'text-indigo-400' },
  { id: 'tv', name: 'TV / OLED', watts: 150, kwhEstimate: 0.3, iconName: 'tv', color: 'text-purple-400' },
  { id: 'pc', name: 'Gaming PC', watts: 400, kwhEstimate: 0.8, iconName: 'gamepad', color: 'text-pink-400' },
  { id: 'coffee', name: 'Coffee Maker', watts: 1000, kwhEstimate: 0.1, iconName: 'coffee', color: 'text-amber-700' },
  { id: 'dishwasher', name: 'Dishwasher', watts: 2000, kwhEstimate: 1.2, iconName: 'utensils', color: 'text-teal-400' },
  { id: 'washing', name: 'Washing Machine', watts: 2200, kwhEstimate: 1.0, iconName: 'shirt', color: 'text-cyan-400' },
  { id: 'dryer', name: 'Tumble Dryer', watts: 2000, kwhEstimate: 2.0, iconName: 'wind', color: 'text-orange-400' },
  { id: 'ev', name: 'Car (1h Charge)', watts: 3700, kwhEstimate: 3.7, iconName: 'car', color: 'text-emerald-400' },
];

const getConfig = () => {
    let config = { inverterIp: '', currency: 'EUR', systemStartDate: new Date().toISOString().split('T')[0] };
    if (fs.existsSync(CONFIG_FILE)) {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
    // Ensure default appliances exist if not present
    if (!config.appliances || config.appliances.length === 0) {
        config.appliances = DEFAULT_APPLIANCES;
    }
    return config;
};

const saveConfig = (cfg) => {
    // Merge with existing to ensure we don't lose fields
    const current = getConfig();
    const diskConfig = {
        ...current,
        ...cfg
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

// --- Version & Update Check Cache ---
let versionCache = {
    lastCheck: 0,
    data: { latestVersion: packageJson.version, updateAvailable: false, releaseUrl: '' }
};

const getVersionInfo = async () => {
    const now = Date.now();
    const CACHE_DURATION = 60 * 60 * 1000; // Check GitHub every hour
    
    // Return cached if fresh
    if (now - versionCache.lastCheck < CACHE_DURATION) {
        return {
            version: packageJson.version,
            ...versionCache.data
        };
    }

    try {
        // Check GitHub Latest Release
        const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'Sunflow-Dashboard' },
            timeout: 5000 
        });
        
        const latestTag = response.data.tag_name; // e.g., "v1.0.1"
        const releaseUrl = response.data.html_url;
        const cleanLatest = semver.clean(latestTag); // "1.0.1"
        const current = packageJson.version; // "1.0.0"

        const updateAvailable = cleanLatest && semver.gt(cleanLatest, current);

        versionCache = {
            lastCheck: now,
            data: {
                latestVersion: cleanLatest || current,
                updateAvailable: !!updateAvailable,
                releaseUrl: releaseUrl
            }
        };
    } catch (e) {
        console.error("Failed to check for updates:", e.message);
        // On error, keep old cache but update timestamp to retry later (e.g. 5 mins)
        versionCache.lastCheck = now - (CACHE_DURATION - 5 * 60 * 1000);
    }

    return {
        version: packageJson.version,
        ...versionCache.data
    };
};


// --- API ---

app.get('/api/config', (req, res) => res.json(getConfig()));

app.post('/api/config', (req, res) => {
    saveConfig(req.body);
    res.json({ success: true });
});

app.get('/api/info', async (req, res) => {
    const info = await getVersionInfo();
    res.json(info);
});

// --- SOLCAST PROXY WITH CACHING ---
// Solcast Free Tier allows ~10-50 calls per day. We MUST cache this.
let solcastCache = {
    timestamp: 0,
    data: null
};

app.get('/api/forecast', async (req, res) => {
    const config = getConfig();
    if (!config.solcastApiKey || !config.solcastSiteId) {
        return res.status(400).json({ error: "Solcast not configured" });
    }

    const now = Date.now();
    const CACHE_DURATION = 45 * 60 * 1000; // 45 minutes cache

    if (solcastCache.data && (now - solcastCache.timestamp < CACHE_DURATION)) {
        // console.log("Serving cached Solcast data");
        return res.json(solcastCache.data);
    }

    try {
        console.log("Fetching new data from Solcast API...");
        const url = `https://api.solcast.com.au/rooftop_sites/${config.solcastSiteId}/forecasts?format=json&api_key=${config.solcastApiKey}`;
        const response = await axios.get(url, { timeout: 8000 });
        
        solcastCache = {
            timestamp: now,
            data: response.data
        };
        res.json(response.data);
    } catch (error) {
        console.error("Solcast API Error:", error.message);
        // If API fails (e.g. rate limit), try to serve stale cache
        if (solcastCache.data) {
            console.log("Serving stale Solcast cache due to error");
            return res.json(solcastCache.data);
        }
        res.status(502).json({ error: "Failed to fetch forecast from Solcast" });
    }
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
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    db.serialize(() => {
        db.get("SELECT count(*) as count FROM tariffs", (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (row.count <= 1) return res.status(400).json({ error: "Cannot delete the last tariff." });

            db.run("DELETE FROM tariffs WHERE id = ?", id, function(err) {
                if (err) return res.status(500).json({ error: err.message });
                if (this.changes === 0) return res.status(404).json({ error: "Tariff not found" });
                res.json({ success: true });
            });
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
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    db.run("DELETE FROM expenses WHERE id = ?", id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Expense not found" });
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
        const inverterKey = Object.keys(inverters)[0];
        
        responseData.power = {
            pv: Math.round(site.P_PV || 0),
            load: Math.round(Math.abs(site.P_Load || 0)),
            grid: Math.round(site.P_Grid || 0),
            battery: Math.round(site.P_Akku || 0)
        };
        const soc = inverters[inverterKey]?.SOC || 0;
        
        // Correct battery state logic (Negative is Charging)
        let batState = 'idle';
        if (site.P_Akku < -5) batState = 'charging';
        else if (site.P_Akku > 5) batState = 'discharging';
        
        responseData.battery = {
            soc: soc,
            state: batState
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
    // ... (Existing ROI logic remains unchanged)
    // For brevity, using the existing implementation logic here.
    // The previous implementation is preserved.
    const config = getConfig();
    const initialFinancialReturn = config.initialValues?.financialReturn || 0;
    const degradationRate = config.degradationRate !== undefined ? config.degradationRate : 0.5;
    const inflationRate = config.inflationRate !== undefined ? config.inflationRate : 2.0;

    db.all("SELECT * FROM expenses", [], (err, expenses) => {
        if (err) return res.status(500).json({ error: err.message });

        db.all("SELECT * FROM tariffs ORDER BY valid_from ASC", [], (err, tariffs) => {
            if (err) return res.status(500).json({ error: err.message });
            
            const tariffList = tariffs.map(t => ({
                validFrom: t.valid_from,
                costPerKwh: t.cost_per_kwh,
                feedInTariff: t.feed_in_tariff
            }));

            let totalInvested = 0;
            let baseYearlyRecurringCost = 0;
            const now = new Date();
            const systemStart = config.systemStartDate ? new Date(config.systemStartDate) : new Date();
            
            expenses.forEach(exp => {
                if (exp.type === 'one_time') {
                    totalInvested += exp.amount;
                } else if (exp.type === 'yearly') {
                    baseYearlyRecurringCost += exp.amount;
                    const expDate = new Date(exp.date);
                    const effectiveDate = expDate > systemStart ? expDate : systemStart;
                    const diffTime = Math.max(0, now.getTime() - effectiveDate.getTime());
                    const diffYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);
                    totalInvested += exp.amount * diffYears;
                }
            });

            const query = "SELECT timestamp, power_pv, power_load, power_grid FROM energy_log ORDER BY timestamp ASC";
            
            db.all(query, [], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                
                let dbReturned = 0;
                let totalDbSelfConsumedKwh = 0;
                let totalDbExportedKwh = 0;
                let totalDbDays = 0;

                const sampleDurationHours = 1 / 60;
                const ninetyDaysAgo = new Date();
                ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
                let recentDbExport = 0;
                let recentDbSelfCons = 0;
                let oldestInWindow = null;

                if (rows.length > 0) {
                     const firstTs = new Date(rows[0].timestamp);
                     const lastTs = new Date(rows[rows.length-1].timestamp);
                     totalDbDays = (lastTs.getTime() - firstTs.getTime()) / (1000 * 60 * 60 * 24);
                     if (totalDbDays < 0.01) totalDbDays = 0.01;
                }

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
                    totalDbSelfConsumedKwh += selfPoweredKwh;
                    totalDbExportedKwh += exp;

                    if (tsDate >= ninetyDaysAgo) {
                        recentDbSelfCons += selfPoweredKwh;
                        recentDbExport += exp;
                        if (!oldestInWindow) oldestInWindow = tsDate;
                    }
                });

                const totalReturned = dbReturned + initialFinancialReturn;
                const netValue = totalReturned - totalInvested;
                let breakEvenDate = null;
                const roiPercent = totalInvested > 0 ? (totalReturned / totalInvested) * 100 : 0;

                if (netValue < 0) {
                    let avgDailyExport = 0;
                    let avgDailySelfCons = 0;
                    
                    if (systemStart && systemStart < now) {
                        const lifeTimeMs = now.getTime() - systemStart.getTime();
                        const lifeTimeDays = lifeTimeMs / (1000 * 60 * 60 * 24);
                        if (lifeTimeDays > 1) {
                            const initProd = config.initialValues?.production || 0;
                            const initExport = config.initialValues?.export || 0;
                            const initSelfCons = Math.max(0, initProd - initExport);
                            avgDailyExport = (initExport + totalDbExportedKwh) / lifeTimeDays;
                            avgDailySelfCons = (initSelfCons + totalDbSelfConsumedKwh) / lifeTimeDays;
                        }
                    }

                    if (avgDailyExport === 0 && avgDailySelfCons === 0) {
                        let durationDays = 1;
                        if (oldestInWindow) {
                            const diffTime = Math.abs(now.getTime() - oldestInWindow.getTime());
                            durationDays = diffTime / (1000 * 60 * 60 * 24);
                        }
                        const effectiveDays = Math.min(90, Math.max(0.1, durationDays));
                        avgDailyExport = recentDbExport / effectiveDays;
                        avgDailySelfCons = recentDbSelfCons / effectiveDays;
                    }

                    let remainingDebt = Math.abs(netValue);
                    let simDate = new Date();
                    const simStartTs = simDate.getTime();
                    const maxDate = new Date();
                    maxDate.setFullYear(maxDate.getFullYear() + 50);
                    
                    let isBreakEvenFound = false;
                    const futureTariffs = tariffList.filter(t => t.validFrom > simDate.toISOString().split('T')[0]);
                    const yearlyCheckpoints = [];
                    for(let i=1; i<=50; i++) {
                        const d = new Date(simDate);
                        d.setFullYear(d.getFullYear() + i);
                        d.setMonth(0); d.setDate(1);
                        yearlyCheckpoints.push(d);
                    }

                    const rawCheckPoints = [
                        { date: simDate, tariff: getTariffForTime(tariffList, simDate.toISOString()) },
                        ...futureTariffs.map(t => ({ date: new Date(t.validFrom), tariff: t })),
                        ...yearlyCheckpoints.map(d => ({ date: d, tariff: getTariffForTime(tariffList, d.toISOString()) }))
                    ].sort((a,b) => a.date.getTime() - b.date.getTime());

                    const checkPoints = rawCheckPoints.filter((item, pos, ary) => {
                        return !pos || item.date.getTime() !== ary[pos - 1].date.getTime();
                    });

                    for (let i = 0; i < checkPoints.length; i++) {
                        if (isBreakEvenFound) break;

                        const currentSegment = checkPoints[i];
                        const nextSegment = checkPoints[i+1];
                        
                        const msFromStart = currentSegment.date.getTime() - simStartTs;
                        const yearsPassed = msFromStart / (1000 * 60 * 60 * 24 * 365.25);
                        
                        const degFactor = Math.pow(1 - (degradationRate/100), yearsPassed);
                        const infFactor = Math.pow(1 + (inflationRate/100), yearsPassed);

                        const segmentDailyExport = avgDailyExport * degFactor;
                        const segmentDailySelfCons = avgDailySelfCons * degFactor;
                        const segmentDailyRecurringCost = (baseYearlyRecurringCost / 365.25) * infFactor;

                        const segmentProfitPerDay = 
                            (segmentDailySelfCons * currentSegment.tariff.costPerKwh) + 
                            (segmentDailyExport * currentSegment.tariff.feedInTariff) - 
                            segmentDailyRecurringCost;
                        
                        if (segmentProfitPerDay <= 0) {
                            if (!nextSegment) break; 
                            const daysInSegment = (nextSegment.date.getTime() - currentSegment.date.getTime()) / (1000 * 60 * 60 * 24);
                            remainingDebt += Math.abs(segmentProfitPerDay) * daysInSegment;
                            continue;
                        }

                        let daysToClear = remainingDebt / segmentProfitPerDay;
                        
                        if (nextSegment) {
                            const daysInSegment = (nextSegment.date.getTime() - currentSegment.date.getTime()) / (1000 * 60 * 60 * 24);
                            if (daysToClear <= daysInSegment) {
                                const doneDate = new Date(currentSegment.date);
                                doneDate.setDate(doneDate.getDate() + daysToClear);
                                breakEvenDate = doneDate.toISOString();
                                isBreakEvenFound = true;
                            } else {
                                remainingDebt -= segmentProfitPerDay * daysInSegment;
                            }
                        } else {
                            if (daysToClear < 365 * 50) { 
                                const doneDate = new Date(currentSegment.date);
                                doneDate.setDate(doneDate.getDate() + daysToClear);
                                breakEvenDate = doneDate.toISOString();
                                isBreakEvenFound = true;
                            }
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
    // ... (Existing history logic)
    // Preserving logic to avoid file bloat in this response, 
    // assuming no changes needed to existing history endpoint structure.
    const range = req.query.range || 'day'; 
    const startDate = req.query.start; 
    const endDate = req.query.end;     
    let queryTimeClause = "";
    let groupBy = 1; 

    if (range === 'custom' && startDate && endDate) {
        const startTs = `${startDate} 00:00:00`;
        const endTs = `${endDate} 23:59:59`;
        queryTimeClause = `timestamp BETWEEN '${startTs}' AND '${endTs}'`;
        const d1 = new Date(startDate);
        const d2 = new Date(endDate);
        const diffDays = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
        if (diffDays <= 1) groupBy = 1; 
        else if (diffDays <= 7) groupBy = 15;
        else if (diffDays <= 30) groupBy = 60; 
        else if (diffDays <= 90) groupBy = 120; 
        else groupBy = 1440; 
    } else {
        switch(range) {
            case 'hour': queryTimeClause = "timestamp >= datetime('now', 'localtime', 'start of day', '+' || strftime('%H', 'now', 'localtime') || ' hours')"; break;
            case 'day': queryTimeClause = "timestamp >= datetime('now', 'localtime', 'start of day')"; break;
            case 'week': queryTimeClause = "timestamp >= datetime('now', 'localtime', '-6 days')"; groupBy = 12; break;
            case 'month': queryTimeClause = "timestamp >= datetime('now', 'localtime', 'start of month')"; groupBy = 60; break;
            case 'year': queryTimeClause = "timestamp >= datetime('now', 'localtime', 'start of year')"; groupBy = 1440; break;
            default: queryTimeClause = "timestamp >= datetime('now', 'localtime', '-24 hours')";
        }
    }

    db.all("SELECT * FROM tariffs ORDER BY valid_from ASC", [], (err, tariffRows) => {
        if (err) return res.status(500).json({ error: err.message });
        const tariffs = tariffRows.map(t => ({ validFrom: t.valid_from, costPerKwh: t.cost_per_kwh, feedInTariff: t.feed_in_tariff }));
        const query = `SELECT timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code FROM energy_log WHERE ${queryTimeClause} ORDER BY timestamp ASC`;

        db.all(query, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            const sampleDurationHours = 1 / 60; 
            let stats = { production: 0, consumption: 0, imported: 0, exported: 0, batteryCharged: 0, batteryDischarged: 0, autonomy: 0, selfConsumption: 0, costSaved: 0, earnings: 0 };

            rows.forEach(r => {
                const tariff = getTariffForTime(tariffs, r.timestamp);
                const prod = (r.power_pv || 0) * sampleDurationHours / 1000;
                const cons = (r.power_load || 0) * sampleDurationHours / 1000;
                let imp = 0; let exp = 0;
                if (r.power_grid > 0) imp = (r.power_grid) * sampleDurationHours / 1000;
                else exp = Math.abs(r.power_grid) * sampleDurationHours / 1000;
                if (r.power_battery > 0) stats.batteryCharged += r.power_battery * sampleDurationHours / 1000;
                else stats.batteryDischarged += Math.abs(r.power_battery) * sampleDurationHours / 1000;
                stats.production += prod; stats.consumption += cons; stats.imported += imp; stats.exported += exp;
                const selfPoweredKwh = Math.max(0, cons - imp);
                stats.costSaved += selfPoweredKwh * tariff.costPerKwh;
                stats.earnings += exp * tariff.feedInTariff;
            });

            const totalSelfPowered = Math.max(0, stats.consumption - stats.imported);
            stats.autonomy = stats.consumption > 0 ? (totalSelfPowered / stats.consumption) * 100 : 0;
            stats.selfConsumption = stats.production > 0 ? (totalSelfPowered / stats.production) * 100 : 0;

            const chartData = [];
            for (let i = 0; i < rows.length; i += groupBy) {
                const row = rows[i];
                const pProd = row.power_pv || 0; const pCons = row.power_load || 0; const pGrid = row.power_grid || 0;
                let pImp = pGrid > 0 ? pGrid : 0; let pExp = pGrid < 0 ? Math.abs(pGrid) : 0;
                let pointAutonomy = pCons > 0 ? ((pCons - pImp) / pCons) * 100 : 0;
                if (pointAutonomy < 0) pointAutonomy = 0; 
                let pointSelfCon = pProd > 0 ? ((pProd - pExp) / pProd) * 100 : 0;
                chartData.push({
                    timestamp: row.timestamp, production: row.power_pv, consumption: row.power_load, soc: row.soc, grid: row.power_grid, 
                    autonomy: Math.round(pointAutonomy), selfConsumption: Math.round(pointSelfCon), status: row.status_code !== undefined ? row.status_code : 1 
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
