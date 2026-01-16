/**
 * Backend Server for SunFlow
 */

import express from 'express';
import { createRequire } from 'module';
import axios from 'axios';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pathToFileURL } from 'url';

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
const compression = require('compression'); // Performance: Gzip Compression

// Fixed-origin HTTP client for Discord webhook calls (helps CodeQL SSRF detection).
const DISCORD_WEBHOOK_CLIENT = axios.create({ baseURL: 'https://discord.com' });

app.disable('x-powered-by');

// If running behind a reverse proxy (Traefik/Nginx/Caddy), set TRUST_PROXY=1 (or "true")
// so rate limiting and IP-based logic use the correct client IP.
if (process.env.TRUST_PROXY) {
    const v = process.env.TRUST_PROXY;
    app.set('trust proxy', v === 'true' ? 1 : v);
}

const PORT = process.env.PORT || 3000;
const REPO_OWNER = 'robotnikz';
const REPO_NAME = 'Sunflow';

const IS_TEST = process.env.NODE_ENV === 'test' || !!process.env.VITEST;
const IS_MAIN = (() => {
    try {
        return import.meta.url === pathToFileURL(process.argv[1]).href;
    } catch {
        return false;
    }
})();

// Treat DATA_DIR as configuration, but validate any override so filesystem paths are not
// derived from uncontrolled input (helps CodeQL and avoids accidental writes to unexpected locations).
const resolveSafeDataDir = (maybeDir) => {
    const defaultDir = path.join(__dirname, 'data');
    if (!maybeDir || typeof maybeDir !== 'string' || maybeDir.includes('\0')) return defaultDir;

    const resolved = path.resolve(process.cwd(), maybeDir);

    // CodeQL-friendly containment check (no loops / no case transforms):
    // allow only paths that are within one of a few safe roots.
    const isWithin = (parent, child) => {
        const rel = path.relative(parent, child);
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    };

    if (
        isWithin(__dirname, resolved) ||
        isWithin(process.cwd(), resolved) ||
        isWithin(os.tmpdir(), resolved)
    ) {
        return resolved;
    }

    console.warn(`Ignoring unsafe DATA_DIR override: ${maybeDir}`);
    return defaultDir;
};

// Data Directory Setup (Crucial for Docker persistence)
const DATA_DIR = resolveSafeDataDir(process.env.DATA_DIR);
if (!fs.existsSync(DATA_DIR)){
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)){
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}



// Upload config for middleware
const upload = multer({
    dest: UPLOADS_DIR,
    limits: {
        files: 1,
        fileSize: Number(process.env.UPLOAD_MAX_BYTES || 15 * 1024 * 1024), // 15MB default
        fieldSize: Number(process.env.UPLOAD_FIELD_MAX_BYTES || 256 * 1024),
    },
    fileFilter: (req, file, cb) => {
        const name = String(file?.originalname || '').toLowerCase();
        const isCsvByName = name.endsWith('.csv');
        const mime = String(file?.mimetype || '').toLowerCase();
        const isCsvByMime = mime.includes('csv') || mime === 'text/plain' || mime === 'application/octet-stream';
        if (!isCsvByName && !isCsvByMime) {
            // Don't throw (can cause connection resets while client is still streaming).
            // Instead, skip the file and let the route return a clean 400.
            req.fileValidationError = 'Only CSV uploads are allowed';
            return cb(null, false);
        }
        cb(null, true);
    }
});

const DB_FILE = path.join(DATA_DIR, 'solar_data.db');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const canWritePath = (p) => {
    try {
        fs.accessSync(p, fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
};

const explainReadonlyDbAndExit = (details) => {
    console.error('');
    console.error('FATAL: SunFlow cannot write to its data directory / database.');
    console.error(`DATA_DIR: ${DATA_DIR}`);
    console.error(`DB_FILE:  ${DB_FILE}`);
    if (details) console.error(details);
    console.error('');
    console.error('This usually happens after upgrading to a non-root container when your bind-mounted data');
    console.error('directory (or the existing solar_data.db file) is owned by root or marked read-only.');
    console.error('');
    console.error('Fix options:');
    console.error('- Ensure the host folder is writable (recommended)');
    console.error('- Linux: `sudo chown -R 1000:1000 ./sunflow-data && sudo chmod -R u+rwX ./sunflow-data`');
    console.error('- Docker helper (Linux/WSL):');
    console.error('  `docker run --rm -v "${PWD}/sunflow-data:/data" alpine sh -lc "chown -R 1000:1000 /data || true"`');
    console.error('- Windows (PowerShell): remove read-only attribute if set: `attrib -R .\\sunflow-data\\* /S /D`');
    console.error('');
    process.exit(1);
};

// Fail fast with a clear message if the DB file or data dir is not writable.
if (fs.existsSync(DB_FILE)) {
    if (!canWritePath(DB_FILE)) {
        explainReadonlyDbAndExit('The existing DB file is not writable by the current process.');
    }
} else {
    if (!canWritePath(DATA_DIR)) {
        explainReadonlyDbAndExit('The data directory is not writable and the DB file does not yet exist.');
    }
}

// --- SECURITY MIDDLEWARE ---
// 1. Helmet: Sets various HTTP headers to secure the app
app.use(helmet({
    contentSecurityPolicy: false, // Disabled for simple dev/dashboard setup (inline scripts etc)
    crossOriginEmbedderPolicy: false,
}));

// 2. CORS: Allow cross-origin requests (Dashboard usage)
const devCorsAllowlist = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]);
const corsAllowlist = new Set(
    String(process.env.CORS_ORIGIN || process.env.SUNFLOW_CORS_ORIGIN || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
);
const shouldEnableCors = process.env.CORS_DISABLED !== 'true' && process.env.SUNFLOW_CORS_DISABLED !== 'true';
if (shouldEnableCors) {
    // Secure-by-default: in production, only allow explicitly configured origins.
    // In dev/test, allow common local dev origin to keep Vite proxy setups simple.
    app.use(cors({
        origin: (origin, cb) => {
            if (!origin) return cb(null, true);
            const isDev = process.env.NODE_ENV !== 'production';
            if (corsAllowlist.size > 0) return cb(null, corsAllowlist.has(origin));
            if (isDev) return cb(null, devCorsAllowlist.has(origin));
            return cb(null, false);
        },
        methods: ['GET', 'POST', 'DELETE'],
        maxAge: 600,
    }));
}

// 3. Rate Limiting: Prevent brute-force or accidental DoS
const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	limit: 5000, // Limit each IP to 5000 requests per window (High enough for polling dashboard)
	standardHeaders: true, 
	legacyHeaders: false, 
});
app.use('/api/', apiLimiter);

// 4. Compression (Gzip): Reduces JSON payload size significantly
app.use(compression());

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));

// Optional: protect write/admin routes via Bearer token.
// If SUNFLOW_ADMIN_TOKEN is unset, everything remains open (backwards compatible).
const requireAdmin = (req, res, next) => {
    const token = process.env.SUNFLOW_ADMIN_TOKEN;
    if (!token) return next();

    const auth = String(req.headers.authorization || '');
    if (auth === `Bearer ${token}`) return next();
    return res.status(401).json({ error: 'Unauthorized' });
};

const isAdminRequest = (req) => {
    const token = process.env.SUNFLOW_ADMIN_TOKEN;
    if (!token) return true;
    const auth = String(req.headers.authorization || '');
    return auth === `Bearer ${token}`;
};

const sanitizeInverterHost = (host) => {
    if (!host || typeof host !== 'string') return null;
    const h = host.trim();

    // Must be IPv4[:port] only. This keeps the inverter request constrained to typical LAN IPs.
    const m = /^([0-9]{1,3}(?:\.[0-9]{1,3}){3})(?::([0-9]{1,5}))?$/.exec(h);
    if (!m) return null;

    const ip = m[1];
    const parts = ip.split('.').map(n => Number(n));
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;

    const [a, b] = parts;
    const isPrivate = (
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
    );
    if (!isPrivate) return null;

    const portRaw = m[2];
    if (portRaw !== undefined) {
        const port = Number(portRaw);
        if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
        return `${ip}:${port}`;
    }

    return ip;
};

const canonicalizeDiscordWebhookUrl = (webhookUrl) => {
    if (!webhookUrl || typeof webhookUrl !== 'string') return null;
    let u;
    try {
        u = new URL(webhookUrl);
    } catch {
        return null;
    }
    if (u.protocol !== 'https:') return null;

    const host = u.hostname.toLowerCase();
    // Discord webhook hosts (new + legacy). Keep narrow to avoid SSRF.
    const allowedHosts = new Set(['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com']);
    if (!allowedHosts.has(host)) return null;

    // Require strict webhook path structure and canonicalize the origin.
    // Typical format: /api/webhooks/<id>/<token>
    if (!/^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(u.pathname)) return null;

    const canonical = new URL('https://discord.com');
    canonical.pathname = u.pathname;
    return canonical.toString();
};

const isAllowedDiscordWebhook = (webhookUrl) => !!canonicalizeDiscordWebhookUrl(webhookUrl);

const stripDangerousKeys = (value) => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(stripDangerousKeys);

    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (k === '__proto__' || k === 'prototype' || k === 'constructor') continue;
        out[k] = stripDangerousKeys(v);
    }
    return out;
};

const redactConfigForClient = (config) => {
    const tokenSet = !!process.env.SUNFLOW_ADMIN_TOKEN;
    const protectSecrets = process.env.SUNFLOW_PROTECT_SECRETS !== 'false';
    if (!tokenSet || !protectSecrets) return config;

    const safe = stripDangerousKeys(config);
    if (safe?.notifications?.discordWebhook) safe.notifications.discordWebhook = '';
    if (safe?.solcastApiKey) safe.solcastApiKey = '';
    return safe;
};

// 5. Serve static files with Aggressive Caching (Immutable assets)
// Vite generates filenames with hashes (e.g. index.12ea.js), so we can cache them "forever"
app.use(express.static(path.join(__dirname, 'dist'), {
    maxAge: '1y', // Cache for 1 year
    immutable: true, // Content will never change for a given filename
    etag: false, // Don't check server for changes
    setHeaders: (res, path) => {
        // Only cache actual assets (js, css, images) aggressively
        // HTML files should never be cached as they are the entry point
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// Database Setup
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) console.error("Error opening database:", err.message);
    else {
        console.log(`Connected to SQLite database at ${DB_FILE}`);
        // Performance Optimization: Use WAL Mode (Write-Ahead Logging) for better concurrency
        db.run('PRAGMA journal_mode = WAL;', (err) => {
            if(err) console.error("Failed to enable WAL mode:", err);
            else console.log("SQLite WAL mode enabled.");
        });

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
            )`, (err) => {
                if (err) console.error('DB init error (energy_log):', err.message);
            });
            
            // Migration: Add status_code column if it doesn't exist
            db.run("ALTER TABLE energy_log ADD COLUMN status_code INTEGER DEFAULT 1", (err) => {
                if (err) {
                    if (!err.message.includes("duplicate column name")) {
                        console.error("Migration error (status_code):", err.message);
                    }
                }
            });

            db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON energy_log(timestamp)`, (err) => {
                if (err) console.error('DB init error (idx_timestamp):', err.message);
            });

            // Tariffs Table
            db.run(`CREATE TABLE IF NOT EXISTS tariffs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                valid_from DATE NOT NULL,
                cost_per_kwh REAL NOT NULL,
                feed_in_tariff REAL NOT NULL
            )`, () => {
                if (isShuttingDown) return;
                db.get("SELECT count(*) as count FROM tariffs", (err, row) => {
                    if (err) {
                        console.error('Failed to seed initial tariff:', err.message);
                        return;
                    }
                    if (!row || row.count === 0) {
                        if (isShuttingDown) return;
                        const oldConfig = getConfig();
                        console.log("Seeding initial tariff from config...");
                        const stmt = db.prepare("INSERT INTO tariffs (valid_from, cost_per_kwh, feed_in_tariff) VALUES (?, ?, ?)");
                        stmt.run("2000-01-01", oldConfig.costPerKwh || 0.30, oldConfig.feedInTariff || 0.08, (sErr) => {
                            if (sErr) console.error('Failed to seed initial tariff:', sErr.message);
                        });
                        stmt.finalize((fErr) => {
                            if (fErr) console.error('Failed to finalize seed statement:', fErr.message);
                        });
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
            )`, (err) => {
                if (err) console.error('DB init error (expenses):', err.message);
            });

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
            )`, (err) => {
                if (err) console.error('DB init error (energy_data):', err.message);
            });
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

// In-Memory Cache for Config to reduce disk I/O
let configCache = null;

const getConfig = () => {
    // Return cache if available
    if (configCache) return configCache;

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

    // Smart Usage defaults
    if (!config.smartUsage) {
        config.smartUsage = { reserveSocPct: 100 };
    } else if (config.smartUsage.reserveSocPct === undefined) {
        config.smartUsage.reserveSocPct = 100;
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
    
    // Update Cache
    configCache = config;
    return config;
};

const saveConfig = (cfg) => {
    // Validate inputs loosely
    if (typeof cfg !== 'object') return;
    
    // Merge with existing to ensure we don't lose fields
    // NOTE: Check cache first, or read from disk if cold
    const current = configCache || getConfig(); 
    const diskConfig = {
        ...current,
        ...cfg
    };

    // Persist first. Do NOT populate the in-memory cache from request-derived values.
    // This avoids taint propagation from HTTP input into outbound-request sinks (CodeQL SSRF).
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(diskConfig, null, 2));

    // Invalidate cache so subsequent reads come from disk.
    configCache = null;
};

// Moved fetchFroniusData below to be near cache logic

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

// --- GLOBAL OPEN-METEO SUN TIMES CACHE (Shared between API and Notification Logic) ---
let openMeteoSunCache = {
    key: null,
    timestamp: 0,
    data: null
};

const getLocalIsoDate = (date = new Date()) => {
    const timeZone = process.env.TZ || 'Europe/Berlin';
    // sv-SE reliably produces YYYY-MM-DD
    return date.toLocaleDateString('sv-SE', { timeZone });
};

const parseFiniteNumber = (value) => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
};

const getTodaySunTimes = async (config) => {
    // Avoid outbound calls in tests.
    if (IS_TEST) return null;

    const lat = parseFiniteNumber(config?.latitude);
    const lon = parseFiniteNumber(config?.longitude);
    if (lat === null || lon === null) return null;

    const dateKey = getLocalIsoDate();
    const cacheKey = `${lat},${lon},${dateKey}`;

    if (openMeteoSunCache.data && openMeteoSunCache.key === cacheKey) {
        return openMeteoSunCache.data;
    }

    try {
        // CodeQL-friendly SSRF hardening: fixed host + URLSearchParams encoding.
        const u = new URL('https://api.open-meteo.com/v1/forecast');
        u.searchParams.set('latitude', String(lat));
        u.searchParams.set('longitude', String(lon));
        u.searchParams.set('daily', 'sunrise,sunset');
        u.searchParams.set('timezone', 'auto');
        u.searchParams.set('forecast_days', '1');

        const response = await axios.get(u.toString(), { timeout: 8000 });

        const sunriseIso = Array.isArray(response?.data?.daily?.sunrise) ? response.data.daily.sunrise[0] : null;
        const sunsetIso = Array.isArray(response?.data?.daily?.sunset) ? response.data.daily.sunset[0] : null;
        const utcOffsetSecondsRaw = response?.data?.utc_offset_seconds;
        const utcOffsetSeconds = Number.isFinite(Number(utcOffsetSecondsRaw)) ? Number(utcOffsetSecondsRaw) : 0;

        if (typeof sunriseIso !== 'string' || typeof sunsetIso !== 'string') return null;

        const data = { sunriseIso, sunsetIso, utcOffsetSeconds };

        openMeteoSunCache = {
            key: cacheKey,
            timestamp: Date.now(),
            data
        };

        return data;
    } catch (e) {
        return null;
    }
};

const parseOpenMeteoLocalIsoToUtcMs = (isoString, utcOffsetSeconds = 0) => {
    if (typeof isoString !== 'string') return NaN;

    // If the string already contains an explicit timezone, let Date.parse handle it.
    if (/[zZ]$/.test(isoString) || /[+-]\d\d:?\d\d$/.test(isoString)) {
        return Date.parse(isoString);
    }

    const m = isoString.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return Date.parse(isoString);

    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = m[6] ? Number(m[6]) : 0;

    // Treat components as local time in the location timezone (UTC + offset).
    // Convert to UTC by subtracting the offset.
    const utcMsAssumingUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    return utcMsAssumingUtc - (Number(utcOffsetSeconds) * 1000);
};

const isNowBetweenSunriseAndSunset = (sunTimes, nowDate = new Date()) => {
    if (!sunTimes?.sunriseIso || !sunTimes?.sunsetIso) return null;
    const utcOffsetSeconds = Number.isFinite(Number(sunTimes?.utcOffsetSeconds)) ? Number(sunTimes.utcOffsetSeconds) : 0;

    const sunriseMs = parseOpenMeteoLocalIsoToUtcMs(sunTimes.sunriseIso, utcOffsetSeconds);
    const sunsetMs = parseOpenMeteoLocalIsoToUtcMs(sunTimes.sunsetIso, utcOffsetSeconds);
    if (!Number.isFinite(sunriseMs) || !Number.isFinite(sunsetMs)) return null;

    const nowMs = nowDate.getTime();
    return nowMs >= sunriseMs && nowMs < sunsetMs;
};

// --- FRONIUS INVERTER CACHE (Throttling) ---
// Prevents overloading the inverter if multiple dashboard clients are open
let inverterCache = {
    timestamp: 0,
    data: null
};

const fetchFroniusData = async (ip) => {
    // Inline, CodeQL-friendly SSRF hardening:
    // accept only private IPv4[:port] and build the URL from a fixed template.
    const rawHost = typeof ip === 'string' ? ip.trim() : '';
    const hostMatch = /^([0-9]{1,3}(?:\.[0-9]{1,3}){3})(?::([0-9]{1,5}))?$/.exec(rawHost);
    if (!hostMatch) return null;
    const host = hostMatch[1];
    const portRaw = hostMatch[2];

    const parts = host.split('.').map(n => Number(n));
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const [a, b] = parts;
    const isPrivate = (
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
    );
    if (!isPrivate) return null;

    let port = '';
    if (portRaw !== undefined) {
        const p = Number(portRaw);
        if (!Number.isInteger(p) || p < 1 || p > 65535) return null;
        port = String(p);
    }

    const now = Date.now();
    // Return cached data if request is within 1000ms (1 second) of the last one
    if (inverterCache.data && (now - inverterCache.timestamp < 1000)) {
        return inverterCache.data;
    }

    try {
        const url = new URL('http://127.0.0.1/solar_api/v1/GetPowerFlowRealtimeData.fcgi');
        url.hostname = host;
        if (port) url.port = port;

        const response = await axios.get(url.toString(), { timeout: 3000 });
        
        // Update Cache
        inverterCache = {
            timestamp: now,
            data: response.data
        };
        
        return response.data;
    } catch (error) {
        return null;
    }
};

// Helper: Get Local SQLite-compatible Timestamp (YYYY-MM-DD HH:MM:SS)
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
    // Inline, CodeQL-friendly SSRF hardening: allowlist Discord hosts + strict webhook path.
    if (!webhookUrl || typeof webhookUrl !== 'string') return;
    let u;
    try {
        u = new URL(webhookUrl);
    } catch {
        return;
    }
    if (u.protocol !== 'https:') return;

    const host = u.hostname.toLowerCase();
    const allowedHosts = new Set(['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com']);
    if (!allowedHosts.has(host)) return;

    const m = /^\/api\/webhooks\/(\d+)\/([A-Za-z0-9_-]+)$/.exec(u.pathname);
    if (!m) return;
    const safePath = `/api/webhooks/${m[1]}/${m[2]}`;

    try {
        await DISCORD_WEBHOOK_CLIENT.post(safePath, {
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

// --- RETENTION & AGGREGATION LOGIC ---

/**
 * Runs periodically to move high-resolution data older than 7 days 
 * into the long-term energy_data table (aggregated hourly) and cleans up energy_log.
 */
const runRetentionPolicy = () => {
    const RETENTION_DAYS = 7;
    const now = new Date();
    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    const cutoffTs = getLocalTimestamp(cutoffDate);

    console.log(`[Retention] Checking for data older than ${cutoffTs}...`);

    db.serialize(() => {
        // 1. Aggregate hourly data from energy_log into energy_data
        // We calculate AVG Power (Watts) over the hour. Since it's 1 hour, Avg Watts = Watt-hours.
        const aggSql = `
            INSERT OR IGNORE INTO energy_data (
                timestamp, 
                production_wh, 
                grid_feed_in_wh, 
                grid_consumption_wh, 
                battery_charge_wh, 
                battery_discharge_wh, 
                load_wh
            )
            SELECT 
                strftime('%Y-%m-%d %H:00:00', timestamp) as ts,
                AVG(power_pv) as production_wh,
                AVG(CASE WHEN power_grid < 0 THEN ABS(power_grid) ELSE 0 END) as grid_feed_in_wh,
                AVG(CASE WHEN power_grid > 0 THEN power_grid ELSE 0 END) as grid_consumption_wh,
                AVG(CASE WHEN power_battery < 0 THEN ABS(power_battery) ELSE 0 END) as battery_charge_wh,
                AVG(CASE WHEN power_battery > 0 THEN power_battery ELSE 0 END) as battery_discharge_wh,
                AVG(power_load) as load_wh
            FROM energy_log
            WHERE timestamp < ?
            GROUP BY ts
        `;

        db.run(aggSql, [cutoffTs], function(err) {
            if (err) {
                console.error("[Retention] Aggregation failed:", err.message);
                return;
            }
            if (this.changes > 0) {
                console.log(`[Retention] Archived ${this.changes} hourly records to long-term storage.`);
            }

            // 2. Delete the old detailed logs
            // Only delete what we have safely aggregated (filtered by same cutoff)
            db.run("DELETE FROM energy_log WHERE timestamp < ?", [cutoffTs], function(err) {
                if (err) {
                    console.error("[Retention] Cleanup failed:", err.message);
                } else if (this.changes > 0) {
                    console.log(`[Retention] Cleaned up ${this.changes} old minute-level records.`);
                    
                    // Trigger calibration to keep totals safe
                    updateCalibrationFromDatabase();
                }
            });

            // 3. Maintenance: Optimization (VACUUM)
            // Run occasionally (e.g. if we are in the early morning hours 03:00 - 04:00) to shrink DB file
            // Since this runs hourly, it will hit once a day.
            const hour = new Date().getHours();
            if (hour === 3) {
                console.log("[Retention] Running Database VACUUM to reclaim disk space...");
                db.run("VACUUM;", (vErr) => {
                    if (vErr) console.error("VACUUM failed:", vErr);
                    else console.log("Database optimized successfully.");
                });
            }
        });
    });
};

// Run Retention Policy every hour
if (!IS_TEST) {
    setInterval(runRetentionPolicy, 60 * 60 * 1000);
    // Run once on startup after a small delay
    setTimeout(runRetentionPolicy, 30 * 1000);
}


// Polling Job - 1 Minute Interval
if (!IS_TEST) setInterval(async () => {
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
                const reserveSocPctRaw = config?.smartUsage?.reserveSocPct;
                const reserveSocPct = Math.min(100, Math.max(0, Number.isFinite(Number(reserveSocPctRaw)) ? Number(reserveSocPctRaw) : 100));
                const socMissingPct = Math.max(0, reserveSocPct - soc);
                const kwhToReachReserve = (socMissingPct / 100) * batteryCapacity;

                // C) Calculate "Safe Buffer" (Forecast - Fill Need - 10% Margin)
                const energyBufferKwh = forecastRemainingKwh - (kwhToReachReserve * 1.1);

                // D) Determine if it's safe to divert battery charge
                const isBatterySafe = (energyBufferKwh > 0) || (soc >= reserveSocPct) || (soc > 95);

                // E0) Reserve mode: allow suggestions that can be powered from battery energy above reserve
                // Only do this while we still have remaining solar forecast today (i.e. before sunset).
                const aboveReserveKwh = Math.max(0, ((soc - reserveSocPct) / 100) * batteryCapacity);
                const canUseReserveNow = forecastRemainingKwh > 0 && soc > (reserveSocPct + 0.5) && aboveReserveKwh > 0;

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
                let bestStrategy = 'grid';

                (config.appliances || []).forEach(app => {
                    if (!notifyState.smartAdviceCounters[app.id]) notifyState.smartAdviceCounters[app.id] = 0;

                    const appWatts = Number(app?.watts || 0);
                    if (!Number.isFinite(appWatts) || appWatts <= 0) {
                        // Device has no usable power threshold configured.
                        // Keep it out of Smart Suggestions rather than spamming/guessing.
                        notifyState.smartAdviceCounters[app.id] = 0;
                        return;
                    }
                    
                    // Check if appliance fits in the SMART surplus
                    const fitsSurplus = totalSurplus >= appWatts;
                    const appKwh = Number(app?.kwhEstimate || 0);
                    const fitsReserve = canUseReserveNow && Number.isFinite(appKwh) && appKwh > 0 && appKwh <= aboveReserveKwh;

                    if (fitsSurplus || fitsReserve) {
                        notifyState.smartAdviceCounters[app.id]++;
                    } else {
                        notifyState.smartAdviceCounters[app.id] = 0;
                    }

                    // Trigger if condition met for 3 consecutive checks (3 minutes)
                    if (notifyState.smartAdviceCounters[app.id] >= 3) {
                        if (!bestAppliance || appWatts > Number(bestAppliance.watts || 0)) {
                            bestAppliance = app;
                            bestStrategy = fitsSurplus ? (isBatterySafe ? 'divert' : 'grid') : 'reserve';
                        }
                    }
                });

                if (bestAppliance) {
                    const strategyLabel = bestStrategy === 'reserve'
                        ? `Reserve (min ${Math.round(reserveSocPct)}%)`
                        : (isBatterySafe ? "Battery Safe (Diverting Charge)" : "Battery Priority (Grid Only)");

                    const title = "💡 Smart Suggestion";
                    const message = bestStrategy === 'reserve'
                        ? `Battery is above your reserve target (~${aboveReserveKwh.toFixed(1)} kWh). You can run the **${bestAppliance.name}** now.`
                        : `Excess solar power available (${Math.round(totalSurplus)}W). You can run the **${bestAppliance.name}** now for free!`;

                    const fields = bestStrategy === 'reserve'
                        ? [
                            { name: "Above Reserve", value: `${aboveReserveKwh.toFixed(1)} kWh`, inline: true },
                            { name: "Device Energy", value: `${Number(bestAppliance.kwhEstimate || 0)} kWh/run`, inline: true },
                            { name: "Strategy", value: strategyLabel, inline: false }
                        ]
                        : [
                            { name: "Available Surplus", value: `${Math.round(totalSurplus)} W`, inline: true },
                            { name: "Device Power", value: `${bestAppliance.watts} W`, inline: true },
                            { name: "Strategy", value: strategyLabel, inline: false }
                        ];

                    await sendDiscordNotification(
                        nConfig.discordWebhook, 
                        title,
                        message,
                        3447003, 
                        fields
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
    stmt.run(timestamp, p_pv, p_load, p_grid, p_batt, soc, e_day, statusCode, (err) => {
        if (err) {
            console.error('Failed to insert energy_log row:', err.message);
        }
    });
    stmt.finalize((err) => {
        if (err) console.error('Failed to finalize energy_log insert statement:', err.message);
    });

}, 60 * 1000); // 1 Minute

// --- Version & Update Check Cache ---
let versionCache = {
    lastCheck: 0,
    data: { latestVersion: packageJson.version, updateAvailable: false, releaseUrl: '' }
};

const getVersionInfo = async () => {
    // In tests (and optionally via env), avoid outbound network calls.
    if (IS_TEST || process.env.DISABLE_UPDATE_CHECK === '1') {
        return {
            version: packageJson.version,
            latestVersion: packageJson.version,
            updateAvailable: false,
            releaseUrl: ''
        };
    }

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

app.get('/api/config', (req, res) => {
    const config = getConfig();
    if (isAdminRequest(req)) return res.json(config);
    return res.json(redactConfigForClient(config));
});

app.post('/api/config', requireAdmin, (req, res) => {
    // Basic input hardening to avoid prototype pollution and accidental huge payloads.
    const patch = stripDangerousKeys(req.body);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return res.status(400).json({ error: 'Invalid config payload' });
    }

    if (patch.inverterIp !== undefined) {
        const safeHost = sanitizeInverterHost(patch.inverterIp);
        if (!safeHost) return res.status(400).json({ error: 'Invalid inverterIp (expected host[:port])' });
        patch.inverterIp = safeHost;
    }
    if (patch.notifications !== undefined) {
        if (!patch.notifications || typeof patch.notifications !== 'object' || Array.isArray(patch.notifications)) {
            return res.status(400).json({ error: 'Invalid notifications payload' });
        }
        if (patch.notifications.discordWebhook !== undefined) {
            let w = patch.notifications.discordWebhook;
            if (w === null) {
                w = '';
                patch.notifications.discordWebhook = '';
            }
            if (w !== '' && w !== undefined && typeof w !== 'string') {
                return res.status(400).json({ error: 'Invalid Discord webhook URL' });
            }
            if (w && typeof w === 'string') {
                const canonical = canonicalizeDiscordWebhookUrl(w);
                if (!canonical) return res.status(400).json({ error: 'Invalid Discord webhook URL' });
                patch.notifications.discordWebhook = canonical;
            }
        }
    }

    // Validate Solcast configuration to avoid using arbitrary user input in outbound request URLs.
    // Allow clearing values via null/empty string; otherwise enforce a conservative character set.
    const isValidSolcastToken = (v) => typeof v === 'string' && v.length > 0 && v.length <= 128 && /^[A-Za-z0-9_-]+$/.test(v);

    if (patch.solcastApiKey !== undefined) {
        if (patch.solcastApiKey === null) {
            patch.solcastApiKey = '';
        } else if (typeof patch.solcastApiKey !== 'string') {
            return res.status(400).json({ error: 'Invalid Solcast API key' });
        } else {
            const trimmed = patch.solcastApiKey.trim();
            if (trimmed === '') {
                patch.solcastApiKey = '';
            } else if (!isValidSolcastToken(trimmed)) {
                return res.status(400).json({ error: 'Invalid Solcast API key' });
            } else {
                patch.solcastApiKey = trimmed;
            }
        }
    }

    if (patch.solcastSiteId !== undefined) {
        if (patch.solcastSiteId === null) {
            patch.solcastSiteId = '';
        } else if (typeof patch.solcastSiteId !== 'string') {
            return res.status(400).json({ error: 'Invalid Solcast site ID' });
        } else {
            const trimmed = patch.solcastSiteId.trim();
            if (trimmed === '') {
                patch.solcastSiteId = '';
            } else if (!isValidSolcastToken(trimmed)) {
                return res.status(400).json({ error: 'Invalid Solcast site ID' });
            } else {
                patch.solcastSiteId = trimmed;
            }
        }
    }

    saveConfig(patch);
    res.json({ success: true });
});

app.post('/api/test-notification', requireAdmin, async (req, res) => {
    // Important: do NOT accept arbitrary webhook URLs from the request body.
    // This endpoint only tests the persisted config webhook (prevents SSRF via request input).
    const config = getConfig();
    const configuredWebhook = config?.notifications?.discordWebhook;
    const safeWebhookUrl = canonicalizeDiscordWebhookUrl(configuredWebhook);
    if (!safeWebhookUrl) {
        return res.status(400).json({ error: 'Discord webhook not configured' });
    }

    try {
        await sendDiscordNotification(safeWebhookUrl, "🔔 Test Notification", "SunFlow notifications are working correctly!", 16776960);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/info', async (req, res) => {
    const info = await getVersionInfo();
    res.json(info);
});

/**
 * Dynamic Tariff Comparison (aWATTar)
 * Compares historic total cost for fixed tariffs vs aWATTar hourly market prices.
 * Note: aWATTar returns market prices (Eur/MWh). Users can add a surcharge + VAT to approximate all-in prices.
 */
app.get('/api/dynamic-pricing/awattar/compare', async (req, res) => {
    try {
        const config = getConfig();

        const parseYmdLocal = (ymd) => {
            const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(ymd);
            if (!m) return null;
            const year = Number(m[1]);
            const month = Number(m[2]);
            const day = Number(m[3]);
            return new Date(year, month - 1, day);
        };

        const period = (req.query.period || 'month').toString().toLowerCase();
        const hasExplicitCountry = req.query.country !== undefined && req.query.country !== null && req.query.country !== '';
        let country = (req.query.country || config.dynamicTariff?.awattar?.country || 'DE').toString().toUpperCase();
        const postalCode = (req.query.postalCode || config.dynamicTariff?.awattar?.postalCode || '').toString().trim();

        // aWATTar prices are country-based (DE/AT). If no country was provided, try a best-effort inference from postal code.
        if (!hasExplicitCountry && postalCode) {
            if (/^\d{4}$/.test(postalCode)) country = 'AT';
            if (/^\d{5}$/.test(postalCode)) country = 'DE';
        }

        const surchargeCt = clampNumber(req.query.surchargeCt ?? config.dynamicTariff?.awattar?.surchargeCt ?? 0, -1000, 5000, 0);
        const vatPercent = clampNumber(req.query.vatPercent ?? config.dynamicTariff?.awattar?.vatPercent ?? 0, 0, 50, 0);
        const surchargeEurPerKwh = surchargeCt / 100;

        const fromParam = req.query.from ? req.query.from.toString() : null; // YYYY-MM-DD
        const toParam = req.query.to ? req.query.to.toString() : null; // YYYY-MM-DD

        const startDate = fromParam ? (parseYmdLocal(fromParam) || new Date(fromParam)) : getPeriodStart(period);
        startDate.setHours(0, 0, 0, 0);

        const endDate = toParam ? (parseYmdLocal(toParam) || new Date(toParam)) : new Date();
        // Treat "to" as exclusive (start of that day). If omitted, include up to the current hour.
        if (toParam) {
            endDate.setHours(0, 0, 0, 0);
        } else {
            endDate.setMinutes(0, 0, 0);
            endDate.setHours(endDate.getHours() + 1);
        }

        const startTs = formatHourKey(startDate);
        const endTs = formatHourKey(endDate);
        const startMs = startDate.getTime();
        const endMs = endDate.getTime();

        const priceMap = await fetchAwattarMarketdata({ country, startMs, endMs });

        db.all("SELECT valid_from, cost_per_kwh, feed_in_tariff FROM tariffs ORDER BY valid_from ASC", [], (tErr, tariffRows) => {
            if (tErr) return res.status(500).json({ error: tErr.message });

            const tariffs = (tariffRows || []).map(t => ({
                validFrom: t.valid_from,
                costPerKwh: t.cost_per_kwh,
                feedInTariff: t.feed_in_tariff
            }));

            if (tariffs.length === 0) {
                return res.status(400).json({ error: "No tariffs configured" });
            }

            getHourlyGridEnergyKwh(startTs, endTs, (eErr, hours) => {
                if (eErr) return res.status(500).json({ error: eErr.message });
                if (!hours || hours.length === 0) {
                    return res.status(400).json({ error: "No energy data available in the requested range" });
                }

                let usedHours = 0;
                let fixedNet = 0;
                let dynamicNet = 0;
                let fixedImportCost = 0;
                let dynamicImportCost = 0;
                let exportRevenue = 0;

                const daily = new Map();

                for (const h of hours) {
                    const marketEurPerKwh = priceMap.get(h.timestamp);
                    if (marketEurPerKwh === undefined) continue;

                    const tariff = getTariffForTime(tariffs, h.timestamp);
                    const importKwh = h.importKwh || 0;
                    const exportKwh = h.exportKwh || 0;

                    const fixedHourImport = importKwh * tariff.costPerKwh;
                    const dynamicPriceAllIn = (marketEurPerKwh + surchargeEurPerKwh) * (1 + vatPercent / 100);
                    const dynamicHourImport = importKwh * dynamicPriceAllIn;
                    const hourExportRevenue = exportKwh * tariff.feedInTariff;

                    fixedImportCost += fixedHourImport;
                    dynamicImportCost += dynamicHourImport;
                    exportRevenue += hourExportRevenue;

                    fixedNet += fixedHourImport - hourExportRevenue;
                    dynamicNet += dynamicHourImport - hourExportRevenue;
                    usedHours++;

                    const dayKey = h.timestamp.substring(0, 10);
                    const d = daily.get(dayKey) || { fixedNet: 0, dynamicNet: 0, importKwh: 0, exportKwh: 0 };
                    d.fixedNet += fixedHourImport - hourExportRevenue;
                    d.dynamicNet += dynamicHourImport - hourExportRevenue;
                    d.importKwh += importKwh;
                    d.exportKwh += exportKwh;
                    daily.set(dayKey, d);
                }

                const seriesDaily = [...daily.entries()]
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([date, v]) => ({
                        date,
                        fixedNet: Math.round(v.fixedNet * 100) / 100,
                        dynamicNet: Math.round(v.dynamicNet * 100) / 100,
                        importKwh: Math.round(v.importKwh * 1000) / 1000,
                        exportKwh: Math.round(v.exportKwh * 1000) / 1000,
                    }));

                res.json({
                    provider: 'awattar',
                    country,
                    postalCode,
                    period,
                    range: { from: startTs, to: endTs },
                    assumptions: {
                        marketPriceUnit: 'Eur/MWh',
                        marketToKwhFactor: 1 / 1000,
                        surchargeCt,
                        vatPercent
                    },
                    coverage: {
                        hoursWithEnergy: hours.length,
                        hoursWithPrices: priceMap.size,
                        hoursUsed: usedHours
                    },
                    totals: {
                        fixed: {
                            importCost: Math.round(fixedImportCost * 100) / 100,
                            exportRevenue: Math.round(exportRevenue * 100) / 100,
                            net: Math.round(fixedNet * 100) / 100,
                        },
                        dynamic: {
                            importCost: Math.round(dynamicImportCost * 100) / 100,
                            exportRevenue: Math.round(exportRevenue * 100) / 100,
                            net: Math.round(dynamicNet * 100) / 100,
                        },
                        delta: {
                            net: Math.round((dynamicNet - fixedNet) * 100) / 100
                        }
                    },
                    seriesDaily
                });
            });
        });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Unknown error' });
    }
});

// --- SOLCAST PROXY WITH CACHING ---
// Cache variable is now defined globally above to be accessible by notification logic

app.get('/api/forecast', async (req, res) => {
    const config = getConfig();
    if (!config.solcastApiKey || !config.solcastSiteId) {
        return res.status(400).json({ error: "Solcast not configured" });
    }

    const now = Date.now();
    const nowDate = new Date(now);
    const currentHour = nowDate.getHours();

    // Only fetch around daylight. Prefer real sunrise/sunset boundaries from Open-Meteo,
    // but allow a small buffer window so the forecast can refresh shortly before sunrise.
    // Fallback to the legacy 06:00-18:00 window if sun times are unavailable.
    const sunTimes = await getTodaySunTimes(config);
    let isDaytime = (currentHour >= 6 && currentHour < 18);
    if (sunTimes) {
        const utcOffsetSeconds = Number.isFinite(Number(sunTimes?.utcOffsetSeconds)) ? Number(sunTimes.utcOffsetSeconds) : 0;
        const sunriseMs = parseOpenMeteoLocalIsoToUtcMs(sunTimes.sunriseIso, utcOffsetSeconds);
        const sunsetMs = parseOpenMeteoLocalIsoToUtcMs(sunTimes.sunsetIso, utcOffsetSeconds);

        if (Number.isFinite(sunriseMs) && Number.isFinite(sunsetMs)) {
            const bufferMs = 2 * 60 * 60 * 1000;
            const windowStartMs = sunriseMs - bufferMs;
            const windowEndMs = sunsetMs + bufferMs;
            isDaytime = now >= windowStartMs && now < windowEndMs;
        }
    }
    
    // Calculated: 12 hours window / 10 allowed requests = 1.2 hours (72 mins)
    // We use 75 minutes to be safest and evenly distribute ~10 calls per day.
    const CACHE_DURATION = 75 * 60 * 1000; 

    // 1. Return fresh cache
    if (solcastCache.data && (now - solcastCache.timestamp < CACHE_DURATION)) {
        return res.json(solcastCache.data);
    }

    // Outside daylight window: avoid calling Solcast at night. Serve cached data if present.
    if (!isDaytime) {
        if (solcastCache.data) return res.json(solcastCache.data);
        return res.json({ forecasts: [] });
    }

    // 3. Fetch new data
    try {
        // Inline, CodeQL-friendly validation at the sink: keep host fixed and constrain path/query tokens.
        const siteId = typeof config.solcastSiteId === 'string' ? config.solcastSiteId.trim() : '';
        const apiKey = typeof config.solcastApiKey === 'string' ? config.solcastApiKey.trim() : '';
        if (!siteId || !apiKey || siteId.length > 128 || apiKey.length > 128 || !/^[A-Za-z0-9_-]+$/.test(siteId) || !/^[A-Za-z0-9_-]+$/.test(apiKey)) {
            return res.status(400).json({ error: 'Invalid Solcast configuration' });
        }

        const u = new URL('https://api.solcast.com.au');
        u.pathname = `/rooftop_sites/${encodeURIComponent(siteId)}/forecasts`;
        u.searchParams.set('format', 'json');
        u.searchParams.set('api_key', apiKey);

        const response = await axios.get(u.toString(), { timeout: 8000 });
        
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
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const isValidDateOnly = (value) => {
    if (typeof value !== 'string') return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return false;
    return d.toISOString().startsWith(value);
};

app.get('/api/tariffs', (req, res) => {
    db.all("SELECT id, valid_from as validFrom, cost_per_kwh as costPerKwh, feed_in_tariff as feedInTariff FROM tariffs ORDER BY valid_from ASC", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/tariffs', requireAdmin, (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
    if (!body) return res.status(400).json({ error: 'Invalid JSON payload' });
    const { validFrom, costPerKwh, feedInTariff } = body;
    
    // Strict Input Validation
    if (!validFrom || typeof costPerKwh !== 'number' || typeof feedInTariff !== 'number') {
        return res.status(400).json({ error: "Invalid Input Types" });
    }

    if (!isValidDateOnly(validFrom)) {
        return res.status(400).json({ error: "Invalid Input Types" });
    }

    if (!isFiniteNumber(costPerKwh) || !isFiniteNumber(feedInTariff) || costPerKwh < 0 || feedInTariff < 0) {
        return res.status(400).json({ error: "Invalid Input Types" });
    }

    const stmt = db.prepare("INSERT INTO tariffs (valid_from, cost_per_kwh, feed_in_tariff) VALUES (?, ?, ?)");
    stmt.run(validFrom, costPerKwh, feedInTariff, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, success: true });
    });
    stmt.finalize();
});

app.delete('/api/tariffs/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid ID" });

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

app.post('/api/expenses', requireAdmin, (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
    if (!body) return res.status(400).json({ error: 'Invalid JSON payload' });
    const { name, amount, type, date } = body;
    
    // Strict Input Validation
    if (typeof name !== 'string' || name.trim().length === 0 || typeof amount !== 'number' || !date || (type !== 'one_time' && type !== 'yearly')) {
        return res.status(400).json({ error: "Invalid Input Types" });
    }

    if (!isValidDateOnly(date)) {
        return res.status(400).json({ error: "Invalid Input Types" });
    }

    if (!isFiniteNumber(amount) || amount < 0) {
        return res.status(400).json({ error: "Invalid Input Types" });
    }

    const stmt = db.prepare("INSERT INTO expenses (name, amount, type, date) VALUES (?, ?, ?, ?)");
    stmt.run(name, amount, type, date, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, success: true });
    });
    stmt.finalize();
});

app.delete('/api/expenses/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid ID" });

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

// --- Dynamic Pricing (aWATTar) ---
const getTimeZone = () => process.env.TZ || 'Europe/Berlin';

const clampNumber = (value, min, max, fallback) => {
    const num = Number(value);
    if (Number.isNaN(num)) return fallback;
    if (num < min) return min;
    if (num > max) return max;
    return num;
};

const formatHourKey = (dateOrMs) => {
    const timeZone = getTimeZone();
    const date = typeof dateOrMs === 'number' ? new Date(dateOrMs) : dateOrMs;
    const local = date.toLocaleString('sv-SE', { timeZone, hour12: false });
    // sv-SE yields "YYYY-MM-DD HH:mm:ss"; normalize to the hour.
    return `${local.substring(0, 13)}:00:00`;
};

const getPeriodStart = (period) => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    if (period === 'week') start.setDate(start.getDate() - 7);
    else if (period === 'month') start.setDate(start.getDate() - 30);
    else if (period === 'halfyear') start.setDate(start.getDate() - 182);
    else if (period === 'year') start.setDate(start.getDate() - 365);
    else start.setDate(start.getDate() - 7);

    return start;
};

const getHourlyGridEnergyKwh = (startTs, endTs, callback) => {
    // Prefer hourly summary table if present.
    db.all(
        `SELECT timestamp, grid_consumption_wh as import_wh, grid_feed_in_wh as export_wh
         FROM energy_data
         WHERE timestamp >= ? AND timestamp < ?
         ORDER BY timestamp ASC`,
        [startTs, endTs],
        (err, rows) => {
            if (err) return callback(err);
            if (rows && rows.length > 0) {
                const mapped = rows.map(r => ({
                    timestamp: r.timestamp,
                    importKwh: (r.import_wh || 0) / 1000,
                    exportKwh: (r.export_wh || 0) / 1000,
                }));
                return callback(null, mapped);
            }

            // Fallback: integrate power_grid values from minute log.
            db.all(
                `SELECT timestamp, power_grid
                 FROM energy_log
                 WHERE timestamp >= ? AND timestamp < ?
                 ORDER BY timestamp ASC`,
                [startTs, endTs],
                (err2, minuteRows) => {
                    if (err2) return callback(err2);
                    const buckets = new Map();

                    minuteRows.forEach((r, idx) => {
                        let durationHours = 1 / 60;
                        if (idx < minuteRows.length - 1) {
                            const current = new Date(r.timestamp);
                            const next = new Date(minuteRows[idx + 1].timestamp);
                            const diffMs = next.getTime() - current.getTime();
                            if (diffMs > 60000) durationHours = diffMs / (1000 * 60 * 60);
                            if (durationHours > 24) durationHours = 1 / 60;
                        }

                        const hourKey = `${r.timestamp.substring(0, 13)}:00:00`;
                        const currentBucket = buckets.get(hourKey) || { importKwh: 0, exportKwh: 0 };
                        const pGrid = r.power_grid || 0;
                        if (pGrid > 0) currentBucket.importKwh += (pGrid * durationHours) / 1000;
                        else currentBucket.exportKwh += (Math.abs(pGrid) * durationHours) / 1000;
                        buckets.set(hourKey, currentBucket);
                    });

                    const mapped = [...buckets.entries()]
                        .sort((a, b) => a[0].localeCompare(b[0]))
                        .map(([timestamp, v]) => ({ timestamp, ...v }));
                    callback(null, mapped);
                }
            );
        }
    );
};

const awattarCache = new Map();

const fetchAwattarMarketdata = async ({ country, startMs, endMs }) => {
    // CodeQL-friendly SSRF hardening: explicit allowlist + fixed origins.
    const cRaw = String(country || 'DE').toUpperCase();
    const c = cRaw === 'AT' ? 'AT' : 'DE';
    const cacheKey = `${c}:${startMs}:${endMs}`;
    if (awattarCache.has(cacheKey)) return awattarCache.get(cacheKey);

    const u = new URL(c === 'AT' ? 'https://api.awattar.at/v1/marketdata' : 'https://api.awattar.de/v1/marketdata');
    u.searchParams.set('start', String(startMs));
    u.searchParams.set('end', String(endMs));

    const response = await axios.get(u.toString(), { timeout: 10000 });
    const data = response.data?.data || [];

    // Map: local hour key -> €/kWh (marketprice is Eur/MWh)
    const priceMap = new Map();
    for (const item of data) {
        const startTs = item.start_timestamp;
        const marketEurPerKwh = typeof item.marketprice === 'number' ? item.marketprice / 1000 : null;
        if (!startTs || marketEurPerKwh === null) continue;
        priceMap.set(formatHourKey(startTs), marketEurPerKwh);
    }

    awattarCache.set(cacheKey, priceMap);
    return priceMap;
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
            AVG(load) as p_load,
            AVG(soc) as soc,
            AVG(grid_in) as grid_in,
            AVG(grid_out) as grid_out,
            AVG(batt_charge) as batt_charge,
            AVG(batt_discharge) as batt_discharge
        FROM (
            SELECT 
                strftime('%Y-%m-%d %H:00:00', timestamp) as ts,
                power_pv as pv,
                power_load as load,
                soc as soc,
                CASE WHEN power_grid > 0 THEN power_grid ELSE 0 END as grid_in,
                CASE WHEN power_grid < 0 THEN -power_grid ELSE 0 END as grid_out,
                CASE WHEN power_battery < 0 THEN -power_battery ELSE 0 END as batt_charge,
                CASE WHEN power_battery > 0 THEN power_battery ELSE 0 END as batt_discharge
            FROM energy_log
            UNION ALL
            SELECT 
                strftime('%Y-%m-%d %H:00:00', timestamp) as ts,
                production_wh as pv,
                load_wh as load,
                NULL as soc,
                grid_consumption_wh as grid_in,
                grid_feed_in_wh as grid_out,
                battery_charge_wh as batt_charge,
                battery_discharge_wh as batt_discharge
            FROM energy_data
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
            l: Math.round(r.p_load),
            // Battery SoC (%) is only available for energy_log-backed data.
            // Keep it optional for imported energy_data rows.
            s: (r.soc === null || r.soc === undefined) ? null : Math.round(Number(r.soc) * 10) / 10,
            // Optional: measured grid/battery flows (W averaged over the hour or Wh per hour).
            // These help calibrate power limits and round-trip efficiency.
            gi: (r.grid_in === null || r.grid_in === undefined) ? null : Math.round(Number(r.grid_in)),
            ge: (r.grid_out === null || r.grid_out === undefined) ? null : Math.round(Number(r.grid_out)),
            bc: (r.batt_charge === null || r.batt_charge === undefined) ? null : Math.round(Number(r.batt_charge)),
            bd: (r.batt_discharge === null || r.batt_discharge === undefined) ? null : Math.round(Number(r.batt_discharge))
        }));
        res.json(optimized);
    });
});

// HISTORY
app.get('/api/history', (req, res) => {
    const range = String(req.query.range || 'day');
    const startDate = req.query.start;
    const endDate = req.query.end;
    let queryTimeClause = "";
    let groupBy = 1; 

    // Variable declaration for boundary checks
    let start, end;

    const allowedRanges = new Set(['hour', 'day', 'week', 'month', 'year', 'custom']);
    if (!allowedRanges.has(range)) {
        return res.status(400).json({ error: 'Invalid range' });
    }

    // Validate offset (only meaningful for non-custom ranges)
    if (range !== 'custom' && req.query.offset !== undefined) {
        const raw = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset;
        const n = Number(raw);
        if (!Number.isFinite(n) || !Number.isInteger(n)) {
            return res.status(400).json({ error: 'Invalid offset' });
        }
    }

    if (range === 'custom') {
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Missing start/end for custom range' });
        }

        start = new Date(String(startDate));
        start.setHours(0,0,0,0);
        end = new Date(String(endDate));
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ error: 'Invalid start/end date' });
        }
        if (end.getTime() < start.getTime()) {
            return res.status(400).json({ error: 'End date must be >= start date' });
        }
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
        
        // Revised to use UNION ALL for seamless history across recent (Log) and archived (Energy Data)
        const s = queryTimeClause.match(/timestamp >= '([^']+)'/)?.[1];
        const e = queryTimeClause.match(/timestamp < '([^']+)'/)?.[1];

        const query = `
            SELECT * FROM (
                SELECT 
                    timestamp,
                    power_pv, power_load, power_grid, power_battery, soc, status_code,
                    NULL as production_wh, NULL as grid_consumption_wh, NULL as grid_feed_in_wh, 
                    NULL as battery_charge_wh, NULL as battery_discharge_wh, NULL as load_wh,
                    1 as is_high_res
                FROM energy_log 
                WHERE timestamp >= ? AND timestamp < ?
                
                UNION ALL
                
                SELECT 
                    timestamp,
                    NULL as power_pv, NULL as power_load, NULL as power_grid, NULL as power_battery, NULL as soc, NULL as status_code,
                    production_wh, grid_consumption_wh, grid_feed_in_wh, 
                    battery_charge_wh, battery_discharge_wh, load_wh,
                    0 as is_high_res
                FROM energy_data 
                WHERE timestamp >= ? AND timestamp < ?
            )
            ORDER BY timestamp ASC
        `;

        db.all(query, [s, e, s, e], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });

            // De-duplicate overlapping timestamps between energy_log (high-res) and energy_data (hourly).
            // Prefer high-res rows when timestamps collide to avoid double-counting.
            rows.sort((a, b) => {
                const t = String(a.timestamp).localeCompare(String(b.timestamp));
                if (t !== 0) return t;
                return (Number(b.is_high_res) || 0) - (Number(a.is_high_res) || 0);
            });
            const seenTimestamps = new Set();
            rows = rows.filter(r => {
                const ts = String(r.timestamp);
                if (seenTimestamps.has(ts)) return false;
                seenTimestamps.add(ts);
                return true;
            });
            
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
    
    // Unified Query handling both recent and archived data
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
        // If range is large (> 60 days), force aggregation from energy_data for performance
        // If range is small but OLD, the UNION below handles it automatically.
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
             // ... handling aggregated result below ...
        } else {
            // Mixed Mode: Union of Log (Recent) and Data (Archived)
            query = `
                SELECT 
                    timestamp, 
                    power_pv as production,
                    power_load as consumption,
                    power_grid as grid,
                    power_battery as battery,
                    1 as is_high_res
                FROM energy_log
                WHERE timestamp BETWEEN ? AND ?
                
                UNION ALL
                
                SELECT 
                    timestamp, 
                    production_wh as production, 
                    load_wh as consumption,
                    (grid_consumption_wh - grid_feed_in_wh) as grid,
                    (battery_discharge_wh - battery_charge_wh) as battery,
                    0 as is_high_res
                FROM energy_data
                WHERE timestamp BETWEEN ? AND ?
                ORDER BY timestamp ASC, is_high_res DESC
            `;
            params = [start, end, start, end];
        }
    } else {
        query += ` ORDER BY timestamp DESC LIMIT 288`; 
    }

    // Common Execution
    if (params.length > 0 && query.includes("FROM energy_data") && !query.includes("UNION ALL")) {
         // This block handles the "Large Range" monthly aggregation logic
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

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!start) rows.reverse();
        
        // De-duplicate timestamps if using UNION ALL.
        // Prefer energy_log rows on collisions.
        const hasRank = rows.some(r => r && Object.prototype.hasOwnProperty.call(r, 'is_high_res'));
        if (hasRank) {
            rows.sort((a, b) => {
                const t = String(a.timestamp).localeCompare(String(b.timestamp));
                if (t !== 0) return t;
                return (Number(b.is_high_res) || 0) - (Number(a.is_high_res) || 0);
            });
        }

        const seen = new Set();
        const cleanRows = [];
        for (const r of rows) {
            if (!seen.has(r.timestamp)) {
                seen.add(r.timestamp);
                cleanRows.push(r);
            }
        }

        const output = cleanRows.map(r => ({
            timestamp: r.timestamp,
            production: r.production,
            consumption: r.consumption,
            grid: r.grid,
            battery: r.battery,
        }));

        res.json(output);
    });
});

/**
 * IMPORT CSV API
 * Handles file upload and parses CSV data into the database
 */
app.post('/api/import-csv', requireAdmin, upload.single('file'), (req, res) => {
    if (req.fileValidationError) {
        return res.status(400).json({ error: req.fileValidationError });
    }
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    // Keep all filesystem operations confined to UPLOADS_DIR.
    // Use path.basename() as a sanitizer that CodeQL recognizes.
    const safeFileName = path.basename(String(req.file.path || '')).toLowerCase();
    if (!safeFileName) {
        return res.status(400).json({ error: 'Invalid upload path' });
    }
    // Multer's default filename is a 32-char hex string; enforce this to make path usage clearly safe.
    if (!/^[0-9a-f]{32}$/.test(safeFileName)) {
        return res.status(400).json({ error: 'Invalid upload path' });
    }
    const filePath = path.resolve(UPLOADS_DIR, safeFileName);
    const uploadsRoot = path.resolve(UPLOADS_DIR) + path.sep;
    if (!filePath.startsWith(uploadsRoot)) {
        return res.status(400).json({ error: 'Invalid upload path' });
    }

    if (req.body?.mapping === undefined) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        return res.status(400).json({ error: 'Missing mapping' });
    }

    let mapping = null;
    try {
        mapping = JSON.parse(req.body.mapping);
    } catch {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        return res.status(400).json({ error: 'Invalid mapping JSON' });
    }

    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        return res.status(400).json({ error: 'Invalid mapping' });
    }

    if (!mapping.timestamp || typeof mapping.timestamp !== 'string' || !mapping.timestamp.trim()) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        return res.status(400).json({ error: 'Invalid mapping (missing timestamp)' });
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');

    Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
             const rows = results.data;
             if (rows.length === 0) {
                 try { fs.unlinkSync(filePath); } catch { /* ignore */ }
                 return res.json({ success: true, imported: 0 });
             }

             // Sort rows by date to find min/max
             const dateRows = rows.map(r => ({ ...r, _d: new Date(r[mapping.timestamp]) }))
                                 .filter(r => !isNaN(r._d.getTime()));
                                 
             if (dateRows.length === 0) {
                 try { fs.unlinkSync(filePath); } catch { /* ignore */ }
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
                     try { fs.unlinkSync(filePath); } catch { /* ignore */ }
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
             try { fs.unlinkSync(filePath); } catch { /* ignore */ }
             res.status(500).json({ error: "CSV Parsing failed: " + err.message });
        }
    });
});

/**
 * PREVIEW CSV API
 * Returns the headers and first 5 rows to help user map columns
 */
app.post('/api/preview-csv', requireAdmin, upload.single('file'), (req, res) => {
    if (req.fileValidationError) {
        return res.status(400).json({ error: req.fileValidationError });
    }
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    // Keep all filesystem operations confined to UPLOADS_DIR.
    // Use path.basename() as a sanitizer that CodeQL recognizes.
    const safeFileName = path.basename(String(req.file.path || '')).toLowerCase();
    if (!safeFileName) {
        return res.status(400).json({ error: 'Invalid upload path' });
    }
    if (!/^[0-9a-f]{32}$/.test(safeFileName)) {
        return res.status(400).json({ error: 'Invalid upload path' });
    }
    const filePath = path.resolve(UPLOADS_DIR, safeFileName);
    const uploadsRoot = path.resolve(UPLOADS_DIR) + path.sep;
    if (!filePath.startsWith(uploadsRoot)) {
        return res.status(400).json({ error: 'Invalid upload path' });
    }

    let fileContent;
    try {
        fileContent = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        return res.status(400).json({ error: 'Failed to read uploaded file' });
    }
    
    // Parse partial
    Papa.parse(fileContent, {
        header: true,
        preview: 5,
        skipEmptyLines: true,
        complete: (results) => {
            try { fs.unlinkSync(filePath); } catch { /* ignore */ }
            res.json({ headers: results.meta.fields, preview: results.data });
        },
        error: (err) => {
             try { fs.unlinkSync(filePath); } catch { /* ignore */ }
             res.status(500).json({ error: err.message });
        }
    });
});

// Central error handler (important for multer upload limits and fileFilter errors)
app.use((err, req, res, next) => {
    if (!err) return next();
    if (res.headersSent) return next(err);

    const msg = String(err?.message || '');

    // Body parser / JSON errors
    if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
        return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    if (err?.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Request body too large' });
    }

    // Multer errors for uploads
    const isMulterError = err?.name === 'MulterError' || (multer && err instanceof multer.MulterError);
    if (isMulterError) {
        const code = err.code;
        if (code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File too large' });
        }
        if (code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files' });
        }
        if (code === 'LIMIT_FIELD_SIZE') {
            return res.status(413).json({ error: 'Request field too large' });
        }
        return res.status(400).json({ error: 'Upload failed' });
    }

    // fileFilter rejects
    if (msg.includes('Only CSV uploads are allowed')) {
        return res.status(400).json({ error: 'Only CSV uploads are allowed' });
    }

    // Default
    return res.status(500).json({ error: msg || 'Internal Server Error' });
});

app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

let httpServer = null;

let isShuttingDown = false;

// Graceful Shutdown: Close DB connection ensures journal is flushed
const shutdown = (exitProcess = true) => {
    console.log("Shutting down...");

    isShuttingDown = true;

    if (httpServer) {
        try {
            httpServer.close();
        } catch {
            // ignore
        }
        httpServer = null;
    }

    db.close((err) => {
        if (err) console.error("Error closing DB:", err.message);
        else console.log("Database connection closed.");
        if (exitProcess) process.exit(0);
    });
};

if (!IS_TEST && IS_MAIN) {
    httpServer = app.listen(PORT, '0.0.0.0', () => {
        console.log(`SunFlow Backend running on http://localhost:${PORT}`);
    });

    process.on('SIGINT', () => shutdown(true));
    process.on('SIGTERM', () => shutdown(true));
}

export { app, shutdown };
