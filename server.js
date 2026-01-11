
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
        const content = fs.readFileSync(pkgPath, 'utf8');
        packageJson = JSON.parse(content);
    }
} catch (e) {
    console.error("Failed to load package.json:", e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;
const REPO_OWNER = 'robotnikz';
const REPO_NAME = 'Sunflow';

// Data Directory Setup
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)){
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_FILE = path.join(DATA_DIR, 'solar_data.db');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5000, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

// Database Setup
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) console.error("Error opening database:", err.message);
    else {
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS energy_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, power_pv REAL, power_load REAL, power_grid REAL, power_battery REAL, soc REAL, energy_day_prod REAL, status_code INTEGER DEFAULT 1)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON energy_log(timestamp)`);
            db.run(`CREATE TABLE IF NOT EXISTS tariffs (id INTEGER PRIMARY KEY AUTOINCREMENT, valid_from DATE NOT NULL, cost_per_kwh REAL NOT NULL, feed_in_tariff REAL NOT NULL)`);
            db.run(`CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, amount REAL NOT NULL, type TEXT NOT NULL, date DATE NOT NULL)`);
        });
    }
});

const getConfig = () => {
    let config = { inverterIp: '', currency: 'EUR', systemStartDate: new Date().toISOString().split('T')[0] };
    if (fs.existsSync(CONFIG_FILE)) {
        try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) {}
    }
    return config;
};

const saveConfig = (cfg) => {
    const diskConfig = { ...getConfig(), ...cfg };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(diskConfig, null, 2));
};

const getLocalTimestamp = (date = new Date()) => {
    const timeZone = process.env.TZ || 'Europe/Berlin';
    return date.toLocaleString('sv-SE', { timeZone }).replace('T', ' ');
};

const sendDiscordNotification = async (webhookUrl, title, description, color) => {
    if (!webhookUrl?.startsWith('http')) return;
    try {
        await axios.post(webhookUrl, {
            embeds: [{ title, description, color, footer: { text: "SunFlow Gen24" }, timestamp: new Date().toISOString() }]
        });
    } catch (e) {}
};

const notifyState = { previousSoc: 0, previousStatus: 1 };

setInterval(async () => {
    const config = getConfig();
    if (!config.inverterIp) return;
    try {
        const response = await axios.get(`http://${config.inverterIp}/solar_api/v1/GetPowerFlowRealtimeData.fcgi`, { timeout: 3000 });
        const rawData = response.data;
        let p_pv = 0, p_load = 0, p_grid = 0, p_batt = 0, soc = 0, e_day = 0;
        let statusCode = 1;

        if (rawData?.Body?.Data) {
            const site = rawData.Body.Data.Site;
            const invs = rawData.Body.Data.Inverters;
            const invKey = Object.keys(invs)[0];
            const invData = invs[invKey];
            soc = invData?.SOC || 0;
            p_pv = site.P_PV || 0;
            p_load = Math.abs(site.P_Load || 0);
            p_grid = site.P_Grid || 0;
            p_batt = site.P_Akku || 0;
            e_day = site.E_Day || 0;

            // Detaillierte Fronius Status-Auswertung
            const deviceStatus = invData?.StatusCode;
            if (deviceStatus === 7) statusCode = 1; // Running
            else if (deviceStatus === 8 || deviceStatus === 9) statusCode = 3; // Standby / Idle
            else if (deviceStatus >= 10) statusCode = 2; // Error
            else {
                // Fallback falls StatusCode nicht eindeutig
                statusCode = (Math.abs(p_pv) < 10 && Math.abs(p_batt) < 10) ? 3 : 1;
            }

            if (config.notifications?.enabled && config.notifications?.discordWebhook) {
                const n = config.notifications;
                if (n.triggers.errors && statusCode === 2 && notifyState.previousStatus !== 2) await sendDiscordNotification(n.discordWebhook, "⚠️ Inverter Error", "System reported an error.", 15158332);
                if (n.triggers.batteryFull && soc === 100 && notifyState.previousSoc < 100) await sendDiscordNotification(n.discordWebhook, "🔋 Battery Full", "Storage reached 100%.", 5763719);
                notifyState.previousSoc = soc;
                notifyState.previousStatus = statusCode;
            }
        }
        db.run(`INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, energy_day_prod, status_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
               [getLocalTimestamp(), p_pv, p_load, p_grid, p_batt, soc, e_day, statusCode]);
    } catch (e) {}
}, 60 * 1000);

app.get('/api/config', (req, res) => res.json(getConfig()));
app.post('/api/config', (req, res) => { saveConfig(req.body); res.json({ success: true }); });

app.get('/api/info', async (req, res) => {
    try {
        const response = await axios.get(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`, { headers: { 'User-Agent': 'Sunflow' }, timeout: 5000 });
        const latest = semver.clean(response.data?.tag_name) || packageJson.version;
        res.json({ 
            version: packageJson.version, 
            latestVersion: latest, 
            updateAvailable: semver.gt(latest, packageJson.version), 
            releaseUrl: response.data.html_url 
        });
    } catch (e) { 
        res.json({ version: packageJson.version, latestVersion: packageJson.version, updateAvailable: false }); 
    }
});

app.get('/api/tariffs', (req, res) => db.all("SELECT id, valid_from as validFrom, cost_per_kwh as costPerKwh, feed_in_tariff as feedInTariff FROM tariffs ORDER BY valid_from ASC", (err, rows) => res.json(rows || [])));
app.post('/api/tariffs', (req, res) => {
    const { validFrom, costPerKwh, feedInTariff } = req.body;
    db.run("INSERT INTO tariffs (valid_from, cost_per_kwh, feed_in_tariff) VALUES (?, ?, ?)", [validFrom, costPerKwh, feedInTariff], function() { res.json({ id: this.lastID, success: true }); });
});
app.delete('/api/tariffs/:id', (req, res) => db.run("DELETE FROM tariffs WHERE id = ?", req.params.id, () => res.json({ success: true })));

app.get('/api/expenses', (req, res) => db.all("SELECT id, name, amount, type, date FROM expenses ORDER BY date ASC", (err, rows) => res.json(rows || [])));
app.post('/api/expenses', (req, res) => {
    const { name, amount, type, date } = req.body;
    db.run("INSERT INTO expenses (name, amount, type, date) VALUES (?, ?, ?, ?)", [name, amount, type, date], function() { res.json({ id: this.lastID, success: true }); });
});
app.delete('/api/expenses/:id', (req, res) => db.run("DELETE FROM expenses WHERE id = ?", req.params.id, () => res.json({ success: true })));

app.get('/api/data', async (req, res) => {
    const config = getConfig();
    try {
        const response = await axios.get(`http://${config.inverterIp}/solar_api/v1/GetPowerFlowRealtimeData.fcgi`, { timeout: 3000 });
        const rawData = response.data;
        if (!rawData?.Body?.Data) return res.status(502).json({ error: "No Inverter Data" });
        const site = rawData.Body.Data.Site;
        const invs = rawData.Body.Data.Inverters;
        const invKey = Object.keys(invs)[0];
        res.json({
            power: { pv: Math.round(site.P_PV || 0), load: Math.round(Math.abs(site.P_Load || 0)), grid: Math.round(site.P_Grid || 0), battery: Math.round(site.P_Akku || 0) },
            battery: { soc: invs[invKey]?.SOC || 0, state: site.P_Akku < -10 ? 'charging' : site.P_Akku > 10 ? 'discharging' : 'idle' },
            energy: { today: { production: (site.E_Day || 0) / 1000 } },
            autonomy: Math.round(site.rel_Autonomy || 0),
            selfConsumption: Math.round(site.rel_SelfConsumption || 0)
        });
    } catch(e) { res.status(502).json({ error: "Inverter Offline" }); }
});

const getTariffForTime = (tariffs, ts) => {
    if (!tariffs?.length) return { costPerKwh: 0.3, feedInTariff: 0.08 };
    let active = tariffs[0];
    const d = ts.substring(0, 10);
    for (const t of tariffs) { if (t.validFrom <= d) active = t; else break; }
    return active;
};

app.get('/api/roi', (req, res) => {
    const config = getConfig();
    db.all("SELECT * FROM expenses", (err, expenses) => {
        db.all("SELECT valid_from as validFrom, cost_per_kwh as costPerKwh, feed_in_tariff as feedInTariff FROM tariffs ORDER BY valid_from ASC", (err, tariffs) => {
            db.all("SELECT timestamp, power_load, power_grid FROM energy_log", (err, rows) => {
                let totalReturned = config.initialValues?.financialReturn || 0;
                let dailyReturns = new Map();
                
                (rows || []).forEach(r => {
                    const t = getTariffForTime(tariffs, r.timestamp);
                    const imp = r.power_grid > 0 ? r.power_grid / 60000 : 0;
                    const exp = r.power_grid < 0 ? Math.abs(r.power_grid) / 60000 : 0;
                    const self = Math.max(0, (r.power_load / 60000) - imp);
                    const gain = (self * t.costPerKwh) + (exp * t.feedInTariff);
                    totalReturned += gain;
                    
                    const day = r.timestamp.substring(0, 10);
                    dailyReturns.set(day, (dailyReturns.get(day) || 0) + gain);
                });

                let totalInvested = (expenses || []).reduce((s, e) => s + e.amount, 0);
                
                // Berechnung des durchschnittlichen täglichen Ertrags für die Forecast
                let avgDailyReturn = 0;
                if (dailyReturns.size > 0) {
                    let totalNewReturns = 0;
                    dailyReturns.forEach(v => totalNewReturns += v);
                    avgDailyReturn = totalNewReturns / dailyReturns.size;
                }

                let breakEvenDate = null;
                if (avgDailyReturn > 0.01 && totalReturned < totalInvested) {
                    const remainingAmount = totalInvested - totalReturned;
                    const daysToBreakEven = remainingAmount / avgDailyReturn;
                    const targetDate = new Date();
                    targetDate.setDate(targetDate.getDate() + Math.ceil(daysToBreakEven));
                    breakEvenDate = targetDate.toISOString().split('T')[0];
                }

                res.json({ totalInvested, totalReturned, netValue: totalReturned - totalInvested, roiPercent: totalInvested > 0 ? (totalReturned / totalInvested) * 100 : 0, breakEvenDate, expenses: expenses || [] });
            });
        });
    });
});

app.get('/api/battery-health', (req, res) => {
    db.all("SELECT strftime('%Y-%m-%d', timestamp) as date, SUM(CASE WHEN power_battery < -10 THEN ABS(power_battery) ELSE 0 END) as total_charge_w, SUM(CASE WHEN power_battery > 10 THEN power_battery ELSE 0 END) as total_discharge_w, MIN(soc) as min_soc, MAX(soc) as max_soc FROM energy_log WHERE power_battery != 0 GROUP BY date ORDER BY date ASC", [], (err, rows) => {
        let cycles = 0, latestCap = 0, effSum = 0, effCount = 0;
        const dataPoints = (rows || []).map(r => {
            const ch = (r.total_charge_w / 60) / 1000;
            const dis = (r.total_discharge_w / 60) / 1000;
            if (ch > 0.5) { effSum += Math.min(99.9, (dis / ch) * 100); effCount++; }
            if (r.max_soc - r.min_soc > 50 && ch > 1) latestCap = (ch / (r.max_soc - r.min_soc)) * 100;
            cycles += (ch + dis) / 20;
            return { date: r.date, efficiency: ch > 0.1 ? Math.min(99.9, (dis/ch)*100) : 0, estimatedCapacity: latestCap };
        });
        res.json({ dataPoints, averageEfficiency: effCount > 0 ? effSum / effCount : 0, latestCapacityEst: latestCap, totalCycles: Math.round(cycles) });
    });
});

app.get('/api/history', (req, res) => {
    const range = req.query.range || 'day'; const offset = parseInt(req.query.offset || '0');
    const startObj = new Date(); const endObj = new Date(); let groupBy = 1;
    switch(range) {
        case 'hour': startObj.setMinutes(0,0,0); startObj.setHours(startObj.getHours() + offset); endObj.setTime(startObj.getTime() + 3600000); break;
        case 'day': startObj.setHours(0,0,0,0); startObj.setDate(startObj.getDate() + offset); endObj.setTime(startObj.getTime() + 86400000); break;
        case 'week': const d = startObj.getDay(); startObj.setDate(startObj.getDate() - d + (d === 0 ? -6 : 1) + (offset * 7)); startObj.setHours(0,0,0,0); endObj.setTime(startObj.getTime() + 604800000); groupBy = 5; break;
        case 'month': startObj.setDate(1); startObj.setHours(0,0,0,0); startObj.setMonth(startObj.getMonth() + offset); endObj.setTime(new Date(startObj.getFullYear(), startObj.getMonth() + 1, 1).getTime()); groupBy = 30; break;
        case 'year': startObj.setMonth(0,1); startObj.setHours(0,0,0,0); startObj.setFullYear(startObj.getFullYear() + offset); endObj.setTime(new Date(startObj.getFullYear() + 1, 0, 1).getTime()); groupBy = 1440; break;
    }
    const q = `timestamp BETWEEN '${getLocalTimestamp(startObj)}' AND '${getLocalTimestamp(endObj)}'`;
    db.all("SELECT * FROM tariffs ORDER BY valid_from ASC", (err, tariffs) => {
        db.all(`SELECT * FROM energy_log WHERE ${q} ORDER BY timestamp ASC`, (err, rows) => {
            let s = { production: 0, consumption: 0, imported: 0, exported: 0, costSaved: 0, earnings: 0 };
            (rows || []).forEach(r => {
                const t = getTariffForTime(tariffs, r.timestamp);
                const imp = r.power_grid > 0 ? r.power_grid / 60000 : 0;
                const exp = r.power_grid < 0 ? Math.abs(r.power_grid) / 60000 : 0;
                const self = Math.max(0, (r.power_load / 60000) - imp);
                s.production += r.power_pv / 60000; s.consumption += r.power_load / 60000; s.imported += imp; s.exported += exp;
                s.costSaved += self * t.costPerKwh; s.earnings += exp * t.feedInTariff;
            });
            const chart = [];
            for (let i = 0; i < (rows || []).length; i += groupBy) {
                let p=0,l=0,g=0,b=0,soc=0,c=0;
                for (let j=0; j<groupBy && (i+j)<rows.length; j++) { const r=rows[i+j]; p+=r.power_pv; l+=r.power_load; g+=r.power_grid; b+=r.power_battery; soc+=r.soc; c++; }
                if (c>0) chart.push({ timestamp: rows[i].timestamp, production: p/c, consumption: l/c, grid: g/c, battery: b/c, soc: soc/c, status: rows[i].status_code });
            }
            res.json({ chart, stats: s, windowStart: getLocalTimestamp(startObj), windowEnd: getLocalTimestamp(endObj) });
        });
    });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
app.listen(PORT, () => console.log(`SunFlow Port ${PORT}`));
