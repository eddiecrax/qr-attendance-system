require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'qr-attendance-system-secret-2026';

app.set('trust proxy', true);

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function getHostUrl(req) {
  try {
    let proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    if (Array.isArray(proto)) proto = proto[0];

    let host = req.headers['x-forwarded-host'] || req.headers['host'] || `localhost:${PORT}`;
    if (Array.isArray(host)) host = host[0];

    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      const ip = getLocalIp();
      if (ip && ip !== 'localhost') {
        const portPart = host.includes(':') ? `:${host.split(':')[1]}` : `:${PORT}`;
        host = `${ip}${portPart}`;
      }
    }
    return `${proto}://${host}`;
  } catch (err) {
    return 'https://' + (req.headers['host'] || 'localhost');
  }
}


// ─── Database Setup (PostgreSQL / SQLite Dual Engine) ────────────
let dbDriver = 'sqlite';
let pgPool = null;
let sqliteDb = null;

const usePostgres = process.env.USE_POSTGRES === 'true' || Boolean(process.env.DATABASE_URL || process.env.DB_HOST);

if (usePostgres) {
  const { Pool } = require('pg');
  const pgConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'qr_attendance',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
      };

  pgPool = new Pool(pgConfig);
  dbDriver = 'postgres';
  console.log(`🔌 PostgreSQL mode enabled -> Host: ${pgConfig.host || 'URL'}, Database: ${pgConfig.database || 'default'}`);
} else {
  try {
    const Database = require('better-sqlite3');
    let dbPath;
    try {
      const dataDir = path.join(__dirname, 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      dbPath = path.join(dataDir, 'attendance.db');
      sqliteDb = new Database(dbPath);
    } catch (fsErr) {
      // Fallback for read-only serverless filesystems (e.g. Vercel, AWS Lambda)
      const tmpDir = os.tmpdir();
      dbPath = path.join(tmpDir, 'attendance.db');
      sqliteDb = new Database(dbPath);
    }
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('foreign_keys = ON');
    console.log(`📁 SQLite mode enabled -> ${dbPath}`);
  } catch (err) {
    console.warn('⚠️ SQLite driver (better-sqlite3) failed to load:', err.message);
  }
}


// Universal Async Query Helper
async function query(sql, params = []) {
  if (dbDriver === 'postgres') {
    const res = await pgPool.query(sql, params);
    return res.rows;
  } else {
    // Translate PostgreSQL $1, $2 placeholders to SQLite ?
    let sqliteSql = sql.replace(/\$\d+/g, '?');
    // Translate RETURNING id for SQLite if present
    const hasReturning = /RETURNING\s+id/i.test(sqliteSql);
    sqliteSql = sqliteSql.replace(/\s+RETURNING\s+id/i, '');
    
    // SQLite Date functions normalization
    sqliteSql = sqliteSql.replace(/::[a-z]+/gi, '');
    sqliteSql = sqliteSql.replace(/CURRENT_DATE/g, "date('now','localtime')");
    sqliteSql = sqliteSql.replace(/CURRENT_TIMESTAMP/g, "datetime('now','localtime')");
    sqliteSql = sqliteSql.replace(/ILIKE/g, "LIKE");
    sqliteSql = sqliteSql.replace(/ON CONFLICT \(student_id\) DO NOTHING/gi, "");
    if (sql.includes('ON CONFLICT (student_id) DO NOTHING')) {
      sqliteSql = sqliteSql.replace(/^INSERT INTO/i, 'INSERT OR IGNORE INTO');
    }

    const stmt = sqliteDb.prepare(sqliteSql);
    if (sqliteSql.trim().toUpperCase().startsWith('SELECT')) {
      return stmt.all(...params);
    } else {
      const res = stmt.run(...params);
      if (hasReturning) {
        return [{ id: res.lastInsertRowid }];
      }
      return res;
    }
  }
}

// Database Initialization
async function initDb() {
  if (dbDriver === 'postgres') {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(150) NOT NULL,
        role VARCHAR(50) DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(150) DEFAULT '',
        department VARCHAR(100) DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        description TEXT DEFAULT '',
        qr_token VARCHAR(100) UNIQUE NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        expires_at TIMESTAMP,
        is_active INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'present',
        UNIQUE(session_id, student_id)
      );
    `);
  } else {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        created_at DATETIME DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        email TEXT DEFAULT '',
        department TEXT DEFAULT '',
        created_at DATETIME DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        qr_token TEXT UNIQUE NOT NULL,
        created_by INTEGER,
        expires_at DATETIME,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        scanned_at DATETIME DEFAULT (datetime('now','localtime')),
        status TEXT DEFAULT 'present',
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (student_id) REFERENCES students(id),
        UNIQUE(session_id, student_id)
      );
    `);
  }

  // Seed default admin account
  const users = await query('SELECT id FROM users WHERE username = $1', ['admin']);
  if (!users || users.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await query(
      'INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4)',
      ['admin', hash, 'Administrator', 'admin']
    );
    console.log('✅ Default admin created: admin / admin123');
  }
}

// Initialize tables asynchronously
initDb().catch(err => {
  console.error('❌ Database Initialization Error:', err.message);
});

// ─── Cybersecurity & Rate Limiting Middleware ───────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const rateLimitMap = new Map();
function rateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  const maxRequests = 12;

  const record = rateLimitMap.get(ip) || { count: 0, resetTime: now + windowMs };
  if (now > record.resetTime) {
    record.count = 0;
    record.resetTime = now + windowMs;
  }
  record.count++;
  rateLimitMap.set(ip, record);

  if (record.count > maxRequests) {
    return res.status(429).json({ error: '⚠️ Rate limit exceeded. Too many requests. Please wait a minute.' });
  }
  next();
}

function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const header = req.headers['authorization'];
  const token = header && header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// ─── Auth Routes ─────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const users = await query('SELECT * FROM users WHERE username = $1', [username]);
    const user = users[0];
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token, user: { id: user.id, name: user.name, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/register', auth, async (req, res) => {
  const { username, password, name } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'All fields required' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    await query('INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4)', [username, hash, name, 'admin']);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: 'Username already exists' });
  }
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json(req.user);
});

// ─── Student Routes ──────────────────────────────────────────────
app.get('/api/students', auth, async (req, res) => {
  const { search, department } = req.query;
  let sql = 'SELECT * FROM students WHERE 1=1';
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    const pIdx = params.length;
    sql += ` AND (name ILIKE $${pIdx} OR student_id ILIKE $${pIdx} OR email ILIKE $${pIdx})`;
  }
  if (department) {
    params.push(department);
    sql += ` AND department = $${params.length}`;
  }
  sql += ' ORDER BY name ASC';

  try {
    const students = await query(sql, params);
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/students', auth, async (req, res) => {
  const { student_id, name, email, department } = req.body;
  if (!student_id || !name) return res.status(400).json({ error: 'Student ID and name are required' });
  try {
    const result = await query(
      'INSERT INTO students (student_id, name, email, department) VALUES ($1, $2, $3, $4) RETURNING id',
      [student_id, name, email || '', department || '']
    );
    const newId = result[0] ? result[0].id : null;
    res.json({ id: newId, student_id, name, email, department });
  } catch {
    res.status(400).json({ error: 'Student ID already exists' });
  }
});

app.put('/api/students/:id', auth, async (req, res) => {
  const { student_id, name, email, department } = req.body;
  try {
    await query(
      'UPDATE students SET student_id = $1, name = $2, email = $3, department = $4 WHERE id = $5',
      [student_id, name, email || '', department || '', req.params.id]
    );
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: 'Student ID already exists' });
  }
});

app.delete('/api/students/:id', auth, async (req, res) => {
  try {
    await query('DELETE FROM attendance WHERE student_id = $1', [req.params.id]);
    await query('DELETE FROM students WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/students/bulk', auth, async (req, res) => {
  const { students } = req.body;
  if (!students || !Array.isArray(students)) return res.status(400).json({ error: 'Invalid data' });

  let count = 0;
  for (const s of students) {
    if (!s.student_id || !s.name) continue;
    try {
      await query(
        'INSERT INTO students (student_id, name, email, department) VALUES ($1, $2, $3, $4) ON CONFLICT (student_id) DO NOTHING',
        [s.student_id, s.name, s.email || '', s.department || '']
      );
      count++;
    } catch (e) {
      // Ignore duplicates
    }
  }
  res.json({ imported: count, total: students.length });
});

// ─── Session Routes ──────────────────────────────────────────────
app.get('/api/sessions', auth, async (req, res) => {
  try {
    const sessions = await query(`
      SELECT s.*, u.name as creator_name,
        (SELECT COUNT(*) FROM attendance WHERE session_id = s.id) as attendance_count
      FROM sessions s
      LEFT JOIN users u ON s.created_by = u.id
      ORDER BY s.created_at DESC
    `);
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions', auth, async (req, res) => {
  const { title, description, duration_minutes } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const qr_token = uuidv4();
  const expires_at = duration_minutes
    ? new Date(Date.now() + duration_minutes * 60000).toISOString()
    : null;

  try {
    const result = await query(
      'INSERT INTO sessions (title, description, qr_token, created_by, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [title, description || '', qr_token, req.user.id, expires_at]
    );
    const newId = result[0] ? result[0].id : null;
    res.json({ id: newId, title, description, qr_token, expires_at, is_active: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/sessions/:id/toggle', auth, async (req, res) => {
  try {
    const sessions = await query('SELECT is_active FROM sessions WHERE id = $1', [req.params.id]);
    if (!sessions || sessions.length === 0) return res.status(404).json({ error: 'Session not found' });
    
    const newState = sessions[0].is_active ? 0 : 1;
    await query('UPDATE sessions SET is_active = $1 WHERE id = $2', [newState, req.params.id]);
    res.json({ success: true, is_active: newState });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', auth, async (req, res) => {
  try {
    await query('DELETE FROM attendance WHERE session_id = $1', [req.params.id]);
    await query('DELETE FROM sessions WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── QR Code Routes ─────────────────────────────────────────────
app.get('/api/sessions/:id/qr', auth, async (req, res) => {
  try {
    const sessId = parseInt(req.params.id, 10);
    const sessions = await query('SELECT * FROM sessions WHERE id = $1', [sessId]);
    if (!sessions || sessions.length === 0) return res.status(404).json({ error: 'Session not found' });
    const session = sessions[0];

    const scanUrl = `${getHostUrl(req)}/scan.html?token=${session.qr_token}`;
    const qrDataUrl = await QRCode.toDataURL(scanUrl, {
      width: 512,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' },
      errorCorrectionLevel: 'H'
    });
    res.json({ qr: qrDataUrl, url: scanUrl, token: session.qr_token, title: session.title });
  } catch (err) {
    console.error('QR Generation Error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate QR code' });
  }
});

app.get('/api/sessions/:id/qr.png', auth, async (req, res) => {
  try {
    const sessId = parseInt(req.params.id, 10);
    const sessions = await query('SELECT * FROM sessions WHERE id = $1', [sessId]);
    if (!sessions || sessions.length === 0) return res.status(404).json({ error: 'Session not found' });
    const session = sessions[0];

    const scanUrl = `${getHostUrl(req)}/scan.html?token=${session.qr_token}`;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="qr-${session.title.replace(/[^a-z0-9]/gi, '_')}.png"`);
    await QRCode.toFileStream(res, scanUrl, { width: 800, margin: 3, errorCorrectionLevel: 'H' });
  } catch (err) {
    console.error('QR File Stream Error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate QR code' });
  }
});


// ─── Attendance Routes (Public) ─────────────────────────────────
app.get('/api/sessions/verify/:token', async (req, res) => {
  try {
    const sessions = await query('SELECT id, title, description, is_active, expires_at, created_at FROM sessions WHERE qr_token = $1', [req.params.token]);
    if (!sessions || sessions.length === 0) return res.status(404).json({ error: 'Invalid QR code / session not found' });

    const session = sessions[0];
    const expired = session.expires_at && new Date(session.expires_at) < new Date();
    res.json({ ...session, expired });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/attendance/mark', rateLimit, async (req, res) => {
  const token = sanitizeInput(req.body.token);
  const name = sanitizeInput(req.body.name || req.body.student_name);
  const email = sanitizeInput(req.body.email || '');
  let student_id = sanitizeInput(req.body.student_id || '');

  if (!token) return res.status(400).json({ error: 'Session token is required' });
  if (!name && !student_id) return res.status(400).json({ error: 'Please enter your Full Name' });

  try {
    const sessions = await query('SELECT * FROM sessions WHERE qr_token = $1', [token]);
    if (!sessions || sessions.length === 0) return res.status(404).json({ error: 'Invalid QR code session' });
    const session = sessions[0];

    if (!session.is_active) return res.status(400).json({ error: 'This attendance session is locked/inactive' });
    if (session.expires_at && new Date(session.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This attendance QR code has expired' });
    }

    let student = null;

    // Search by student_id or name/email
    if (student_id) {
      const found = await query('SELECT * FROM students WHERE student_id = $1', [student_id]);
      if (found && found.length > 0) student = found[0];
    }
    if (!student && name) {
      const found = await query('SELECT * FROM students WHERE LOWER(name) = LOWER($1)', [name]);
      if (found && found.length > 0) student = found[0];
    }

    // Auto-create student record if not found
    if (!student) {
      const generatedId = student_id || `STU-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random()*1000)}`;
      const studentName = name || student_id;
      
      const insertRes = await query(
        'INSERT INTO students (student_id, name, email, department) VALUES ($1, $2, $3, $4) RETURNING id',
        [generatedId, studentName, email, 'Cybersecurity Session']
      );
      const newId = insertRes[0] ? insertRes[0].id : null;
      student = { id: newId, student_id: generatedId, name: studentName, email };
    }

    // Check duplicate attendance
    const existing = await query('SELECT id FROM attendance WHERE session_id = $1 AND student_id = $2', [session.id, student.id]);
    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'Attendance already recorded for this session', student_name: student.name });
    }

    // Record attendance
    await query('INSERT INTO attendance (session_id, student_id, status) VALUES ($1, $2, $3)', [session.id, student.id, 'present']);

    res.json({
      success: true,
      message: `Attendance recorded successfully`,
      student_name: student.name,
      session_title: session.title,
      timestamp: new Date().toLocaleString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Reports Routes (Protected) ─────────────────────────────────
app.get('/api/stats', auth, async (req, res) => {
  try {
    const totalStudents = parseInt((await query('SELECT COUNT(*) as c FROM students'))[0]?.c || 0, 10);
    const totalSessions = parseInt((await query('SELECT COUNT(*) as c FROM sessions'))[0]?.c || 0, 10);
    const activeSessions = parseInt((await query('SELECT COUNT(*) as c FROM sessions WHERE is_active = 1'))[0]?.c || 0, 10);
    const totalAttendance = parseInt((await query('SELECT COUNT(*) as c FROM attendance'))[0]?.c || 0, 10);
    
    let todayAttendance = 0;
    if (dbDriver === 'postgres') {
      todayAttendance = parseInt((await query('SELECT COUNT(*) as c FROM attendance WHERE scanned_at::date = CURRENT_DATE'))[0]?.c || 0, 10);
    } else {
      todayAttendance = parseInt((await query("SELECT COUNT(*) as c FROM attendance WHERE date(scanned_at) = date('now','localtime')"))[0]?.c || 0, 10);
    }

    const recentAttendance = await query(`
      SELECT a.scanned_at, s.name as student_name, s.student_id, sess.title as session_title
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN sessions sess ON a.session_id = sess.id
      ORDER BY a.scanned_at DESC LIMIT 10
    `);

    res.json({ totalStudents, totalSessions, activeSessions, totalAttendance, todayAttendance, recentAttendance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/attendance/session/:id', auth, async (req, res) => {
  try {
    const sessions = await query('SELECT * FROM sessions WHERE id = $1', [req.params.id]);
    if (!sessions || sessions.length === 0) return res.status(404).json({ error: 'Session not found' });

    const attendance = await query(`
      SELECT a.id, a.scanned_at, a.status,
             s.name as student_name, s.student_id, s.department, s.email
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      WHERE a.session_id = $1
      ORDER BY a.scanned_at DESC
    `, [req.params.id]);

    res.json({ session: sessions[0], attendance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports', auth, async (req, res) => {
  const { from, to, department, session_id } = req.query;
  let sql = `
    SELECT a.id, a.scanned_at, a.status,
           s.name as student_name, s.student_id, s.department, s.email,
           sess.title as session_title, sess.id as session_id
    FROM attendance a
    JOIN students s ON a.student_id = s.id
    JOIN sessions sess ON a.session_id = sess.id
    WHERE 1=1
  `;
  const params = [];

  if (from) {
    params.push(from);
    const dateClause = dbDriver === 'postgres' ? `a.scanned_at::date >= $${params.length}` : `date(a.scanned_at) >= $${params.length}`;
    sql += ` AND ${dateClause}`;
  }
  if (to) {
    params.push(to);
    const dateClause = dbDriver === 'postgres' ? `a.scanned_at::date <= $${params.length}` : `date(a.scanned_at) <= $${params.length}`;
    sql += ` AND ${dateClause}`;
  }
  if (department) {
    params.push(department);
    sql += ` AND s.department = $${params.length}`;
  }
  if (session_id) {
    params.push(parseInt(session_id, 10));
    sql += ` AND a.session_id = $${params.length}`;
  }
  sql += ' ORDER BY a.scanned_at DESC LIMIT 1000';

  try {
    const reports = await query(sql, params);
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/departments', auth, async (req, res) => {
  try {
    const depts = await query("SELECT DISTINCT department FROM students WHERE department IS NOT NULL AND department != '' ORDER BY department");
    res.json(depts.map(d => d.department));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Fallback ────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start Server ────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    const localIp = getLocalIp();
    console.log(`\n  ╔══════════════════════════════════════════════════╗`);
    console.log(`  ║   🎯 QR Attendance System v1.0                   ║`);
    console.log(`  ║   💻 Local:   http://localhost:${PORT}               ║`);
    console.log(`  ║   📱 Mobile:  http://${localIp}:${PORT}`.padEnd(53) + `║`);
    console.log(`  ║   🗄️ Database: ${dbDriver.toUpperCase()}`.padEnd(53) + `║`);
    console.log(`  ║   👤 Admin: admin / admin123                      ║`);
    console.log(`  ╚══════════════════════════════════════════════════╝\n`);
  });
}

module.exports = app;
