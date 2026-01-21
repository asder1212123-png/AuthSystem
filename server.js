import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { exec } from 'child_process';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path (override with DB_PATH env var to use persistent storage)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'auth.db');
const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // Измените это!

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('Database error:', err);
  else console.log('Connected to SQLite database at', DB_PATH);
});

// Health check endpoint
app.get('/api/health', (req, res) => res.json({ ok: true, db: DB_PATH }));

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT,
      hwid TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      banned INTEGER DEFAULT 0,
      ban_reason TEXT,
      hwid_banned INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS hwid_bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hwid TEXT UNIQUE NOT NULL,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admin_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      username TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Helper functions
const promiseDb = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const promiseDbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

// Middleware to verify admin token
const verifyAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Not an admin' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Middleware to verify user token
const verifyUser = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Routes

// Admin login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || !password || username.length < 3) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const hashed = await bcrypt.hash(password, 10);
    
    await promiseDbRun(
      'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
      [username, hashed, email || null]
    );

    const token = jwt.sign({ username, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// User login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password, hwid } = req.body;

    const rows = await promiseDb('SELECT * FROM users WHERE username = ?', [username]);
    
    if (!rows.length) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = rows[0];

    if (user.banned) {
      return res.status(403).json({ error: `Account banned: ${user.ban_reason || 'No reason provided'}` });
    }

    // Проверка HWID бана
    if (hwid) {
      const hwidBanRows = await promiseDb('SELECT * FROM hwid_bans WHERE hwid = ?', [hwid]);
      if (hwidBanRows.length) {
        return res.status(403).json({ error: `HWID banned: ${hwidBanRows[0].reason || 'No reason provided'}` });
      }
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Проверка HWID - если уже есть другой HWID, отклоняем
    if (hwid) {
      if (user.hwid && user.hwid !== hwid) {
        return res.status(403).json({ error: 'This account is already registered on another computer' });
      }

      // Если HWID новый, сохраняем его
      if (!user.hwid || user.hwid !== hwid) {
        await promiseDbRun('UPDATE users SET hwid = ? WHERE id = ?', [hwid, user.id]);
      }
    }

    const token = jwt.sign({ username, role: 'user', hwid }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify token
app.get('/api/auth/verify', verifyUser, (req, res) => {
  res.json({ valid: true, username: req.user.username });
});

// Admin: Get all users
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const users = await promiseDb('SELECT id, username, email, hwid, created_at, banned, ban_reason, hwid_banned FROM users');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Create user
app.post('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await promiseDbRun(
      'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
      [username, hashed, email || null]
    );

    // Log action
    await promiseDbRun(
      'INSERT INTO admin_logs (action, username) VALUES (?, ?)',
      [`Created user: ${username}`, 'admin']
    );

    res.json({ id: result.lastID, username, email });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admin: Ban user
app.post('/api/admin/users/:id/ban', verifyAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const userId = req.params.id;

    await promiseDbRun(
      'UPDATE users SET banned = 1, ban_reason = ? WHERE id = ?',
      [reason || 'No reason provided', userId]
    );

    // Log action
    const user = await promiseDb('SELECT username FROM users WHERE id = ?', [userId]);
    await promiseDbRun(
      'INSERT INTO admin_logs (action, username) VALUES (?, ?)',
      [`Banned user: ${user[0].username}`, 'admin']
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Unban user
app.post('/api/admin/users/:id/unban', verifyAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    await promiseDbRun(
      'UPDATE users SET banned = 0, ban_reason = NULL WHERE id = ?',
      [userId]
    );

    // Log action
    const user = await promiseDb('SELECT username FROM users WHERE id = ?', [userId]);
    await promiseDbRun(
      'INSERT INTO admin_logs (action, username) VALUES (?, ?)',
      [`Unbanned user: ${user[0].username}`, 'admin']
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Delete user
app.delete('/api/admin/users/:id', verifyAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await promiseDb('SELECT username FROM users WHERE id = ?', [userId]);
    
    await promiseDbRun('DELETE FROM users WHERE id = ?', [userId]);

    // Log action
    await promiseDbRun(
      'INSERT INTO admin_logs (action, username) VALUES (?, ?)',
      [`Deleted user: ${user[0].username}`, 'admin']
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get logs
app.get('/api/admin/logs', verifyAdmin, async (req, res) => {
  try {
    const logs = await promiseDb('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 100');
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get HWID bans
app.get('/api/admin/hwid-bans', verifyAdmin, async (req, res) => {
  try {
    const bans = await promiseDb('SELECT * FROM hwid_bans ORDER BY created_at DESC');
    res.json(bans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Ban by HWID
app.post('/api/admin/hwid/:hwid/ban', verifyAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const hwid = req.params.hwid;

    await promiseDbRun(
      'INSERT OR IGNORE INTO hwid_bans (hwid, reason) VALUES (?, ?)',
      [hwid, reason || 'No reason provided']
    );

    // Log action
    await promiseDbRun(
      'INSERT INTO admin_logs (action, username) VALUES (?, ?)',
      [`Banned HWID: ${hwid}`, 'admin']
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Unban by HWID
app.post('/api/admin/hwid/:hwid/unban', verifyAdmin, async (req, res) => {
  try {
    const hwid = req.params.hwid;

    await promiseDbRun('DELETE FROM hwid_bans WHERE hwid = ?', [hwid]);

    // Log action
    await promiseDbRun(
      'INSERT INTO admin_logs (action, username) VALUES (?, ?)',
      [`Unbanned HWID: ${hwid}`, 'admin']
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Reset HWID for user
app.post('/api/admin/users/:id/reset-hwid', verifyAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await promiseDb('SELECT username FROM users WHERE id = ?', [userId]);
    
    await promiseDbRun(
      'UPDATE users SET hwid = NULL WHERE id = ?',
      [userId]
    );

    // Log action
    await promiseDbRun(
      'INSERT INTO admin_logs (action, username) VALUES (?, ?)',
      [`Reset HWID for user: ${user[0].username}`, 'admin']
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin: Export database dump (SQL)
app.get('/api/admin/export-db', verifyAdmin, async (req, res) => {
  try {
    exec(`sqlite3 "${DB_PATH}" .dump`, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) return res.status(500).json({ error: stderr || err.message });
      res.setHeader('Content-Disposition', 'attachment; filename="backup.sql"');
      res.setHeader('Content-Type', 'text/sql');
      res.send(stdout);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
