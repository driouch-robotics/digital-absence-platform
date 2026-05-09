const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const dbPath = path.resolve(__dirname, 'attendance.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        // Users table
        db.run(`CREATE TABLE IF NOT EXISTS Users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            role TEXT CHECK(role IN ('admin', 'supervisor'))
        )`);

        // Settings table
        db.run(`CREATE TABLE IF NOT EXISTS Settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_name TEXT,
            academy TEXT,
            directorate TEXT,
            supervisor_name TEXT,
            logo_url TEXT
        )`);

        // Students table
        db.run(`CREATE TABLE IF NOT EXISTS Students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            massar_id TEXT UNIQUE,
            name TEXT,
            class_name TEXT,
            phone TEXT,
            parent_name TEXT
        )`);

        // Timetables table (Parsed from images)
        db.run(`CREATE TABLE IF NOT EXISTS Timetables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            class_name TEXT,
            day_of_week TEXT,
            period TEXT,
            session TEXT,
            subject TEXT
        )`);

        // Holidays table (Parsed from images)
        db.run(`CREATE TABLE IF NOT EXISTS Holidays (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            holiday_date TEXT UNIQUE,
            description TEXT
        )`);

        // Attendance table
        db.run(`CREATE TABLE IF NOT EXISTS Attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER,
            date TEXT,
            period TEXT,
            session TEXT,
            subject TEXT,
            status TEXT CHECK(status IN ('Absent', 'Late')),
            created_at TEXT,
            FOREIGN KEY (student_id) REFERENCES Students(id)
        )`);

        console.log('Database tables initialized.');
    });
}

// Helper to get current Moroccan time
const getMoroccanTime = () => dayjs().tz("Africa/Casablanca");

module.exports = { db, getMoroccanTime };
