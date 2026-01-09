
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Robust package.json loading
let packageJson = { version: "0.0.0" };
try {
    packageJson = require(path.join(__dirname, 'package.json'));
} catch (e) {
    console.error("Failed to load package.json:", e.message);
}

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
        try {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
            if (raw.trim()) {
                config = JSON.parse(raw);
            }
        } catch (e) {
            console.error("Error parsing config.json:", e.message);
        }
    }
    // Ensure default appliances exist if not present
    if (!config.appliances || config.appliances.length === 0) {
        config.appliances = DEFAULT_APPLIANCES;
    }
    // Ensure default notifications
    if (!config.notifications) {
        config.notifications = {
            enabled: false,
            discordWebhook: '',
            triggers: {
                errors: true,
                batteryFull: true,
                batteryEmpty: true,
                smartAdvice: true
            },
            smartAdviceCooldownMinutes: 120 // Default 2 hours cooldown
        };
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
// Fixed: Explicitly use the configured Timezone (Europe/Berlin default) using sv-SE locale (ISO-like format)
const getLocalTimestamp = (date = new Date()) => {
    const timeZone = process.env.TZ || 'Europe/Berlin';
    // 'sv-SE' locale formats as YYYY-MM-DD HH:mm:ss, which is SQL friendly
    return date.toLocaleString('sv-SE', { timeZone }).replace('T', ' ');
};


// --- NOTIFICATION LOGIC ---
// State to track between polling intervals
const notifyState = {
    previousSoc: 0,
    previousStatus: 1, // 1=OK
    smartAdviceCounters: {}, // Map<applianceId, countMinutes>
    lastSmartAdviceSent: 0, // Timestamp ms
};

const sendDiscordNotification = async (webhookUrl, title, description, color, fields = []) => {
    if (!webhookUrl) return;

    try {
        await axios.post(webhookUrl, {
            embeds: [{
                title: title,
                description: description,
                color: color, // Decimal color
                fields: fields,
                footer: { text: "SunFlow Gen24" },
                timestamp: new Date().toISOString()
            }]
        });
        console.log(`Notification sent: ${title}`);
    } catch (e) {
        console.error("Failed to send Discord notification:", e.message);
    }
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
        
        const site = rawData.Body.Data.Site;
        const inverters = rawData.Body.Data.Inverters;
        const inverterKey = Object.keys(inverters)[0]; // Assume 1 inverter
        const inverterData = inverters[inverterKey];

        soc = inverterData ? inverterData.SOC : 0;
        p_pv = site.P_PV || 0;
        p_load = Math.abs(site.P_Load || 0);
        p_grid = site.P_Grid || 0;
        p_batt = site.P_Akku || 0;
        e_day = site.E_Day || 0;

        if (apiCode === 0) {
            // Parse Device Status Code
            // Fronius Codes: 
            // 7 = Running
            // 8 = Standby (Night)
            // 9 = Bootloading
            // 10 = Error
            const deviceStatus = inverterData?.StatusCode;
            
            if (deviceStatus === 7) {
                statusCode = 1; // Running
            } else if (deviceStatus === 8 || deviceStatus === 9) {
                statusCode = 3; // Idle / Standby (NEW)
            } else if (deviceStatus >= 10) {
                statusCode = 2; // Error
            } else {
                // Fallback Logic if StatusCode missing
                // If PV is 0 and Battery is idle, assume Idle
                if (Math.abs(p_pv) < 5 && Math.abs(p_batt) < 10) {
                    statusCode = 3;
                } else {
                    statusCode = 1;
                }
            }
        } else {
            statusCode = 2; // API Reported Error
        }

    } else {
        statusCode = 0; // Offline / Network Error
    }

    // --- NOTIFICATION CHECKS ---
    if (config.notifications?.enabled && config.notifications?.discordWebhook) {
        const nConfig = config.notifications;
        
        // 1. Error Status (Only trigger on explicit error status 2, ignore Offline for now)
        if (nConfig.triggers.errors) {
            if (statusCode === 2 && notifyState.previousStatus !== 2) {
                await sendDiscordNotification(nConfig.discordWebhook, "⚠️ Inverter Error", "The inverter is reporting an error state.", 15158332); // Red
            }
        }
        notifyState.previousStatus = statusCode;

        // 2. Battery SOC Triggers
        if (nConfig.triggers.batteryFull) {
            if (soc === 100 && notifyState.previousSoc < 100) {
                await sendDiscordNotification(nConfig.discordWebhook, "🔋 Battery Full", "Storage has reached 100% capacity.", 5763719); // Green
            }
        }
        if (nConfig.triggers.batteryEmpty) {
            // Trigger at 7% or lower (assuming user wants to know when reserve is hit)
            // Only trigger if we crossed the threshold downwards
            if (soc <= 7 && notifyState.previousSoc > 7) {
                await sendDiscordNotification(nConfig.discordWebhook, "🪫 Battery Low", `Storage level dropped to ${Math.round(soc)}%.`, 15105570); // Orange
            }
        }
        notifyState.previousSoc = soc;

        // 3. Smart Advice (Debounced) - Only if Running (1)
        if (nConfig.triggers.smartAdvice && statusCode === 1) {
            const now = Date.now();
            const cooldownMs = (nConfig.smartAdviceCooldownMinutes || 60) * 60 * 1000;
            
            if (now - notifyState.lastSmartAdviceSent > cooldownMs) {
                const gridExport = p_grid < -10 ? Math.abs(p_grid) : 0;
                const battCharging = p_batt < -10 ? Math.abs(p_batt) : 0;
                const totalSurplus = gridExport + battCharging;

                let bestAppliance = null;

                (config.appliances || []).forEach(app => {
                    if (!notifyState.smartAdviceCounters[app.id]) notifyState.smartAdviceCounters[app.id] = 0;

                    if (totalSurplus >= app.watts) {
                        notifyState.smartAdviceCounters[app.id]++;
                    } else {
                        notifyState.smartAdviceCounters[app.id] = 0;
                    }

                    if (notifyState.smartAdviceCounters[app.id] >= 3) {
                        if (!bestAppliance || app.watts > bestAppliance.watts) {
                            bestAppliance = app;
                        }
                    }
                });

                if (bestAppliance) {
                    await sendDiscordNotification(
                        nConfig.discordWebhook, 
                        "💡 Smart Suggestion", 
                        `Excess solar power available (${Math.round(totalSurplus)}W). You can run the **${bestAppliance.name}** now for free!`, 
                        3447003, 
                        [
                            { name: "Surplus", value: `${Math.round(totalSurplus)} W`, inline: true },
                            { name: "Device", value: `${bestAppliance.watts} W`, inline: true }
                        ]
                    );
                    notifyState.lastSmartAdviceSent = now;
                    notifyState.smartAdviceCounters = {}; 
                }
            }
        }
    }

    // Insert with Explicit LOCAL TIMESTAMP
    // Now uses getLocalTimestamp which respects TZ env var correctly
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
        
        const latestTag = response.data?.tag_name; // e.g., "v1.0.1"
        if (latestTag) {
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
        }
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

// Test Notification Endpoint
app.post('/api/test-notification', async (req, res) => {
    const { webhookUrl } = req.body;
    if (!webhookUrl) return res.status(400).json({ error: "Missing webhook URL" });
    
    try {
        await sendDiscordNotification(webhookUrl, "🔔 Test Notification", "SunFlow notifications are working correctly!", 16776960);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/info', async (req, res) => {
    const info = await getVersionInfo();
    res.json(info);
});

// --- SOLCAST PROXY WITH CACHING ---
// Solcast Free Tier allows 10 calls per day.
// We strictly limit calls to daylight hours (05:00 - 21:00) to optimize usage.
// 16 hours window = 960 minutes. 960 / 10 calls = 96 minutes interval.
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
    const currentHour = new Date().getHours();
    const isDaytime = currentHour >= 5 && currentHour < 21; // 05:00 to 21:00

    // Cache Duration: 96 Minutes (to fit 10 calls in 16h)
    const CACHE_DURATION = 96 * 60 * 1000;

    // 1. Return fresh cache if available
    if (solcastCache.data && (now - solcastCache.timestamp < CACHE_DURATION)) {
        // console.log("Serving cached Solcast data");
        return res.json(solcastCache.data);
    }

    // 2. If it is NIGHT TIME (outside 05:00-21:00), do NOT fetch new data.
    // Return stale cache if available, else empty structure.
    if (!isDaytime) {
         console.log(`Night time (${currentHour}:00). Skipping Solcast update to save API limit.`);
         if (solcastCache.data) return res.json(solcastCache.data);
         // Return empty forecasts to prevent frontend crash
         return res.json({ forecasts: [] });
    }

    // 3. Fetch new data (Daytime & Cache Stale)
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
        // Handle Rate Limiting (429) explicitly
        if (error.response && error.response.status === 429) {
            console.error("Solcast Rate Limit Reached (429). Returning error to trigger UI hint.");
            return res.status(429).json({ error: "Solcast Rate Limit Reached" });
        }
        
        console.error("Solcast API Error:", error.message);

        // For other errors (e.g. timeout, network), serve stale cache if available
        if (solcastCache.data) {
            console.log("Serving stale Solcast cache due to network error");
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
        // Widen gap to 10W to capture real idle state better
        let batState = 'idle';
        if (site.P_Akku < -10) batState = 'charging';
        else if (site.P_Akku > 10) batState = 'discharging';
        
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
            let totalOneTimeCost = 0;

            const now = new Date();
            const systemStart = config.systemStartDate ? new Date(config.systemStartDate) : new Date();
            
            expenses.forEach(exp => {
                if (exp.type === 'one_time') {
                    totalInvested += exp.amount;
                    totalOneTimeCost += exp.amount;
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
                let projectedBreakEvenCost = 0;
                let isBreakEvenFound = false;
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
                                
                                // Calculate Projected Total Cost at that future date
                                const totalYearsDuration = (doneDate.getTime() - systemStart.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
                                projectedBreakEvenCost = totalOneTimeCost + (baseYearlyRecurringCost * totalYearsDuration);
                            } else {
                                remainingDebt -= segmentProfitPerDay * daysInSegment;
                            }
                        } else {
                            if (daysToClear < 365 * 50) { 
                                const doneDate = new Date(currentSegment.date);
                                doneDate.setDate(doneDate.getDate() + daysToClear);
                                breakEvenDate = doneDate.toISOString();
                                isBreakEvenFound = true;

                                // Calculate Projected Total Cost
                                const totalYearsDuration = (doneDate.getTime() - systemStart.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
                                projectedBreakEvenCost = totalOneTimeCost + (baseYearlyRecurringCost * totalYearsDuration);
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
                    projectedBreakEvenCost: isBreakEvenFound ? projectedBreakEvenCost : undefined,
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

    if (range === 'custom' && startDate && endDate) {
        const startTs = `${startDate} 00:00:00`;
        const endTs = `${endDate} 23:59:59`;
        queryTimeClause = `timestamp BETWEEN '${startTs}' AND '${endTs}'`;
        const d1 = new Date(startDate);
        const d2 = new Date(endDate);
        const diffDays = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
        // High resolution custom logic
        if (diffDays <= 2) groupBy = 1;       // 1 Minute for up to 2 days
        else if (diffDays <= 7) groupBy = 5;  // 5 Mins for up to a week
        else if (diffDays <= 31) groupBy = 30; // 30 Mins for up to a month
        else groupBy = 1440;                  // 1 Day otherwise
    } else {
        // Strict Rolling Windows
        const now = new Date();
        
        switch(range) {
            case 'hour':
                // Last 60 Minutes
                const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
                queryTimeClause = `timestamp >= '${getLocalTimestamp(oneHourAgo)}'`;
                groupBy = 1; 
                break;
            case 'day': 
                // Last 24 Hours
                const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                queryTimeClause = `timestamp >= '${getLocalTimestamp(yesterday)}'`; 
                groupBy = 1; 
                break;
            case 'week': 
                // Last 7 Days (Strict 168 Hours)
                const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                queryTimeClause = `timestamp >= '${getLocalTimestamp(lastWeek)}'`; 
                groupBy = 5; // 5 Minute Intervals
                break;
            case 'month': 
                // Last 30 Days
                const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                queryTimeClause = `timestamp >= '${getLocalTimestamp(lastMonth)}'`; 
                groupBy = 30; // 30 Minute Intervals
                break;
            case 'year': 
                // Last 365 Days
                const lastYear = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                queryTimeClause = `timestamp >= '${getLocalTimestamp(lastYear)}'`; 
                groupBy = 1440; // 1 Day Intervals
                break;
            default: 
                const defaultYesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                queryTimeClause = `timestamp >= '${getLocalTimestamp(defaultYesterday)}'`;
                groupBy = 1;
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
            
            // AGGREGATION LOGIC (Averaging instead of skipping)
            for (let i = 0; i < rows.length; i += groupBy) {
                let chunkPv = 0, chunkCons = 0, chunkGrid = 0, chunkBatt = 0, chunkSoc = 0;
                let chunkAutonomy = 0, chunkSelfCon = 0;
                let count = 0;
                const startTime = rows[i].timestamp;
                const status = rows[i].status_code !== undefined ? rows[i].status_code : 1;

                // Loop through the chunk to calculate average
                for (let j = 0; j < groupBy && (i + j) < rows.length; j++) {
                    const r = rows[i + j];
                    
                    const pProd = r.power_pv || 0; 
                    const pCons = r.power_load || 0; 
                    const pGrid = r.power_grid || 0;
                    
                    chunkPv += pProd;
                    chunkCons += pCons;
                    chunkGrid += pGrid;
                    chunkBatt += r.power_battery || 0;
                    chunkSoc += r.soc || 0;

                    let pImp = pGrid > 0 ? pGrid : 0;
                    let pExp = pGrid < 0 ? Math.abs(pGrid) : 0;
                    
                    let ptAuto = pCons > 0 ? ((pCons - pImp) / pCons) * 100 : 0;
                    if (ptAuto < 0) ptAuto = 0;
                    
                    let ptSelf = pProd > 0 ? ((pProd - pExp) / pProd) * 100 : 0;
                    
                    chunkAutonomy += ptAuto;
                    chunkSelfCon += ptSelf;
                    
                    count++;
                }

                if (count > 0) {
                    chartData.push({
                        timestamp: startTime,
                        production: Math.round(chunkPv / count),
                        consumption: Math.round(chunkCons / count),
                        grid: Math.round(chunkGrid / count),
                        battery: Math.round(chunkBatt / count),
                        soc: Math.round(chunkSoc / count),
                        autonomy: Math.round(chunkAutonomy / count),
                        selfConsumption: Math.round(chunkSelfCon / count),
                        status: status
                    });
                }
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
