
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

// Robust package.json loading for versioning
let packageJson = { version: "1.3.5" }; 
try {
    const pkgPath = path.join(__dirname, 'package.json');
    if (fs.existsSync(pkgPath)) {
        packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    }
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
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

app.use(cors());

const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 5000,
	standardHeaders: true, 
	legacyHeaders: false, 
});
app.use('/api/', apiLimiter);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

// Database Setup
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) console.error("Error opening database:", err.message);
    else {
        console.log(`Connected to SQLite database at ${DB_FILE}`);
        db.serialize(() => {
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
            
            db.run("ALTER TABLE energy_log ADD COLUMN status_code INTEGER DEFAULT 1", (err) => {
                if (err && !err.message.includes("duplicate column name")) {
                    console.error("Migration error (status_code):", err.message);
                }
            });

            db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON energy_log(timestamp)`);

            db.run(`CREATE TABLE IF NOT EXISTS tariffs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                valid_from DATE NOT NULL,
                cost_per_kwh REAL NOT NULL,
                feed_in_tariff REAL NOT NULL
            )`, () => {
                db.get("SELECT count(*) as count FROM tariffs", (err, row) => {
                    if (row && row.count === 0) {
                        const oldConfig = getConfig();
                        const stmt = db.prepare("INSERT INTO tariffs (valid_from, cost_per_kwh, feed_in_tariff) VALUES (?, ?, ?)");
                        stmt.run("2000-01-01", oldConfig.costPerKwh || 0.30, oldConfig.feedInTariff || 0.08);
                        stmt.finalize();
                    }
                });
            });

            db.run(`CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                amount REAL NOT NULL,
                type TEXT NOT NULL,
                date DATE NOT NULL
            )`);
        });
    }
});

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
    return config;
};

const saveConfig = (cfg) => {
    if (typeof cfg !== 'object') return;
    const current = getConfig();
    const diskConfig = { ...current, ...cfg };
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

const getLocalTimestamp = (date = new Date()) => {
    const timeZone = process.env.TZ || 'Europe/Berlin';
    return date.toLocaleString('sv-SE', { timeZone }).replace('T', ' ');
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
    } catch (e) {
        console.error("Failed to send Discord notification:", e.message);
    }
};

let solcastCache = { timestamp: 0, data: null };
const notifyState = { previousSoc: 0, previousStatus: 1, lastSmartAdviceSent: 0, lastSohCheck: 0 };

setInterval(async () => {
    const config = getConfig();
    if (!config.inverterIp) return;
    const rawData = await fetchFroniusData(config.inverterIp);
    let p_pv = 0, p_load = 0, p_grid = 0, p_batt = 0, soc = 0, e_day = 0;
    let statusCode = 1;

    if (rawData && rawData.Body && rawData.Body.Data) {
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

        // Simple status detection
        const apiCode = rawData.Head?.Status?.Code;
        if (apiCode !== 0) statusCode = 2; // Error
        else if (Math.abs(p_pv) < 5 && Math.abs(p_batt) < 10) statusCode = 3; // Idle
        else statusCode = 1; // Running

        // Notifications
        if (config.notifications?.enabled && config.notifications?.discordWebhook) {
            const nConfig = config.notifications;
            if (nConfig.triggers.errors && statusCode === 2 && notifyState.previousStatus !== 2) {
                await sendDiscordNotification(nConfig.discordWebhook, "⚠️ Inverter Error", "The inverter is reporting an error state.", 15158332); 
            }
            if (nConfig.triggers.batteryFull && soc === 100 && notifyState.previousSoc < 100) {
                await sendDiscordNotification(nConfig.discordWebhook, "🔋 Battery Full", "Storage has reached 100% capacity.", 5763719); 
            }
            if (nConfig.triggers.batteryEmpty && soc <= 7 && notifyState.previousSoc > 7) {
                await sendDiscordNotification(nConfig.discordWebhook, "🪫 Battery Low", `Storage level dropped to ${Math.round(soc)}%.`, 15105570); 
            }
            notifyState.previousSoc = soc;
            notifyState.previousStatus = statusCode;
        }
    }

    const timestamp = getLocalTimestamp();
    const stmt = db.prepare(`INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, energy_day_prod, status_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(timestamp, p_pv, p_load, p_grid, p_batt, soc, e_day, statusCode);
    stmt.finalize();
}, 60 * 1000);

// Info & Versioning
let versionCache = { lastCheck: 0, data: { latestVersion: packageJson.version, updateAvailable: false, releaseUrl: '' } };
const getVersionInfo = async () => {
    const now = Date.now();
    if (now - versionCache.lastCheck < 3600000) return { version: packageJson.version, ...versionCache.data };
    try {
        const response = await axios.get(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`, { headers: { 'User-Agent': 'Sunflow' }, timeout: 5000 });
        const cleanLatest = semver.clean(response.data?.tag_name);
        versionCache = { 
            lastCheck: now, 
            data: { 
                latestVersion: cleanLatest || packageJson.version, 
                updateAvailable: cleanLatest ? semver.gt(cleanLatest, packageJson.version) : false, 
                releaseUrl: response.data.html_url 
            } 
        };
    } catch (e) { 
        versionCache.lastCheck = now - 3300000; 
    }
    return { version: packageJson.version, ...versionCache.data };
};

// --- API ENDPOINTS ---

app.get('/api/config', (req, res) => res.json(getConfig()));
app.post('/api/config', (req, res) => { saveConfig(req.body); res.json({ success: true }); });
app.get('/api/info', async (req, res) => res.json(await getVersionInfo()));

app.post('/api/test-notification', async (req, res) => {
    const { webhookUrl } = req.body;
    await sendDiscordNotification(webhookUrl, "🔔 Test Notification", "SunFlow notifications are working correctly!", 16776960);
    res.json({ success: true });
});

app.get('/api/forecast', async (req, res) => {
    const config = getConfig();
    if (!config.solcastApiKey || !config.solcastSiteId) return res.status(400).json({ error: "Solcast not configured" });
    if (solcastCache.data && (Date.now() - solcastCache.timestamp < 3600000)) return res.json(solcastCache.data);
    try {
        const response = await axios.get(`https://api.solcast.com.au/rooftop_sites/${config.solcastSiteId}/forecasts?format=json&api_key=${config.solcastApiKey}`, { timeout: 8000 });
        solcastCache = { timestamp: Date.now(), data: response.data };
        res.json(response.data);
    } catch (e) { res.status(502).json({ error: "Solcast Failed" }); }
});

app.get('/api/tariffs', (req, res) => {
    db.all("SELECT id, valid_from as validFrom, cost_per_kwh as costPerKwh, feed_in_tariff as feedInTariff FROM tariffs ORDER BY valid_from ASC", (err, rows) => res.json(rows || []));
});
app.post('/api/tariffs', (req, res) => {
    const { validFrom, costPerKwh, feedInTariff } = req.body;
    const stmt = db.prepare("INSERT INTO tariffs (valid_from, cost_per_kwh, feed_in_tariff) VALUES (?, ?, ?)");
    stmt.run(validFrom, costPerKwh, feedInTariff, function() { res.json({ id: this.lastID, success: true }); });
});
app.delete('/api/tariffs/:id', (req, res) => db.run("DELETE FROM tariffs WHERE id = ?", req.params.id, () => res.json({ success: true })));

app.get('/api/expenses', (req, res) => {
    db.all("SELECT id, name, amount, type, date FROM expenses ORDER BY date ASC", (err, rows) => res.json(rows || []));
});
app.post('/api/expenses', (req, res) => {
    const { name, amount, type, date } = req.body;
    const stmt = db.prepare("INSERT INTO expenses (name, amount, type, date) VALUES (?, ?, ?, ?)");
    stmt.run(name, amount, type, date, function() { res.json({ id: this.lastID, success: true }); });
});
app.delete('/api/expenses/:id', (req, res) => db.run("DELETE FROM expenses WHERE id = ?", req.params.id, () => res.json({ success: true })));

app.get('/api/data', async (req, res) => {
    const config = getConfig();
    if (!config.inverterIp) return res.status(400).json({ error: "No Inverter IP" });
    const rawData = await fetchFroniusData(config.inverterIp);
    if (!rawData || !rawData.Body || !rawData.Body.Data) return res.status(502).json({ error: "Inverter Offline" });
    const site = rawData.Body.Data.Site;
    const inverters = rawData.Body.Data.Inverters;
    const inverterKey = Object.keys(inverters)[0];
    res.json({
        power: { pv: Math.round(site.P_PV || 0), load: Math.round(Math.abs(site.P_Load || 0)), grid: Math.round(site.P_Grid || 0), battery: Math.round(site.P_Akku || 0) },
        battery: { soc: inverters[inverterKey]?.SOC || 0, state: site.P_Akku < -10 ? 'charging' : site.P_Akku > 10 ? 'discharging' : 'idle' },
        energy: { today: { production: (site.E_Day || 0) / 1000 } },
        autonomy: Math.round(site.rel_Autonomy || 0),
        selfConsumption: Math.round(site.rel_SelfConsumption || 0)
    });
});

app.get('/api/battery-health', (req, res) => {
    db.all("SELECT strftime('%Y-%m-%d', timestamp) as date, SUM(CASE WHEN power_battery < -10 THEN ABS(power_battery) ELSE 0 END) as total_charge_w, SUM(CASE WHEN power_battery > 10 THEN power_battery ELSE 0 END) as total_discharge_w, MIN(soc) as min_soc, MAX(soc) as max_soc FROM energy_log WHERE power_battery != 0 GROUP BY date ORDER BY date ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        let totalCycles = 0, latestCapacity = 0, weightedEffSum = 0, totalEffSamples = 0;
        const dataPoints = (rows || []).map(r => {
            const chargedKwh = (r.total_charge_w / 60) / 1000;
            const dischargedKwh = (r.total_discharge_w / 60) / 1000;
            if (chargedKwh > 0.5) { weightedEffSum += Math.min(99, (dischargedKwh / chargedKwh) * 100); totalEffSamples++; }
            if (r.max_soc - r.min_soc > 50 && chargedKwh > 1) latestCapacity = (chargedKwh / (r.max_soc - r.min_soc)) * 100;
            totalCycles += (chargedKwh + dischargedKwh) / 20;
            return { date: r.date, efficiency: 0, estimatedCapacity: latestCapacity };
        });
        res.json({ dataPoints, averageEfficiency: totalEffSamples > 0 ? weightedEffSum / totalEffSamples : 0, latestCapacityEst: latestCapacity, totalCycles: Math.round(totalCycles) });
    });
});

const getTariffForTime = (tariffs, timestamp) => {
    if (!tariffs || tariffs.length === 0) return { costPerKwh: 0.30, feedInTariff: 0.08 };
    let activeTariff = tariffs[0];
    const datePart = timestamp.substring(0, 10);
    for (const t of tariffs) { if (t.validFrom <= datePart) activeTariff = t; else break; }
    return activeTariff;
};

app.get('/api/roi', (req, res) => {
    const config = getConfig();
    db.all("SELECT * FROM expenses", [], (err, expenses) => {
        db.all("SELECT valid_from as validFrom, cost_per_kwh as costPerKwh, feed_in_tariff as feedInTariff FROM tariffs ORDER BY valid_from ASC", [], (err, tariffs) => {
            db.all("SELECT timestamp, power_load, power_grid FROM energy_log", [], (err, rows) => {
                let dbReturned = 0;
                (rows || []).forEach(r => {
                    const t = getTariffForTime(tariffs, r.timestamp);
                    const imp = r.power_grid > 0 ? r.power_grid / 60000 : 0;
                    const exp = r.power_grid < 0 ? Math.abs(r.power_grid) / 60000 : 0;
                    const self = Math.max(0, (r.power_load / 60000) - imp);
                    dbReturned += (self * t.costPerKwh) + (exp * t.feedInTariff);
                });
                let totalInvested = (expenses || []).reduce((sum, e) => sum + e.amount, 0);
                res.json({ totalInvested, totalReturned: dbReturned + (config.initialValues?.financialReturn || 0), netValue: (dbReturned + (config.initialValues?.financialReturn || 0)) - totalInvested, roiPercent: totalInvested > 0 ? ((dbReturned + (config.initialValues?.financialReturn || 0)) / totalInvested) * 100 : 0, expenses: expenses || [] });
            });
        });
    });
});

app.get('/api/history', (req, res) => {
    const range = req.query.range || 'day'; 
    const offset = parseInt(req.query.offset || '0');
    const now = new Date();
    let startObj = new Date(now);
    let endObj = new Date(now);
    let groupBy = 1;

    switch(range) {
        case 'hour': startObj.setMinutes(0,0,0); startObj.setHours(startObj.getHours() + offset); endObj = new Date(startObj); endObj.setHours(endObj.getHours() + 1); groupBy = 1; break;
        case 'day': startObj.setHours(0,0,0,0); startObj.setDate(startObj.getDate() + offset); endObj = new Date(startObj); endObj.setDate(endObj.getDate() + 1); groupBy = 1; break;
        case 'week': const day = startObj.getDay(); startObj.setDate(startObj.getDate() - day + (day === 0 ? -6 : 1) + (offset * 7)); startObj.setHours(0,0,0,0); endObj = new Date(startObj); endObj.setDate(endObj.getDate() + 7); groupBy = 5; break;
        case 'month': startObj.setDate(1); startObj.setHours(0,0,0,0); startObj.setMonth(startObj.getMonth() + offset); endObj = new Date(startObj); endObj.setMonth(endObj.getMonth() + 1); groupBy = 30; break;
        case 'year': startObj.setMonth(0,1); startObj.setHours(0,0,0,0); startObj.setFullYear(startObj.getFullYear() + offset); endObj = new Date(startObj); endObj.setFullYear(endObj.getFullYear() + 1); groupBy = 1440; break;
    }

    const eLimit = offset === 0 ? getLocalTimestamp(now) : getLocalTimestamp(endObj);
    const queryTime = `timestamp BETWEEN '${getLocalTimestamp(startObj)}' AND '${eLimit}'`;

    db.all("SELECT valid_from as validFrom, cost_per_kwh as costPerKwh, feed_in_tariff as feedInTariff FROM tariffs ORDER BY valid_from ASC", [], (err, tariffs) => {
        db.all(`SELECT * FROM energy_log WHERE ${queryTime} ORDER BY timestamp ASC`, [], (err, rows) => {
            let stats = { production: 0, consumption: 0, imported: 0, exported: 0, costSaved: 0, earnings: 0 };
            (rows || []).forEach(r => {
                const t = getTariffForTime(tariffs, r.timestamp);
                const imp = r.power_grid > 0 ? r.power_grid / 60000 : 0;
                const exp = r.power_grid < 0 ? Math.abs(r.power_grid) / 60000 : 0;
                const self = Math.max(0, (r.power_load / 60000) - imp);
                stats.production += r.power_pv / 60000; stats.consumption += r.power_load / 60000; stats.imported += imp; stats.exported += exp;
                stats.costSaved += self * t.costPerKwh; stats.earnings += exp * t.feedInTariff;
            });
            const chartData = [];
            for (let i = 0; i < (rows || []).length; i += groupBy) {
                let chunk = { p: 0, l: 0, g: 0, b: 0, s: 0, count: 0 };
                for (let j = 0; j < groupBy && (i + j) < rows.length; j++) {
                    const r = rows[i + j]; chunk.p += r.power_pv; chunk.l += r.power_load; chunk.g += r.power_grid; chunk.b += r.power_battery; chunk.s += r.soc; chunk.count++;
                }
                if (chunk.count > 0) chartData.push({ timestamp: rows[i].timestamp, production: chunk.p/chunk.count, consumption: chunk.l/chunk.count, grid: chunk.g/chunk.count, battery: chunk.b/chunk.count, soc: chunk.s/chunk.count });
            }
            res.json({ chart: chartData, stats, windowStart: getLocalTimestamp(startObj), windowEnd: getLocalTimestamp(endObj) });
        });
    });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
app.listen(PORT, () => console.log(`SunFlow Backend on Port ${PORT}`));
