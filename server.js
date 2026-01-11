
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

setInterval(async () => {
    const config = getConfig();
    if (!config.inverterIp) return;
    const rawData = await fetchFroniusData(config.inverterIp);
    let p_pv = 0, p_load = 0, p_grid = 0, p_batt = 0, soc = 0, e_day = 0;
    let statusCode = 0;
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
            else { statusCode = (Math.abs(p_pv) < 5 && Math.abs(p_batt) < 10) ? 3 : 1; }
        } else { statusCode = 2; }
    } else { statusCode = 0; }
    const timestamp = getLocalTimestamp();
    const stmt = db.prepare(`INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, energy_day_prod, status_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(timestamp, p_pv, p_load, p_grid, p_batt, soc, e_day, statusCode);
    stmt.finalize();
}, 60 * 1000);

app.get('/api/config', (req, res) => res.json(getConfig()));
app.post('/api/config', (req, res) => { saveConfig(req.body); res.json({ success: true }); });
app.get('/api/data', async (req, res) => {
    const config = getConfig();
    if (!config.inverterIp) return res.status(500).json({ error: "No Inverter IP" });
    const rawData = await fetchFroniusData(config.inverterIp);
    let responseData = { power: { pv: 0, load: 0, grid: 0, battery: 0 }, battery: { soc: 0, state: 'idle' }, energy: { today: { production: 0, consumption: 0 } }, autonomy: 0, selfConsumption: 0 };
    if (rawData && rawData.Body && rawData.Body.Data) {
        const site = rawData.Body.Data.Site;
        const inverters = rawData.Body.Data.Inverters;
        const inverterKey = Object.keys(inverters)[0];
        responseData.power = { pv: Math.round(site.P_PV || 0), load: Math.round(Math.abs(site.P_Load || 0)), grid: Math.round(site.P_Grid || 0), battery: Math.round(site.P_Akku || 0) };
        const soc = inverters[inverterKey]?.SOC || 0;
        let batState = 'idle';
        if (site.P_Akku < -10) batState = 'charging'; else if (site.P_Akku > 10) batState = 'discharging';
        responseData.battery = { soc: soc, state: batState };
        responseData.energy.today.production = (site.E_Day || 0) / 1000;
        responseData.autonomy = Math.round(site.rel_Autonomy || 0);
        responseData.selfConsumption = Math.round(site.rel_SelfConsumption || 0);
    }
    res.json(responseData);
});

const getTariffForTime = (tariffs, timestamp) => {
    let activeTariff = tariffs[0];
    const datePart = timestamp.substring(0, 10);
    for (const t of tariffs) { if (t.validFrom <= datePart) { activeTariff = t; } else { break; } }
    return activeTariff;
};

// HISTORY with offset and specific calendar windows
app.get('/api/history', (req, res) => {
    const range = req.query.range || 'day'; 
    const offset = parseInt(req.query.offset || '0');
    const startDate = req.query.start; 
    const endDate = req.query.end;     
    
    let queryTimeClause = "";
    let groupBy = 1; 

    const now = new Date();
    let startObj = new Date(now);
    let endObj = new Date(now);

    if (range === 'custom' && startDate && endDate) {
        queryTimeClause = `timestamp BETWEEN '${startDate} 00:00:00' AND '${endDate} 23:59:59'`;
        const d1 = new Date(startDate);
        const d2 = new Date(endDate);
        const diffDays = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
        groupBy = diffDays <= 2 ? 1 : diffDays <= 7 ? 5 : diffDays <= 31 ? 30 : 1440;
    } else {
        switch(range) {
            case 'hour':
                startObj.setMinutes(0, 0, 0);
                startObj.setHours(startObj.getHours() + offset);
                endObj = new Date(startObj);
                endObj.setHours(endObj.getHours() + 1);
                groupBy = 1;
                break;
            case 'day': 
                startObj.setHours(0, 0, 0, 0);
                startObj.setDate(startObj.getDate() + offset);
                endObj = new Date(startObj);
                endObj.setDate(endObj.getDate() + 1);
                groupBy = 1;
                break;
            case 'week': 
                const day = startObj.getDay();
                const diff = startObj.getDate() - day + (day === 0 ? -6 : 1);
                startObj.setDate(diff + (offset * 7));
                startObj.setHours(0, 0, 0, 0);
                endObj = new Date(startObj);
                endObj.setDate(endObj.getDate() + 7);
                groupBy = 5;
                break;
            case 'month': 
                startObj.setDate(1);
                startObj.setHours(0, 0, 0, 0);
                startObj.setMonth(startObj.getMonth() + offset);
                endObj = new Date(startObj);
                endObj.setMonth(endObj.getMonth() + 1);
                groupBy = 30;
                break;
            case 'year': 
                startObj.setMonth(0, 1);
                startObj.setHours(0, 0, 0, 0);
                startObj.setFullYear(startObj.getFullYear() + offset);
                endObj = new Date(startObj);
                endObj.setFullYear(endObj.getFullYear() + 1);
                groupBy = 1440;
                break;
        }
        
        // If viewing CURRENT period (offset 0), limit end to NOW.
        // Otherwise use the full period window.
        const effectiveEnd = offset === 0 ? getLocalTimestamp(now) : getLocalTimestamp(endObj);
        queryTimeClause = `timestamp BETWEEN '${getLocalTimestamp(startObj)}' AND '${effectiveEnd}'`;
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
                let imp = (r.power_grid > 0) ? (r.power_grid) * sampleDurationHours / 1000 : 0;
                let exp = (r.power_grid < 0) ? Math.abs(r.power_grid) * sampleDurationHours / 1000 : 0;
                if (r.power_battery > 0) stats.batteryCharged += r.power_battery * sampleDurationHours / 1000;
                else stats.batteryDischarged += Math.abs(r.power_battery) * sampleDurationHours / 1000;
                stats.production += prod; stats.consumption += cons; stats.imported += imp; stats.exported += exp;
                stats.costSaved += Math.max(0, cons - imp) * tariff.costPerKwh;
                stats.earnings += exp * tariff.feedInTariff;
            });
            const totalSelfPowered = Math.max(0, stats.consumption - stats.imported);
            stats.autonomy = stats.consumption > 0 ? (totalSelfPowered / stats.consumption) * 100 : 0;
            stats.selfConsumption = stats.production > 0 ? (totalSelfPowered / stats.production) * 100 : 0;
            const chartData = [];
            for (let i = 0; i < rows.length; i += groupBy) {
                let chunkPv = 0, chunkCons = 0, chunkGrid = 0, chunkBatt = 0, chunkSoc = 0, chunkAutonomy = 0, chunkSelfCon = 0, count = 0;
                const startTime = rows[i].timestamp; const status = rows[i].status_code ?? 1;
                for (let j = 0; j < groupBy && (i + j) < rows.length; j++) {
                    const r = rows[i + j]; chunkPv += r.power_pv || 0; chunkCons += r.power_load || 0; chunkGrid += r.power_grid || 0; chunkBatt += r.power_battery || 0; chunkSoc += r.soc || 0;
                    let pImp = r.power_grid > 0 ? r.power_grid : 0; let pExp = r.power_grid < 0 ? Math.abs(r.power_grid) : 0;
                    chunkAutonomy += r.power_load > 0 ? Math.max(0, ((r.power_load - pImp) / r.power_load) * 100) : 0;
                    chunkSelfCon += r.power_pv > 0 ? ((r.power_pv - pExp) / r.power_pv) * 100 : 0;
                    count++;
                }
                if (count > 0) { chartData.push({ timestamp: startTime, production: Math.round(chunkPv / count), consumption: Math.round(chunkCons / count), grid: Math.round(chunkGrid / count), battery: Math.round(chunkBatt / count), soc: Math.round(chunkSoc / count), autonomy: Math.round(chunkAutonomy / count), selfConsumption: Math.round(chunkSelfCon / count), status: status }); }
            }
            res.json({ chart: chartData, stats, windowStart: getLocalTimestamp(startObj), windowEnd: getLocalTimestamp(endObj) });
        });
    });
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'dist', 'index.html')); });
app.listen(PORT, () => { console.log(`SunFlow Backend running on http://localhost:${PORT}`); });
