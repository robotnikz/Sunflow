
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

        // 2. Battery SOC
        if (nConfig.triggers.batteryFull) {
            if (soc === 100 && notifyState.previousSoc < 100) {
                await sendDiscordNotification(nConfig.discordWebhook, "🔋 Battery Full", "Storage has reached 100% capacity.", 5763719); 
            }
        }
        if (nConfig.triggers.batteryEmpty) {
            if (soc <= 7 && notifyState.previousSoc > 7) {
                await sendDiscordNotification(nConfig.discordWebhook, "🪫 Battery Low", `Storage level dropped to ${Math.round(soc)}%.`, 15105570); 
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
        if (diffDays <= 2) groupBy = 1;       
        else if (diffDays <= 7) groupBy = 5;  
        else if (diffDays <= 31) groupBy = 30; 
        else groupBy = 1440;                  
    } else {
        const now = new Date();
        switch(range) {
            case 'hour':
                const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
                queryTimeClause = `timestamp >= '${getLocalTimestamp(oneHourAgo)}'`;
                groupBy = 1; 
                break;
            case 'day': 
                const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                queryTimeClause = `timestamp >= '${getLocalTimestamp(yesterday)}'`; 
                groupBy = 1; 
                break;
            case 'week': 
                const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                queryTimeClause = `timestamp >= '${getLocalTimestamp(lastWeek)}'`; 
                groupBy = 5; 
                break;
            case 'month': 
                const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                queryTimeClause = `timestamp >= '${getLocalTimestamp(lastMonth)}'`; 
                groupBy = 30; 
                break;
            case 'year': 
                const lastYear = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                queryTimeClause = `timestamp >= '${getLocalTimestamp(lastYear)}'`; 
                groupBy = 1440; 
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
            
            // AGGREGATION LOGIC (JS-side for complex multi-field averaging)
            // Note: For huge datasets, moving this to SQL GROUP BY is better, but requires complex 'strftime' logic for variable buckets.
            // Current limit (1 year ~ 525k rows) is handled reasonably by Node.js, but optimized SQL is future work.
            for (let i = 0; i < rows.length; i += groupBy) {
                let chunkPv = 0, chunkCons = 0, chunkGrid = 0, chunkBatt = 0, chunkSoc = 0;
                let chunkAutonomy = 0, chunkSelfCon = 0;
                let count = 0;
                const startTime = rows[i].timestamp;
                const status = rows[i].status_code !== undefined ? rows[i].status_code : 1;

                for (let j = 0; j < groupBy && (i + j) < rows.length; j++) {
                    const r = rows[i + j];
                    chunkPv += r.power_pv || 0;
                    chunkCons += r.power_load || 0;
                    chunkGrid += r.power_grid || 0;
                    chunkBatt += r.power_battery || 0;
                    chunkSoc += r.soc || 0;

                    let pImp = r.power_grid > 0 ? r.power_grid : 0;
                    let pExp = r.power_grid < 0 ? Math.abs(r.power_grid) : 0;
                    
                    let ptAuto = r.power_load > 0 ? ((r.power_load - pImp) / r.power_load) * 100 : 0;
                    if (ptAuto < 0) ptAuto = 0;
                    
                    let ptSelf = r.power_pv > 0 ? ((r.power_pv - pExp) / r.power_pv) * 100 : 0;
                    
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
