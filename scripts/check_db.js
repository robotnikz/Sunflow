import sqlite3 from 'sqlite3';
const db = new sqlite3.Database('sunflow-data/solar_data.db');
db.all('PRAGMA table_info(energy_data)', (err, rows) => {
    if (err) console.error(err);
    console.log('TABLE INFO:', JSON.stringify(rows, null, 2));
    db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='energy_data'", (err, row) => {
        if (err) console.error(err);
        console.log('SQL:', row ? row.sql : 'NOT FOUND');
        db.close();
    });
});
