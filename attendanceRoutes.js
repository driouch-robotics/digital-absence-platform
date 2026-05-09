const express = require('express');
const router = express.Router();
const { db, getMoroccanTime } = require('./database');
const axios = require('axios'); // For n8n webhook

// 1. Get All Classes
router.get('/classes', (req, res) => {
    db.all(`SELECT DISTINCT class_name FROM Students ORDER BY class_name`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => r.class_name));
    });
});

// 2. Get Students by Class (with attendance stats for badges)
router.get('/students/:className', (req, res) => {
    const className = req.params.className;
    const query = `
        SELECT s.*, 
               (SELECT COUNT(*) FROM Attendance WHERE student_id = s.id AND status = 'Absent') as absent_count,
               (SELECT COUNT(*) FROM Attendance WHERE student_id = s.id AND status = 'Late') as late_count
        FROM Students s
        WHERE s.class_name = ?
        ORDER BY s.name
    `;
    db.all(query, [className], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 3. Get Holidays
router.get('/holidays', (req, res) => {
    db.all(`SELECT holiday_date FROM Holidays`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => r.holiday_date));
    });
});

// 4. Get Timetable / Subject for a specific session
router.get('/timetable/lookup', (req, res) => {
    const { class_name, day_of_week, period, session } = req.query;
    db.get(`SELECT subject FROM Timetables WHERE class_name = ? AND day_of_week = ? AND period = ? AND session = ?`, 
        [class_name, day_of_week, period, session], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ subject: row ? row.subject : "غير محدد" });
    });
});

// 5. Get Settings
router.get('/settings', (req, res) => {
    db.get(`SELECT * FROM Settings LIMIT 1`, [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || {});
    });
});

// 6. Save Attendance & Trigger Webhook
router.post('/attendance', async (req, res) => {
    const { date, period, session, class_name, absentees, subject } = req.body;
    const createdAt = getMoroccanTime().format('YYYY-MM-DD HH:mm:ss');
    
    try {
        const stmt = db.prepare(`INSERT INTO Attendance (student_id, date, period, session, subject, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        
        for (const [studentId, status] of Object.entries(absentees)) {
            stmt.run(studentId, date, period, session, subject, status === 'غائب' ? 'Absent' : 'Late', createdAt);
            
            // Trigger n8n Webhook for Absences
            if (status === 'غائب' && process.env.N8N_WEBHOOK_URL) {
                // Fetch student details for the webhook
                db.get(`SELECT name, phone FROM Students WHERE id = ?`, [studentId], (err, student) => {
                    if (!err && student && student.phone) {
                        axios.post(process.env.N8N_WEBHOOK_URL, {
                            studentName: student.name,
                            parentPhone: student.phone,
                            date,
                            period,
                            session,
                            subject,
                            status: 'غائب'
                        }).catch(e => console.error("Webhook failed:", e.message));
                    }
                });
            }
        }
        stmt.finalize();

        // Broadcast update via socket.io (req.io is injected in server.js)
        req.io.emit('attendance_updated', { class_name, date, period, session });

        res.json({ message: "Attendance saved and notifications triggered." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
