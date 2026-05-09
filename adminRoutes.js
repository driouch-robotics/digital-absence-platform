const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { db, getMoroccanTime } = require('./database');
const { parseTimetableImage, parseHolidayImage } = require('./visionService');

// Ensure uploads directory exists
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

// Dashboard Stats
router.get('/stats', (req, res) => {
    const today = getMoroccanTime().format('YYYY-MM-DD');
    const queries = {
        absentToday: `SELECT COUNT(*) as count FROM Attendance WHERE date = ? AND status = 'Absent'`,
        lateToday: `SELECT COUNT(*) as count FROM Attendance WHERE date = ? AND status = 'Late'`,
        totalStudents: `SELECT COUNT(*) as count FROM Students`
    };

    db.get(queries.absentToday, [today], (err, absent) => {
        if (err) { console.error("Stats Error (Absent):", err); return res.status(500).json({error: err.message}); }
        db.get(queries.lateToday, [today], (err, late) => {
            if (err) { console.error("Stats Error (Late):", err); return res.status(500).json({error: err.message}); }
            db.get(queries.totalStudents, [], (err, total) => {
                if (err) { console.error("Stats Error (Total):", err); return res.status(500).json({error: err.message}); }
                res.json({
                    absentToday: absent ? absent.count : 0,
                    lateToday: late ? late.count : 0,
                    totalStudents: total ? total.count : 0
                });
            });
        });
    });
});

// Recent Activity
router.get('/recent-activity', (req, res) => {
    const query = `
        SELECT a.*, s.name as student_name, s.class_name
        FROM Attendance a
        JOIN Students s ON a.student_id = s.id
        ORDER BY a.created_at DESC
        LIMIT 10
    `;
    db.all(query, [], (err, rows) => {
        if (err) { console.error("Recent Activity Error:", err); return res.status(500).json({ error: err.message }); }
        res.json(rows);
    });
});

// 1. Massar Excel Import
router.post('/upload/massar', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded." });
    }
    try {
        console.log(`Processing Massar file: ${req.file.originalname}`);
        const workbook = XLSX.readFile(req.file.path);
        let students = [];
        workbook.SheetNames.forEach(sheetName => {
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
            let start = false;
            let fnameIdx = -1, lnameIdx = -1, phoneIdx = -1, parentIdx = -1;

            rows.forEach(r => {
                let textRow = r.map(cell => String(cell || '').trim());
                if (!start && (textRow.includes('الاسم') || textRow.includes('الإسم'))) {
                    start = true;
                    fnameIdx = textRow.findIndex(c => c === 'الاسم' || c === 'الإسم');
                    lnameIdx = textRow.findIndex(c => c.includes('النسب'));
                    phoneIdx = textRow.findIndex(c => c.includes('هاتف'));
                    parentIdx = textRow.findIndex(c => c.includes('ولي'));
                } else if (start && fnameIdx > -1 && lnameIdx > -1) {
                    let fName = r[fnameIdx];
                    let lName = r[lnameIdx];
                    if (fName && lName) {
                        students.push({
                            name: `${fName} ${lName}`.trim(),
                            class_name: sheetName,
                            phone: phoneIdx > -1 ? r[phoneIdx] : '',
                            parent_name: parentIdx > -1 ? r[parentIdx] : ''
                        });
                    }
                }
            });
        });

        const stmt = db.prepare(`INSERT OR REPLACE INTO Students (name, class_name, phone, parent_name) VALUES (?, ?, ?, ?)`);
        students.forEach(s => stmt.run(s.name, s.class_name, s.phone, s.parent_name));
        stmt.finalize();

        fs.unlinkSync(req.file.path);
        console.log(`Successfully imported ${students.length} students.`);
        res.json({ message: `Successfully imported ${students.length} students across ${workbook.SheetNames.length} classes.` });
    } catch (err) {
        console.error("Massar Import Error:", err);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: err.message });
    }
});

// 2. Multi-Image Timetable Parsing (Returns Aggregated JSON)
router.post('/upload/timetable-preview', upload.array('images', 15), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No images uploaded." });
    }
    
    try {
        console.log(`Processing ${req.files.length} timetable images...`);
        let aggregatedData = [];
        
        for (const file of req.files) {
            try {
                const parsed = await parseTimetableImage(file.path);
                if (Array.isArray(parsed)) {
                    aggregatedData = aggregatedData.concat(parsed);
                }
            } catch (innerErr) {
                console.error(`Error parsing image ${file.originalname}:`, innerErr);
            } finally {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            }
        }
        
        console.log(`Aggregation complete. Found ${aggregatedData.length} total entries.`);
        res.json(aggregatedData);
    } catch (err) {
        console.error("Timetable Aggregation Error:", err);
        res.status(500).json({ error: "Failed to process images: " + err.message });
    }
});

// 3. Save Verified Timetable
router.post('/save/timetable', (req, res) => {
    try {
        const timetables = req.body;
        if (!Array.isArray(timetables)) return res.status(400).json({error: "Expected array of entries."});
        
        const stmt = db.prepare(`INSERT INTO Timetables (class_name, day_of_week, period, session, subject) VALUES (?, ?, ?, ?, ?)`);
        timetables.forEach(t => stmt.run(t.class_name, t.day_of_week, t.period, t.session, t.subject));
        stmt.finalize();
        res.json({ message: "Timetable saved successfully." });
    } catch (err) {
        console.error("Save Timetable Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// 4. Holiday Image Parsing
router.post('/upload/holidays-preview', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No image uploaded." });
    try {
        console.log(`Processing holiday image: ${req.file.originalname}`);
        const parsedData = await parseHolidayImage(req.file.path);
        fs.unlinkSync(req.file.path);
        res.json(parsedData);
    } catch (err) {
        console.error("Holiday Parse Error:", err);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: "Failed to parse holiday image: " + err.message });
    }
});

// 5. Save Verified Holidays
router.post('/save/holidays', (req, res) => {
    try {
        const holidays = req.body;
        const stmt = db.prepare(`INSERT OR REPLACE INTO Holidays (holiday_date, description) VALUES (?, ?)`);
        holidays.forEach(h => stmt.run(h.holiday_date, h.description));
        stmt.finalize();
        res.json({ message: "Holidays saved successfully." });
    } catch (err) {
        console.error("Save Holidays Error:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
