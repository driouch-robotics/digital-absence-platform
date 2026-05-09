const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');
const { db, getMoroccanTime } = require('./database');
const { parseTimetableImage, parseHolidayImage } = require('./visionService');

const upload = multer({ dest: 'uploads/' });

// Dashboard Stats
router.get('/stats', (req, res) => {
    const today = getMoroccanTime().format('YYYY-MM-DD');
    const queries = {
        absentToday: `SELECT COUNT(*) as count FROM Attendance WHERE date = ? AND status = 'Absent'`,
        lateToday: `SELECT COUNT(*) as count FROM Attendance WHERE date = ? AND status = 'Late'`,
        totalStudents: `SELECT COUNT(*) as count FROM Students`
    };

    db.get(queries.absentToday, [today], (err, absent) => {
        db.get(queries.lateToday, [today], (err, late) => {
            db.get(queries.totalStudents, [], (err, total) => {
                res.json({
                    absentToday: absent.count,
                    lateToday: late.count,
                    totalStudents: total.count
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
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 1. Massar Excel Import
router.post('/upload/massar', upload.single('file'), (req, res) => {
    try {
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

        // Batch insert into DB
        const stmt = db.prepare(`INSERT OR REPLACE INTO Students (name, class_name, phone, parent_name) VALUES (?, ?, ?, ?)`);
        students.forEach(s => stmt.run(s.name, s.class_name, s.phone, s.parent_name));
        stmt.finalize();

        fs.unlinkSync(req.file.path);
        res.json({ message: `Successfully imported ${students.length} students across ${workbook.SheetNames.length} classes.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Timetable Image Parsing (Returns JSON for review)
router.post('/upload/timetable-preview', upload.single('image'), async (req, res) => {
    try {
        const parsedData = await parseTimetableImage(req.file.path);
        fs.unlinkSync(req.file.path);
        res.json(parsedData);
    } catch (err) {
        res.status(500).json({ error: "Failed to parse timetable image: " + err.message });
    }
});

// 3. Save Verified Timetable
router.post('/save/timetable', (req, res) => {
    const timetables = req.body; // Array of {class_name, day_of_week, period, session, subject}
    const stmt = db.prepare(`INSERT INTO Timetables (class_name, day_of_week, period, session, subject) VALUES (?, ?, ?, ?, ?)`);
    timetables.forEach(t => stmt.run(t.class_name, t.day_of_week, t.period, t.session, t.subject));
    stmt.finalize();
    res.json({ message: "Timetable saved successfully." });
});

// 4. Holiday Image Parsing (Returns JSON for review)
router.post('/upload/holidays-preview', upload.single('image'), async (req, res) => {
    try {
        const parsedData = await parseHolidayImage(req.file.path);
        fs.unlinkSync(req.file.path);
        res.json(parsedData);
    } catch (err) {
        res.status(500).json({ error: "Failed to parse holiday image: " + err.message });
    }
});

// 5. Save Verified Holidays
router.post('/save/holidays', (req, res) => {
    const holidays = req.body; // Array of {holiday_date, description}
    const stmt = db.prepare(`INSERT OR REPLACE INTO Holidays (holiday_date, description) VALUES (?, ?)`);
    holidays.forEach(h => stmt.run(h.holiday_date, h.description));
    stmt.finalize();
    res.json({ message: "Holidays saved successfully." });
});

module.exports = router;
