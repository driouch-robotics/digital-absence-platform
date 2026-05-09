require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const { db, getMoroccanTime } = require('./database');
const adminRoutes = require('./adminRoutes');
const attendanceRoutes = require('./attendanceRoutes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, '/'))); // Serve frontend files from root

// Middleware to inject io into routes
app.use((req, res, next) => {
    req.io = io;
    next();
});

app.use('/api/admin', adminRoutes);
app.use('/api', attendanceRoutes);

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// Basic health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        time: getMoroccanTime().format('YYYY-MM-DD HH:mm:ss Z') 
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Current Moroccan Time: ${getMoroccanTime().format('YYYY-MM-DD HH:mm:ss Z')}`);
});
