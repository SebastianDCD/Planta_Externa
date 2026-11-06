const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Crear carpeta para guardar la base de datos
const dataDirectory = path.join(__dirname, '../data');

if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory);
}

// Crear o abrir la base de datos
const dbPath = path.join(dataDirectory, 'externa.db');

const db = new Database(dbPath);

// Activar llaves foráneas
db.pragma('foreign_keys = ON');

// Crear tabla de fases
db.exec(`
    CREATE TABLE IF NOT EXISTS phases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'En desarrollo'
    );
`);

// Crear tabla de NAP
db.exec(`
    CREATE TABLE IF NOT EXISTS naps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phase_id INTEGER NOT NULL,
        number INTEGER NOT NULL,
        meters INTEGER,
        status TEXT NOT NULL DEFAULT 'PENDING',

        FOREIGN KEY (phase_id) REFERENCES phases(id),
        UNIQUE (phase_id, number)
    );
`);

// Crear tabla de materiales por NAP
db.exec(`
    CREATE TABLE IF NOT EXISTS nap_materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nap_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 0,
        unit TEXT NOT NULL,

        FOREIGN KEY (nap_id) REFERENCES naps(id),
        UNIQUE (nap_id, name)
    );
`);

console.log('Base de datos SQLite conectada correctamente');

module.exports = db;