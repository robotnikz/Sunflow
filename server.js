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
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

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
const multer = require('multer'); // New: File Uploads
const Papa = require('papaparse'); // New: CSV Parsing

const PORT = process.env.PORT || 3000;
const REPO_OWNER = 'robotnikz';
const REPO_NAME = 'Sunflow';

// Data Directory Setup (Crucial for Docker persistence)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)){
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)){
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Upload config for middleware
const upload = multer({ dest: UPLOADS_DIR });

const DB_FILE = path.join(DATA_DIR, 'solar_data.db');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// --- SECURITY MIDDLEWARE ---
// 1. Helmet: Sets various HTTP headers to secure the app
app.use(helmet({
    contentSecurityPolicy: false, // Disabled for simple dev/dashboard setup (inline scripts etc)
    crossOriginEmbedderPolicy: false,
}));

// 2. CORS: Allow cross-origin requests (Dashboard usage)
app.use(cors());

// 3. Rate Limiting: Prevent brute-force or accidental DoS
const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	limit: 5000, // Limit each IP to 5000 requests per window (High enough for polling dashboard)
	standardHeaders: true, 
	legacyHeaders: false, 
});
app.use('/api/', apiLimiter);

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

            // Main data table for long-term storage from imports
            db.run(`CREATE TABLE IF NOT EXISTS energy_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME UNIQUE,
                production_wh REAL,
                grid_feed_in_wh REAL,
                grid_consumption_wh REAL,
                battery_charge_wh REAL,
                battery_discharge_wh REAL,
                load_wh REAL
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
                batteryHealth: false,
                smartAdvice: true
            },
            smartAdviceCooldownMinutes: 120,
            sohThreshold: 75,
            minCyclesForSoh: 50
        };
    }
    return config;
};

const saveConfig = (cfg) => {
    // Validate inputs loosely
    if (typeof cfg !== 'object') return;
    
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
const getLocalTimestamp = (date = new Date()) => {
    const timeZone = process.env.TZ || 'Europe/Berlin';
    return date.toLocaleString('sv-SE', { timeZone }).replace('T', ' ');
};

// --- GLOBAL SOLCAST CACHE (Shared between API and Notification Logic) ---
let solcastCache = {
    timestamp: 0,
    data: null
};


// --- NOTIFICATION LOGIC ---
const notifyState = {
    previousSoc: 0,
    previousStatus: 1, 
    smartAdviceCounters: {}, 
    lastSmartAdviceSent: 0, 
    lastSohCheck: 0, // Track when we last checked battery health
    notifiedFull: false, // Prevent notification bouncing at 100%
    notifiedLow: false,  // Prevent notification bouncing at low levels
};

const sendDiscordNotification = async (webhookUrl, title, description, color, fields = []) => {
    if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.startsWith('http')) return;

    try {
        await axios.post(webhookUrl, {
            embeds: [{
                title: title,
                description: description,
                color: color, 
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

// Helper function to check health status (Heavy query, run infrequently)
const checkBatteryHealthNotification = (config, nominalCapacity) => {
    return new Promise((resolve, reject) => {
        if (!config.notifications?.triggers?.batteryHealth) return resolve();
        if (Date.now() - notifyState.lastSohCheck < 24 * 60 * 60 * 1000) return resolve(); // Check once per 24h

        // Query only what we need to estimate latest capacity and total cycles
        const query = `
            SELECT
                strftime('%Y-%m-%d', timestamp) as date,
                SUM(CASE WHEN power_battery < -10 THEN ABS(power_battery) ELSE 0 END) as total_charge_w,
                SUM(CASE WHEN power_battery > 10 THEN power_battery ELSE 0 END) as total_discharge_w,
                MIN(soc) as min_soc,
                MAX(soc) as max_soc
            FROM energy_log
            WHERE power_battery != 0
            GROUP BY date
            ORDER BY date DESC
            LIMIT 365 -- Look back 1 year max for calculation efficiency
        `;

        db.all(query, [], async (err, rows) => {
            if (err) return resolve();

            let totalCycles = 0;
            let latestCapacityEst = 0;
            let validSamples = 0;

            rows.forEach(r => {
                const chargedKwh = (r.total_charge_w / 60) / 1000;
                const dischargedKwh = (r.total_discharge_w / 60) / 1000;
                
                // Estimate Cycles
                const cycles = (chargedKwh + dischargedKwh) / 2 / (nominalCapacity || 10);
                totalCycles += cycles;

                // Estimate Capacity if huge swing
                const socDelta = r.max_soc - r.min_soc;
                if (socDelta > 50 && chargedKwh > 1) {
                    const cap = (chargedKwh / socDelta) * 100;
                    // Taking the average of the last few valid samples would be better, 
                    // but taking the latest valid one is acceptable for alert logic
                    if (validSamples < 5) { // Weight recent samples
                        latestCapacityEst = cap; 
                        validSamples++;
                    }
                }
            });

            // Update state time
            notifyState.lastSohCheck = Date.now();

            const minCycles = config.notifications.minCyclesForSoh || 50;
            const threshold = config.notifications.sohThreshold || 75;

            // Only alert if we have enough data (cycles) to be sure
            if (totalCycles > minCycles && latestCapacityEst > 0) {
                const soh = (latestCapacityEst / nominalCapacity) * 100;
                
                if (soh < threshold) {
                     await sendDiscordNotification(
                        config.notifications.discordWebhook,
                        "⚠️ Battery Health Alert",
                        `Battery State of Health (SOH) has dropped to **${soh.toFixed(1)}%**.`,
                        15158332, // Red
                        [
                            { name: "Current SOH", value: `${soh.toFixed(1)}%`, inline: true },
                            { name: "Threshold", value: `${threshold}%`, inline: true },
                            { name: "Est. Cycles", value: `${Math.round(totalCycles)}`, inline: true }
                        ]
                    );
                }
            }
            resolve();
        });
    });
};

// Polling Job - 1 Minute Interval
setInterval(async () => {
    const config = getConfig();
    if (!config.inverterIp) return;

    const rawData = await fetchFroniusData(config.inverterIp);
    
    let p_pv = 0, p_load = 0, p_grid = 0, p_batt = 0, soc = 0, e_day = 0;
    let statusCode = 0; // 0 = Offline

    if (rawData && rawData.Body && rawData.Body.Data) {
        const apiCode = rawData.Head?.Status?.Code;
        const site = rawData.Body.Data.Site;
        const inverters = rawData.Body.Data.Inverters;
        const inverterKey = Object.keys(inverters)[0]; 
        const inverterData = inverters[inverterKey];

        soc = inverterData ? inverterData.SOC : 0;
        p_pv = site.P_PV || 0;
        p_load = Math.abs(site.P_Load || 0);
        p_grid = site.P_Grid || 0;
        p_batt = site.P_Akku || 0;
        e_day = site.E_Day || 0;

        if (apiCode === 0) {
            const deviceStatus = inverterData?.StatusCode;
            if (deviceStatus === 7) statusCode = 1; 
            else if (deviceStatus === 8 || deviceStatus === 9) statusCode = 3; 
            else if (deviceStatus >= 10) statusCode = 2; 
            else {
                if (Math.abs(p_pv) < 5 && Math.abs(p_batt) < 10) statusCode = 3;
                else statusCode = 1;
            }
        } else {
            statusCode = 2; 
        }
    } else {
        statusCode = 0; 
    }

    // Notifications Logic
    if (config.notifications?.enabled && config.notifications?.discordWebhook) {
        const nConfig = config.notifications;
        
        // 1. Error Status
        if (nConfig.triggers.errors) {
            if (statusCode === 2 && notifyState.previousStatus !== 2) {
                await sendDiscordNotification(nConfig.discordWebhook, "⚠️ Inverter Error", "The inverter is reporting an error state.", 15158332); 
            }
        }
        notifyState.previousStatus = statusCode;

        // 2. Battery SOC (with Hysteresis to prevent bouncing)
        if (nConfig.triggers.batteryFull) {
            if (soc === 100 && !notifyState.notifiedFull) {
                await sendDiscordNotification(nConfig.discordWebhook, "🔋 Battery Full", "Storage has reached 100% capacity.", 5763719); 
                notifyState.notifiedFull = true;
            } else if (soc < 95) {
                notifyState.notifiedFull = false; // Reset only when dropped below 95%
            }
        }
        
        if (nConfig.triggers.batteryEmpty) {
            if (soc <= 7 && !notifyState.notifiedLow) {
                await sendDiscordNotification(nConfig.discordWebhook, "🪫 Battery Low", `Storage level dropped to ${Math.round(soc)}%.`, 15105570); 
                notifyState.notifiedLow = true;
            } else if (soc > 15) {
                notifyState.notifiedLow = false; // Reset only when charged above 15%
            }
        }
        notifyState.previousSoc = soc;

        // 3. Battery Health (Async Check)
        // Fire and forget, don't await blocking the main loop
        checkBatteryHealthNotification(config, config.batteryCapacity || 10).catch(err => console.error("Health Check Error", err));

        // 4. Smart Advice (Matching Frontend Logic)
        if (nConfig.triggers.smartAdvice && statusCode === 1) {
            const now = Date.now();
            const cooldownMs = (nConfig.smartAdviceCooldownMinutes || 60) * 60 * 1000;
            
            if (now - notifyState.lastSmartAdviceSent > cooldownMs) {
                // --- INTELLIGENT FORECAST LOGIC (Mirrors Frontend) ---
                
                // A) Get Remaining Solar Forecast from Cache
                let forecastRemainingKwh = 0;
                if (solcastCache.data && solcastCache.data.forecasts) {
                    const nowDate = new Date();
                    const currentDay = nowDate.getDate();
                    
                    solcastCache.data.forecasts.forEach(f => {
                        const fDate = new Date(f.period_end);
                        // Sum only future intervals for TODAY
                        if (fDate > nowDate && fDate.getDate() === currentDay) {
                            forecastRemainingKwh += (f.pv_estimate * 0.5); // 30min slots
                        }
                    });
                }

                // B) Calculate Battery Needs
                const batteryCapacity = config.batteryCapacity || 10;
                const socMissingPct = Math.max(0, 100 - soc);
                const kwhToFill = (socMissingPct / 100) * batteryCapacity;

                // C) Calculate "Safe Buffer" (Forecast - Fill Need - 10% Margin)
                const energyBufferKwh = forecastRemainingKwh - (kwhToFill * 1.1);

                // D) Determine if it's safe to divert battery charge
                const isBatterySafe = (energyBufferKwh > 0) || (soc > 95);

                // E) Calculate Total "Smart Surplus"
                const gridExport = p_grid < -10 ? Math.abs(p_grid) : 0;
                const battCharging = p_batt < -10 ? Math.abs(p_batt) : 0;
                
                let totalSurplus = 0;

                if (isBatterySafe) {
                    // Safe: We can use grid export AND steal the battery charging power
                    totalSurplus = gridExport + battCharging;
                } else {
                    // Not Safe: We strictly only use grid export. Leave battery alone.
                    totalSurplus = gridExport;
                }

                // --- APPLIANCE MATCHING ---
                let bestAppliance = null;

                (config.appliances || []).forEach(app => {
                    if (!notifyState.smartAdviceCounters[app.id]) notifyState.smartAdviceCounters[app.id] = 0;
                    
                    // Check if appliance fits in the SMART surplus
                    if (totalSurplus >= app.watts) {
                        notifyState.smartAdviceCounters[app.id]++;
                    } else {
                        notifyState.smartAdviceCounters[app.id] = 0;
                    }

                    // Trigger if condition met for 3 consecutive checks (3 minutes)
                    if (notifyState.smartAdviceCounters[app.id] >= 3) {
                        if (!bestAppliance || app.watts > bestAppliance.watts) bestAppliance = app;
                    }
                });

                if (bestAppliance) {
                    await sendDiscordNotification(
                        nConfig.discordWebhook, 
                        "💡 Smart Suggestion", 
                        `Excess solar power available (${Math.round(totalSurplus)}W). You can run the **${bestAppliance.name}** now for free!`, 
                        3447003, 
                        [
                            { name: "Available Surplus", value: `${Math.round(totalSurplus)} W`, inline: true },
                            { name: "Device Power", value: `${bestAppliance.watts} W`, inline: true },
                            { name: "Strategy", value: isBatterySafe ? "Battery Safe (Diverting Charge)" : "Battery Priority (Grid Only)", inline: false }
                        ]
                    );
                    notifyState.lastSmartAdviceSent = now;
                    notifyState.smartAdviceCounters = {}; 
                }
            }
        }
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
    const CACHE_DURATION = 60 * 60 * 1000; 
    
    if (now - versionCache.lastCheck < CACHE_DURATION) {
        return { version: packageJson.version, ...versionCache.data };
    }

    try {
        const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'Sunflow-Dashboard' },
            timeout: 5000 
        });
        
        const latestTag = response.data?.tag_name; 
        if (latestTag) {
            const releaseUrl = response.data.html_url;
            const cleanLatest = semver.clean(latestTag);
            const current = packageJson.version;
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
        versionCache.lastCheck = now - (CACHE_DURATION - 5 * 60 * 1000);
    }

    return { version: packageJson.version, ...versionCache.data };
};


// --- API ---

app.get('/api/config', (req, res) => res.json(getConfig()));

app.post('/api/config', (req, res) => {
    saveConfig(req.body);
    res.json({ success: true });
});

app.post('/api/test-notification', async (req, res) => {
    const { webhookUrl } = req.body;
    if (!webhookUrl || typeof webhookUrl !== 'string') return res.status(400).json({ error: "Missing or invalid webhook URL" });
    
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
// Cache variable is now defined globally above to be accessible by notification logic

app.get('/api/forecast', async (req, res) => {
    const config = getConfig();
    if (!config.solcastApiKey || !config.solcastSiteId) {
        return res.status(400).json({ error: "Solcast not configured" });
    }

    const now = Date.now();
    const currentHour = new Date().getHours();
    const isDaytime = currentHour >= 5 && currentHour < 21; 
    const CACHE_DURATION = 96 * 60 * 1000;

    // 1. Return fresh cache
    if (solcastCache.data && (now - solcastCache.timestamp < CACHE_DURATION)) {
        return res.json(solcastCache.data);
    }

    // 2. If NIGHT TIME, return stale cache or empty
    if (!isDaytime) {
         if (solcastCache.data) return res.json(solcastCache.data);
         return res.json({ forecasts: [] });
    }

    // 3. Fetch new data
    try {
        const url = `https://api.solcast.com.au/rooftop_sites/${config.solcastSiteId}/forecasts?format=json&api_key=${config.solcastApiKey}`;
        const response = await axios.get(url, { timeout: 8000 });
        
        solcastCache = {
            timestamp: now,
            data: response.data
        };
        res.json(response.data);
    } catch (error) {
        if (error.response && error.response.status === 429) {
            console.error("Solcast Rate Limit Reached (429).");
            return res.status(429).json({ error: "Solcast Rate Limit Reached" });
        }
        console.error("Solcast API Error:", error.message);
        if (solcastCache.data) return res.json(solcastCache.data);
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
    
    // Strict Input Validation
    if (!validFrom || typeof costPerKwh !== 'number' || typeof feedInTariff !== 'number') {
        return res.status(400).json({ error: "Invalid Input Types" });
    }

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
    
    // Strict Input Validation
    if (!name || typeof amount !== 'number' || !date || (type !== 'one_time' && type !== 'yearly')) {
        return res.status(400).json({ error: "Invalid Input Types" });
    }

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
        
        let batState = 'idle';
        if (site.P_Akku < -10) batState = 'charging';
        else if (site.P_Akku > 10) batState = 'discharging';
        
        responseData.battery = {
            soc: soc,
            state: batState
        };
        responseData.energy.today.production = (site.E_Day || 0) / 1000;
        
        responseData.autonomy = Math.round(site.rel_Autonomy || 0);
        responseData.selfConsumption = Math.round(site.rel_SelfConsumption || 0);
    }
    res.json(responseData);
});

// BATTERY HEALTH
app.get('/api/battery-health', (req, res) => {
    const query = `
        SELECT
            strftime('%Y-%m-%d', timestamp) as date,
            SUM(CASE WHEN power_battery < -10 THEN ABS(power_battery) ELSE 0 END) as total_charge_w,
            SUM(CASE WHEN power_battery > 10 THEN power_battery ELSE 0 END) as total_discharge_w,
            MIN(soc) as min_soc,
            MAX(soc) as max_soc,
            COUNT(*) as samples
        FROM energy_log
        WHERE power_battery != 0
        GROUP BY date
        ORDER BY date ASC
    `;

    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        let totalCycles = 0;
        let weightedEffSum = 0;
        let totalEffSamples = 0;
        let latestCapacity = 0;

        const dataPoints = rows.map(r => {
            // Normalize: We log roughly every minute. 
            // W -> kWh:  (Watts / 60min) / 1000
            // But if samples are erratic, we should divide by samples/hours. 
            // Simplified approximation: Assuming 1 min interval average power.
            const chargedKwh = (r.total_charge_w / 60) / 1000;
            const dischargedKwh = (r.total_discharge_w / 60) / 1000;

            let efficiency = 0;
            if (chargedKwh > 0.5) { // Filter out low usage days
                efficiency = (dischargedKwh / chargedKwh) * 100;
                // Cap efficiency at 99% to hide measurement noise
                if (efficiency > 99) efficiency = 99;
                
                weightedEffSum += efficiency;
                totalEffSamples++;
            }

            // Estimate Capacity based on large charge cycles
            // If battery went from 10% to 90% (80% delta) and took 8kWh, then 100% = 10kWh.
            const socDelta = r.max_soc - r.min_soc;
            let estCapacity = 0;
            
            // Only calculate if we saw a significant swing (e.g. > 50%) to ensure accuracy
            if (socDelta > 50 && chargedKwh > 1) {
                estCapacity = (chargedKwh / socDelta) * 100;
                latestCapacity = estCapacity;
            }

            // Approx Cycles
            const cycles = (chargedKwh + dischargedKwh) / 2 / 10; // Assuming 10kWh roughly, refined later
            totalCycles += cycles;

            return {
                date: r.date,
                efficiency: parseFloat(efficiency.toFixed(1)),
                estimatedCapacity: parseFloat(estCapacity.toFixed(2)),
                chargeCycles: parseFloat(cycles.toFixed(2))
            };
        });

        res.json({
            dataPoints,
            averageEfficiency: totalEffSamples > 0 ? parseFloat((weightedEffSum / totalEffSamples).toFixed(1)) : 0,
            latestCapacityEst: parseFloat(latestCapacity.toFixed(2)),
            totalCycles: Math.round(totalCycles)
        });
    });
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

/**
 * Automatically recalculates "Initial Values" (Calibration) based on all summary data in energy_data.
 * This is called after every CSV import to ensure the ROI calculation matches the imported history.
 */
const updateCalibrationFromDatabase = (callback) => {
    const config = getConfig();
    db.all("SELECT * FROM tariffs ORDER BY valid_from ASC", [], (err, tariffRows) => {
        if (err) return callback?.(err);
        
        const tariffs = tariffRows.map(t => ({
            validFrom: t.valid_from,
            costPerKwh: t.cost_per_kwh,
            feedInTariff: t.feed_in_tariff
        }));

        // Use a UNION approach to ensure we capture all data (Summaries + Real-time)
        const query = `
            WITH all_ts AS (
                SELECT timestamp FROM energy_log
                UNION
                SELECT timestamp FROM energy_data
            )
            SELECT 
                t.timestamp,
                l.power_pv, l.power_load, l.power_grid,
                d.grid_consumption_wh, d.grid_feed_in_wh, d.production_wh, d.load_wh
            FROM all_ts t
            LEFT JOIN energy_log l ON t.timestamp = l.timestamp
            LEFT JOIN energy_data d ON t.timestamp = d.timestamp
            ORDER BY t.timestamp ASC
        `;

        db.all(query, [], (err, rows) => {
            if (err) return callback?.(err);
            
            let totalProd = 0;
            let totalImp = 0;
            let totalExp = 0;
            let totalReturn = 0;

            rows.forEach((r, idx) => {
                let prod, imp, exp, cons;

                // Priority for Summary Data (energy_data)
                if (r.production_wh !== null && r.production_wh !== undefined) {
                    prod = (r.production_wh || 0) / 1000;
                    imp = (r.grid_consumption_wh || 0) / 1000;
                    exp = (r.grid_feed_in_wh || 0) / 1000;
                    cons = (r.load_wh || 0) / 1000;
                } else {
                    // Fallback to Power Integration (energy_log)
                    let durationHours = 1/60; 
                    if (idx < rows.length - 1) {
                        const current = new Date(r.timestamp);
                        const next = new Date(rows[idx+1].timestamp);
                        const diffMs = next.getTime() - current.getTime();
                        if (diffMs > 60000) durationHours = diffMs / (1000 * 60 * 60);
                        if (durationHours > 24) durationHours = 1/60;
                    }

                    prod = (r.power_pv || 0) * durationHours / 1000;
                    if (r.power_grid > 0) {
                        imp = (r.power_grid) * durationHours / 1000;
                        exp = 0;
                    } else {
                        imp = 0;
                        exp = Math.abs(r.power_grid) * durationHours / 1000;
                    }
                    cons = (r.power_load || 0) * durationHours / 1000;
                }
                
                totalProd += prod;
                totalImp += imp;
                totalExp += exp;

                const tariff = getTariffForTime(tariffs, r.timestamp);
                const selfCons = Math.max(0, cons - imp);
                totalReturn += (selfCons * tariff.costPerKwh) + (exp * tariff.feedInTariff);
            });

            // We store the DB-calculated sums separately so the UI can combine them with manual offsets.
            config.dbTotals = {
                production: Math.round(totalProd),
                import: Math.round(totalImp),
                export: Math.round(totalExp),
                financialReturn: Math.round(totalReturn * 100) / 100
            };

            saveConfig(config);
            callback?.(null);
        });
    });
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

            const query = `
                WITH all_ts AS (
                    SELECT timestamp FROM energy_log
                    UNION
                    SELECT timestamp FROM energy_data
                )
                SELECT 
                    t.timestamp,
                    l.power_pv, l.power_load, l.power_grid,
                    d.grid_consumption_wh, d.grid_feed_in_wh, d.production_wh, d.load_wh
                FROM all_ts t
                LEFT JOIN energy_log l ON t.timestamp = l.timestamp
                LEFT JOIN energy_data d ON t.timestamp = d.timestamp
                ORDER BY t.timestamp ASC
            `;
            
            db.all(query, [], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                
                let dbReturned = 0;
                let totalDbSelfConsumedKwh = 0;
                let totalDbExportedKwh = 0;
                let totalDbDays = 0;

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

                rows.forEach((r, idx) => {
                    const tsDate = new Date(r.timestamp);
                    const tariff = getTariffForTime(tariffList, r.timestamp);
                    
                    let cons, imp, exp;

                    if (r.production_wh !== null && r.production_wh !== undefined) {
                        cons = (r.load_wh || 0) / 1000;
                        imp = (r.grid_consumption_wh || 0) / 1000;
                        exp = (r.grid_feed_in_wh || 0) / 1000;
                    } else {
                        let durationHours = 1/60; 
                        if (idx < rows.length - 1) {
                            const current = new Date(r.timestamp);
                            const next = new Date(rows[idx+1].timestamp);
                            const diffMs = next.getTime() - current.getTime();
                            if (diffMs > 60000) durationHours = diffMs / (1000 * 60 * 60);
                            if (durationHours > 24) durationHours = 1/60;
                        }

                        cons = (r.power_load || 0) * durationHours / 1000;
                        if (r.power_grid > 0) {
                            imp = (r.power_grid) * durationHours / 1000;
                            exp = 0;
                        } else {
                            imp = 0;
                            exp = Math.abs(r.power_grid) * durationHours / 1000;
                        }
                    }

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

/**
 * NEW: Simulation Data Endpoint
 * Returns hourly aggregated data for efficient client-side simulation
 */
app.get('/api/simulation-data', (req, res) => {
    // We combine high-resolution logs and low-resolution energy summaries.
    // Grouping by hour is the common denominator for battery simulation.
    // We remove the 1-year limit from the subqueries to allow the planner 
    // to analyze the full available history.
    const query = `
        SELECT 
            ts,
            AVG(pv) as p_pv,
            AVG(load) as p_load
        FROM (
            SELECT strftime('%Y-%m-%d %H:00:00', timestamp) as ts, power_pv as pv, power_load as load FROM energy_log
            UNION ALL
            SELECT strftime('%Y-%m-%d %H:00:00', timestamp) as ts, production_wh as pv, load_wh as load FROM energy_data
        )
        WHERE pv IS NOT NULL AND load IS NOT NULL
        GROUP BY ts
        ORDER BY ts ASC
    `;

    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const optimized = rows.map(r => ({
            t: new Date(r.ts).getTime(),
            p: Math.round(r.p_pv),
            l: Math.round(r.p_load)
        }));
        res.json(optimized);
    });
});

// HISTORY
app.get('/api/history', (req, res) => {
    const range = req.query.range || 'day'; 
    const startDate = req.query.start; 
    const endDate = req.query.end;     
    let queryTimeClause = "";
    let groupBy = 1; 

    // Variable declaration for boundary checks
    let start, end;

    if (range === 'custom' && startDate && endDate) {
        start = new Date(startDate);
        start.setHours(0,0,0,0);
        end = new Date(endDate);
        end.setDate(end.getDate() + 1);
        end.setHours(0,0,0,0);
    } else {
        const now = new Date();
        const offset = parseInt(req.query.offset) || 0;

        const getStartOfWeek = (d) => {
             const date = new Date(d);
             const day = date.getDay();
             const diff = date.getDate() - day + (day === 0 ? -6 : 1);
             date.setDate(diff);
             date.setHours(0,0,0,0);
             return date;
        };

        switch(range) {
            case 'hour':
                const startHour = new Date(now);
                startHour.setHours(startHour.getHours() + offset);
                startHour.setMinutes(0, 0, 0);
                start = startHour;
                end = new Date(startHour);
                end.setHours(end.getHours() + 1);
                groupBy = 1; 
                break;
            case 'day': 
                const startDay = new Date(now);
                startDay.setDate(startDay.getDate() + offset);
                startDay.setHours(0, 0, 0, 0);
                start = startDay;
                end = new Date(startDay);
                end.setDate(end.getDate() + 1);
                groupBy = 1; 
                break;
            case 'week': 
                const refDate = new Date(now);
                refDate.setDate(refDate.getDate() + (offset * 7));
                start = getStartOfWeek(refDate);
                end = new Date(start);
                end.setDate(end.getDate() + 7);
                groupBy = 5; 
                break;
            case 'month': 
                start = new Date(now.getFullYear(), now.getMonth() + offset, 1, 0, 0, 0);
                end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1, 0, 0, 0);
                groupBy = 30; 
                break;
            case 'year': 
                start = new Date(now.getFullYear() + offset, 0, 1, 0, 0, 0);
                end = new Date(now.getFullYear() + offset + 1, 0, 1, 0, 0, 0); 
                groupBy = 1440; 
                break;
            default: 
                start = new Date(now);
                start.setHours(0, 0, 0, 0);
                end = new Date(start);
                end.setDate(end.getDate() + 1);
                groupBy = 1;
        }
    }

    if (start && end) {
         queryTimeClause = `timestamp >= '${getLocalTimestamp(start)}' AND timestamp < '${getLocalTimestamp(end)}'`;
    }

    db.all("SELECT * FROM tariffs ORDER BY valid_from ASC", [], (err, tariffRows) => {
        if (err) return res.status(500).json({ error: err.message });
        const tariffs = tariffRows.map(t => ({ validFrom: t.valid_from, costPerKwh: t.cost_per_kwh, feedInTariff: t.feed_in_tariff }));
        
        const query = `
            SELECT 
                l.timestamp, l.power_pv, l.power_load, l.power_grid, l.power_battery, l.soc, l.status_code,
                d.grid_consumption_wh, d.grid_feed_in_wh, d.battery_charge_wh, d.battery_discharge_wh, d.production_wh, d.load_wh
            FROM energy_log l
            LEFT JOIN energy_data d ON l.timestamp = d.timestamp
            WHERE ${queryTimeClause.replace(/timestamp/g, "l.timestamp")} 
            ORDER BY l.timestamp ASC
        `;

        db.all(query, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            
            let stats = { production: 0, consumption: 0, imported: 0, exported: 0, batteryCharged: 0, batteryDischarged: 0, autonomy: 0, selfConsumption: 0, costSaved: 0, earnings: 0 };

            // Robust Date Comparison
            const startMs = start.getTime();
            const endMs = end.getTime();

            rows.forEach((r, idx) => {
                const rowDate = new Date(r.timestamp);
                const rowMs = rowDate.getTime();
                
                // Strict boundary check (prevents next year/month leaking into stats)
                if (rowMs < startMs || rowMs >= endMs) return;

                const tariff = getTariffForTime(tariffs, r.timestamp);
                
                // If we have gross energy data from energy_data (CSV import), use it directly
                let prod, cons, imp, exp, b_c, b_d;

                if (r.grid_consumption_wh !== null && r.grid_consumption_wh !== undefined) {
                    // Data exists in energy_data table (Hourly Wh)
                    prod = (r.production_wh || 0) / 1000;
                    cons = (r.load_wh || 0) / 1000;
                    imp = (r.grid_consumption_wh || 0) / 1000;
                    exp = (r.grid_feed_in_wh || 0) / 1000;
                    b_c = (r.battery_charge_wh || 0) / 1000;
                    b_d = (r.battery_discharge_wh || 0) / 1000;
                } else {
                    // Real-time data from energy_log (Watts) - Calculate as net
                    let durationHours = 1/60; 
                    if (idx < rows.length - 1) {
                        const current = new Date(r.timestamp);
                        const next = new Date(rows[idx+1].timestamp);
                        const diffMs = next.getTime() - current.getTime();
                        if (diffMs > 60000) durationHours = diffMs / (1000 * 60 * 60);
                        if (durationHours > 24) durationHours = 1/60;
                    }

                    prod = (r.power_pv || 0) * durationHours / 1000;
                    cons = (r.power_load || 0) * durationHours / 1000;
                    if (r.power_grid > 0) {
                        imp = (r.power_grid) * durationHours / 1000;
                        exp = 0;
                    } else {
                        imp = 0;
                        exp = Math.abs(r.power_grid) * durationHours / 1000;
                    }
                    if (r.power_battery > 0) {
                        b_d = (r.power_battery) * durationHours / 1000;
                        b_c = 0;
                    } else {
                        b_d = 0;
                        b_c = Math.abs(r.power_battery) * durationHours / 1000;
                    }
                }

                stats.production += prod; 
                stats.consumption += cons; 
                stats.imported += imp; 
                stats.exported += exp;
                stats.batteryCharged += b_c;
                stats.batteryDischarged += b_d;

                const selfPoweredKwh = Math.max(0, cons - imp);
                stats.costSaved += selfPoweredKwh * tariff.costPerKwh;
                stats.earnings += exp * tariff.feedInTariff;
            });

            const totalSelfPowered = Math.max(0, stats.consumption - stats.imported);
            stats.autonomy = stats.consumption > 0 ? (totalSelfPowered / stats.consumption) * 100 : 0;
            stats.selfConsumption = stats.production > 0 ? (totalSelfPowered / stats.production) * 100 : 0;

            const chartData = [];
            
            if (range === 'year' || range === 'month' || range === 'week') {
                // AGGREGATED VIEW (Bars)
                // range='year' -> aggregate by month
                // range='month'/'week' -> aggregate by day
                const groups = {};
                
                rows.forEach((r, idx) => {
                    const rowDate = new Date(r.timestamp);
                    const rowMs = rowDate.getTime();
                    
                    // Strict boundary check to avoid "leaking" next year/month points into chart
                    if (rowMs < startMs || rowMs >= endMs) return;

                    let key = "";
                    if (range === 'year') {
                         key = `${rowDate.getFullYear()}-${String(rowDate.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;
                    } else {
                         key = `${rowDate.getFullYear()}-${String(rowDate.getMonth() + 1).padStart(2, '0')}-${String(rowDate.getDate()).padStart(2, '0')} 00:00:00`;
                    }

                    if (!groups[key]) groups[key] = { p: 0, c: 0, g_in: 0, g_out: 0, b_c: 0, b_d: 0, socTotal: 0, count: 0 };
                    
                    let p, c, i, e, bc, bd, s;
                    if (r.grid_consumption_wh !== null && r.grid_consumption_wh !== undefined) {
                        p = r.production_wh || 0;
                        c = r.load_wh || 0;
                        i = r.grid_consumption_wh || 0;
                        e = r.grid_feed_in_wh || 0;
                        bc = r.battery_charge_wh || 0;
                        bd = r.battery_discharge_wh || 0;
                        s = r.soc || 0;
                    } else {
                        let durationHours = 1/60; 
                        if (idx < rows.length - 1) {
                            const current = new Date(r.timestamp);
                            const next = new Date(rows[idx+1].timestamp);
                            const diffMs = next.getTime() - current.getTime();
                            if (diffMs > 60000) durationHours = diffMs / (1000 * 60 * 60);
                            if (durationHours > 24) durationHours = 1/60;
                        }
                        p = (r.power_pv || 0) * durationHours;
                        c = (r.power_load || 0) * durationHours;
                        i = r.power_grid > 0 ? r.power_grid * durationHours : 0;
                        e = r.power_grid < 0 ? Math.abs(r.power_grid) * durationHours : 0;
                        bd = r.power_battery > 0 ? r.power_battery * durationHours : 0;
                        bc = r.power_battery < 0 ? Math.abs(r.power_battery) * durationHours : 0;
                        s = r.soc || 0;
                    }

                    groups[key].p += p;
                    groups[key].c += c;
                    groups[key].g_in += i;
                    groups[key].g_out += e;
                    groups[key].b_c += bc;
                    groups[key].b_d += bd;
                    groups[key].socTotal += s;
                    groups[key].count++;
                });

                Object.keys(groups).sort().forEach(key => {
                    const g = groups[key];
                    const n = g.count || 1;
                    chartData.push({
                        timestamp: key,
                        production: Math.round(g.p / 10) / 100, // Wh to kWh rounded to 2 decimals
                        consumption: Math.round(g.c / 10) / 100,
                        grid: Math.round((g.g_in - g.g_out) / 10) / 100,
                        battery: Math.round((g.b_d - g.b_c) / 10) / 100,
                        soc: Math.round(g.socTotal / n),
                        autonomy: g.c > 0 ? Math.round(Math.max(0, g.c - g.g_in) / g.c * 100) : 0,
                        selfConsumption: g.p > 0 ? Math.round(Math.max(0, g.p - g.g_out) / g.p * 100) : 0,
                        is_aggregated: true // Flag for frontend
                    });
                });

            } else {
                // HIGH RESOLUTION VIEW (Area)
                const targetPoints = 400;
                const adaptiveGroupBy = rows.length > targetPoints ? Math.ceil(rows.length / targetPoints) : 1;

                for (let i = 0; i < rows.length; i += adaptiveGroupBy) {
                    let chunkPv = 0, chunkCons = 0, chunkGrid = 0, chunkBatt = 0, chunkSoc = 0;
                    let chunkAutonomy = 0, chunkSelfCon = 0;
                    let count = 0;
                    const startTime = rows[i].timestamp;
                    const status = rows[i].status_code !== undefined ? rows[i].status_code : 1;

                    for (let j = 0; j < adaptiveGroupBy && (i + j) < rows.length; j++) {
                        const r = rows[i + j];
                        // If power is 0 but energy is present (CSV import), use Energy Wh as average Power W
                        const pPv = (r.power_pv || 0) || (r.production_wh || 0);
                        const pLoad = (r.power_load || 0) || (r.load_wh || 0);
                        const pGrid = (r.power_grid || 0) || ((r.grid_consumption_wh || 0) - (r.grid_feed_in_wh || 0));
                        const pBatt = (r.power_battery || 0) || ((r.battery_discharge_wh || 0) - (r.battery_charge_wh || 0));

                        chunkPv += pPv;
                        chunkCons += pLoad;
                        chunkGrid += pGrid;
                        chunkBatt += pBatt;
                        chunkSoc += r.soc || 0;

                        let pImp = pGrid > 0 ? pGrid : 0;
                        let pExp = pGrid < 0 ? Math.abs(pGrid) : 0;
                        
                        let ptAuto = (pLoad > 0) ? ((pLoad - pImp) / pLoad) * 100 : 0;
                        if (ptAuto < 0) ptAuto = 0;
                        let ptSelf = (pPv > 0) ? ((pPv - pExp) / pPv) * 100 : 0;
                        
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
            }
            
            res.json({ chart: chartData, stats });
        });
    });
});

app.get('/api/energy', (req, res) => {
    const { start, end } = req.query;
    
    // Determine table: energy_log for day/week, energy_data for month/year
    let query = `
        SELECT 
            timestamp, 
            power_pv as production,
            power_load as consumption,
            power_grid as grid,
            power_battery as battery
        FROM energy_log
    `;
    let params = [];

    if (start && end) {
        const startTime = new Date(start);
        const endTime = new Date(end);
        const diffDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);

        if (diffDays > 62) {
            query = `
                SELECT 
                    timestamp, 
                    production_wh as production, 
                    load_wh as consumption,
                    (grid_consumption_wh - grid_feed_in_wh) as grid,
                    (battery_discharge_wh - battery_charge_wh) as battery
                FROM energy_data
                WHERE timestamp BETWEEN ? AND ?
                ORDER BY timestamp ASC
            `;
            params = [start, end];

            db.all(query, params, (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });

                const monthlyData = {};
                rows.forEach(row => {
                    const month = row.timestamp.substring(0, 7);
                    if (!monthlyData[month]) {
                        monthlyData[month] = { p: 0, c: 0, g: 0, b: 0, count: 0 };
                    }
                    monthlyData[month].p += row.production;
                    monthlyData[month].c += row.consumption;
                    monthlyData[month].g += row.grid;
                    monthlyData[month].b += row.battery;
                    monthlyData[month].count++;
                });

                const aggregatedRows = Object.keys(monthlyData).map(month => {
                    const d = monthlyData[month];
                    const n = d.count || 1;
                    return {
                        timestamp: `${month}-01 00:00:00`,
                        production: d.p / n,
                        consumption: d.c / n,
                        grid: d.g / n,
                        battery: d.b / n
                    };
                });
                return res.json(aggregatedRows);
            });
            return;
        }

        query = `
            SELECT 
                timestamp, 
                power_pv as production,
                power_load as consumption,
                power_grid as grid,
                power_battery as battery
            FROM energy_log
            WHERE timestamp BETWEEN ? AND ?
            ORDER BY timestamp ASC
        `;
        params = [start, end];
    } else {
        query += ` ORDER BY timestamp DESC LIMIT 288`; 
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!start) rows.reverse();
        res.json(rows);
    });
});

/**
 * IMPORT CSV API
 * Handles file upload and parses CSV data into the database
 */
app.post('/api/import-csv', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const mapping = JSON.parse(req.body.mapping || '{}');
    const filePath = req.file.path;
    const fileContent = fs.readFileSync(filePath, 'utf8');

    Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
             const rows = results.data;
             if (rows.length === 0) {
                 if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                 return res.json({ success: true, imported: 0 });
             }

             // Sort rows by date to find min/max
             const dateRows = rows.map(r => ({ ...r, _d: new Date(r[mapping.timestamp]) }))
                                 .filter(r => !isNaN(r._d.getTime()));
                                 
             if (dateRows.length === 0) {
                 if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                 return res.json({ success: true, imported: 0 });
             }

             const minD = new Date(Math.min(...dateRows.map(r => r._d)));
             const maxD = new Date(Math.max(...dateRows.map(r => r._d)));

             // Robust check: Is this a summary import (energy values) or live log import (power values)?
             const isEnergyMapping = mapping.energy_pv !== undefined || 
                                     mapping.energy_production !== undefined || 
                                     mapping.energy_load !== undefined ||
                                     mapping.production_wh !== undefined;

             db.serialize(() => {
                 db.run("BEGIN TRANSACTION");
                 
                 if (isEnergyMapping) {
                     // Summary Delete: Wipe the ENTIRE year(s) to prevent mixed data and double counting.
                     const startYear = minD.getFullYear();
                     const endYear = maxD.getFullYear();
                     
                     for (let y = startYear; y <= endYear; y++) {
                         // We use strings for SQLite timestamp comparison
                         const yearStart = `${y}-01-01 00:00:00`;
                         const nextYearStart = `${y+1}-01-01 00:00:00`;
                         db.run("DELETE FROM energy_log WHERE timestamp >= ? AND timestamp < ?", [yearStart, nextYearStart]);
                         db.run("DELETE FROM energy_data WHERE timestamp >= ? AND timestamp < ?", [yearStart, nextYearStart]);
                     }
                 } else {
                     // Standard Delete: Just the range covered by the file
                     const deleteStart = getLocalTimestamp(minD).substring(0, 10) + " 00:00:00";
                     const deleteEnd = getLocalTimestamp(maxD).substring(0, 10) + " 23:59:59";
                     db.run("DELETE FROM energy_log WHERE timestamp BETWEEN ? AND ?", [deleteStart, deleteEnd]);
                     db.run("DELETE FROM energy_data WHERE timestamp BETWEEN ? AND ?", [deleteStart, deleteEnd]);
                 }

                 const stmtLog = db.prepare(`INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)`);
                 const stmtData = db.prepare(`INSERT INTO energy_data (timestamp, production_wh, grid_consumption_wh, grid_feed_in_wh, battery_charge_wh, battery_discharge_wh, load_wh) VALUES (?, ?, ?, ?, ?, ?, ?)`);

                 let count = 0;

                 dateRows.forEach(row => {
                     const dbTs = getLocalTimestamp(row._d);
                     const parseVal = (key) => {
                         if (!key || row[key] === undefined) return 0;
                         let valStr = String(row[key]).trim();
                         valStr = valStr.replace(/[^\d.,-]/g, '').replace(',', '.');
                         const val = parseFloat(valStr);
                         return isNaN(val) ? 0 : val;
                     };

                     if (isEnergyMapping) {
                         const e_pv = parseVal(mapping.energy_pv);
                         const e_load = parseVal(mapping.energy_load);
                         const e_grid_in = parseVal(mapping.energy_grid_in);
                         const e_grid_out = parseVal(mapping.energy_grid_out);
                         const e_bat_c = parseVal(mapping.energy_bat_charge);
                         const e_bat_d = parseVal(mapping.energy_bat_discharge);
                         
                         // Fill log with indicator. Since imported energy is usually hourly, Wh = W average for that hour.
                         stmtLog.run(dbTs, e_pv, e_load, e_grid_in - e_grid_out, e_bat_d - e_bat_c, 0, 1); 
                         stmtData.run(dbTs, e_pv, e_grid_in, e_grid_out, e_bat_c, e_bat_d, e_load);
                     } else {
                         const p_pv = parseVal(mapping.power_pv);
                         const p_load = parseVal(mapping.power_load);
                         const p_grid = parseVal(mapping.power_grid);
                         const p_batt = parseVal(mapping.power_battery);
                         const soc = parseVal(mapping.soc);
                         stmtLog.run(dbTs, p_pv, p_load, p_grid, p_batt, soc, 1);
                     }
                     count++;
                 });

                 stmtLog.finalize();
                 stmtData.finalize();
                 
                 db.run("COMMIT", (err) => {
                     if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                     if (err) return res.status(500).json({ error: "Commit failed: " + err.message });
                     
                     // Recalculate calibration values after every successful import
                     updateCalibrationFromDatabase((calibErr) => {
                        if (calibErr) console.error("Auto-calibration failed:", calibErr);
                        res.json({ success: true, imported: count });
                     });
                 });
             });
        },
        error: (err) => {
             if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
             res.status(500).json({ error: "CSV Parsing failed: " + err.message });
        }
    });
});

/**
 * PREVIEW CSV API
 * Returns the headers and first 5 rows to help user map columns
 */
app.post('/api/preview-csv', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    // Parse partial
    Papa.parse(fileContent, {
        header: true,
        preview: 5,
        skipEmptyLines: true,
        complete: (results) => {
            fs.unlinkSync(filePath); // Cleanup temp file immediately
            res.json({ headers: results.meta.fields, preview: results.data });
        },
        error: (err) => {
             fs.unlinkSync(filePath);
             res.status(500).json({ error: err.message });
        }
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`SunFlow Backend running on http://localhost:${PORT}`);
});
