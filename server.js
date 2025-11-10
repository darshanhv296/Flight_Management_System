
// ============================================================
// Flight Management System v2.4 — JARVIS Edition (Unified 2-in-1)
// ============================================================

require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

// Import DB connection (expects dbconfig.js exporting a mysql2 connection/pool)
const db = require("./dbconfig");

const app = express();
const PORT = 3003; // Use 3003 to avoid EADDRINUSE on 3002

// Configure separate session stores for users and admins
const MySQLStore = require('express-mysql-session')(session);

// Increase MaxListeners limit for MySQL stores
const maxListeners = 50;
// Configure event emitter limits globally
const events = require('events');
events.EventEmitter.defaultMaxListeners = 50;

// Create separate stores with different table names
const userSessionStore = new MySQLStore({
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: 7 * 24 * 60 * 60 * 1000,
  createDatabaseTable: true,
  schema: {
    tableName: 'user_sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
}, db.pool);

const adminSessionStore = new MySQLStore({
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: 7 * 24 * 60 * 60 * 1000,
  createDatabaseTable: true,
  schema: {
    tableName: 'admin_sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
}, db.pool);

// Tune listener limits on stores
userSessionStore.setMaxListeners(maxListeners);
adminSessionStore.setMaxListeners(maxListeners);

// Session configuration factory (use appropriate store per role)
const sessionConfig = (isAdmin = false) => ({
  store: isAdmin ? adminSessionStore : userSessionStore,
  secret: process.env.SESSION_SECRET || 'supersecretkey',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  name: isAdmin ? 'admin.sid' : 'user.sid',
  cookie: {
    secure: false,
    httpOnly: true,
    path: isAdmin ? '/admin' : '/',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
});

// Common middleware (CORS, body parsing and cookies)
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// Apply default session middleware (user sessions by default)
app.use(session(sessionConfig(false)));
// Configure session store with cleanup and error handling
const sessionStore = new MySQLStore({
  clearExpired: true,
  checkExpirationInterval: 900000, // Clean up every 15 minutes
  expiration: 7 * 24 * 60 * 60 * 1000, // 7 days
  createDatabaseTable: true,
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
}, db.pool);
// Handle session store errors (register once)
sessionStore.on('error', function(error) {
  console.error('Session store error:', error);
});

// Set a higher limit for session store event listeners
sessionStore.setMaxListeners(maxListeners);

app.use(async (req, res, next) => {
  try {
    // Skip session check for static assets
    if (req.path.match(/\.(css|js|jpg|png|ico)$/)) {
      return next();
    }

    // If no session but remember-me cookie exists
    if (!req.session.user && req.cookies && req.cookies.remember) {
      const token = req.cookies.remember;
      const [rows] = await dbp.query(
        'SELECT user_id, username, email, role FROM users WHERE remember_token = ? AND last_login > DATE_SUB(NOW(), INTERVAL 30 DAY) LIMIT 1', 
        [token]
      );
      
      if (rows && rows.length > 0) {
        const u = rows[0];
        // Create new session
        req.session.user = { 
          user_id: u.user_id, 
          username: u.username, 
          email: u.email,
          role: u.role,
          loginTime: Date.now()
        };
        
        // Refresh login timestamp and generate new token
        try {
          const newToken = crypto.randomBytes(32).toString('hex');
          await dbp.query(
            'UPDATE users SET last_login = NOW(), remember_token = ? WHERE user_id = ?', 
            [newToken, u.user_id]
          );
          
          // Set new cookie
          res.cookie('remember', newToken, { 
            httpOnly: true, 
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            sameSite: 'lax', 
            path: '/' 
          });
        } catch(e) {
          console.warn('Session refresh error:', e.message || e);
        }
      }
    }
  } catch (e) {
    console.warn('Remember-me middleware error:', e.message || e);
  }
  next();
});

// Static files with no-cache headers (after session middleware)
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, path) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
}));

// Get the database connection wrapper
const dbp = db.promise;
const pool = db.pool;

// Ensure bookings table has required columns (idempotent startup migration)
async function ensureBookingColumns() {
  try {
    const needed = [
      { name: 'reason', def: 'TEXT' },
      { name: 'cancelReason', def: 'TEXT' }
    ];

    for (const col of needed) {
      const [rows] = await dbp.query("SHOW COLUMNS FROM bookings LIKE ?", [col.name]);
      if (!rows || rows.length === 0) {
        console.log(`Adding missing column to bookings: ${col.name}`);
        await dbp.query(`ALTER TABLE bookings ADD COLUMN ${col.name} ${col.def}`);
      }
    }
    // Ensure status and cancelled columns exist (safe-guard)
    const [srows] = await dbp.query("SHOW COLUMNS FROM bookings LIKE 'status'");
    if (!srows || srows.length === 0) {
      console.log('Adding missing column to bookings: status');
      await dbp.query("ALTER TABLE bookings ADD COLUMN status VARCHAR(20) DEFAULT 'Confirmed'");
    }
    const [crows] = await dbp.query("SHOW COLUMNS FROM bookings LIKE 'cancelled'");
    if (!crows || crows.length === 0) {
      console.log('Adding missing column to bookings: cancelled');
      await dbp.query("ALTER TABLE bookings ADD COLUMN cancelled BOOLEAN DEFAULT FALSE");
    }
    // Ensure updated_at exists (used in queries) - add nullable timestamp if missing
    const [urows] = await dbp.query("SHOW COLUMNS FROM bookings LIKE 'updated_at'");
    if (!urows || urows.length === 0) {
      console.log('Adding missing column to bookings: updated_at');
      // Use DATETIME to be compatible across MySQL versions
      await dbp.query("ALTER TABLE bookings ADD COLUMN updated_at DATETIME NULL DEFAULT NULL");
    }
  } catch (err) {
    // Log but do not stop server — table may not exist yet or permission issues
    console.warn('Warning: could not ensure bookings columns:', err.message || err);
  }
}

// Run DB schema ensures
ensureBookingColumns().catch(() => {});
ensureUsersLastLogin().catch(() => {});
ensureUsersRememberToken().catch(() => {});

// Ensure users table has last_login column to track recent logins
async function ensureUsersLastLogin() {
  try {
    const [rows] = await dbp.query("SHOW COLUMNS FROM users LIKE 'last_login'");
    if (!rows || rows.length === 0) {
      console.log('Adding last_login column to users table');
      await dbp.query("ALTER TABLE users ADD COLUMN last_login DATETIME NULL DEFAULT NULL");
    }
  } catch (err) {
    console.warn('Could not ensure users.last_login column:', err.message || err);
  }
}

// Ensure users table has remember_token column to support persistent login
async function ensureUsersRememberToken() {
  try {
    const [rows] = await dbp.query("SHOW COLUMNS FROM users LIKE 'remember_token'");
    if (!rows || rows.length === 0) {
      console.log('Adding remember_token column to users table');
      await dbp.query("ALTER TABLE users ADD COLUMN remember_token VARCHAR(255) NULL DEFAULT NULL");
    }
  } catch (err) {
    console.warn('Could not ensure users.remember_token column:', err.message || err);
  }
}


// ============================================================
// Helpers
// ============================================================
function formatDate(date) {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d)) return date;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}
function generateTicketId() {
  return `TKT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// ============================================================
// Root
// ============================================================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ============================================================
// AUTH: Admin & User
// ============================================================

// ============================================================
// 🧩 AUTHENTICATION ROUTES (Admin + User)
// ============================================================

// ---------------------------
// Admin Login with session handling and validation
// ---------------------------
app.post("/admin/login", async (req, res) => {
  const { username, password } = req.body;
    
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: "Username and password are required"
    });
  }

  // Read admin credentials from environment, fallback to defaults
  const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    // Set admin session data directly
    req.session.admin = { 
      username, 
      role: "admin",
      loginTime: Date.now()
    };

    // Save session explicitly
    await new Promise((resolve) => {
      req.session.save(resolve);
    });

    console.log('🔐 Admin login successful:', username);
    return res.json({
      success: true,
      role: "admin",
      message: "Admin login successful",
      username
    });
      const MySQLStore = require('express-mysql-session')(session);
  }

  console.warn('❌ Failed admin login attempt:', username);
  return res.json({
    success: false,
    error: "Invalid admin credentials"
  });
});


// ============================================================
// 👤 USER REGISTRATION — with short user_id (U00X format)
// ============================================================
app.post("/user/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.json({ success: false, error: "All fields are required" });
    }

    // Check if user exists
    const [existingUsers] = await dbp.query(
      "SELECT user_id FROM users WHERE username = ? OR email = ? LIMIT 1",
      [username, email]
    );

    if (existingUsers.length > 0) {
      return res.json({ success: false, error: "Username or email already exists" });
    }

    // Get the latest user_id and generate next one
    const [lastUser] = await dbp.query(
      "SELECT user_id FROM users ORDER BY created_at DESC LIMIT 1"
    );

    let newUserId = "U001";
    if (lastUser.length > 0) {
      const lastId = lastUser[0].user_id; // e.g. "U005"
      const nextNum = parseInt(lastId.replace("U", "")) + 1;
      newUserId = "U" + nextNum.toString().padStart(3, "0");
    }

    // Insert new user with last_login timestamp
    await dbp.query(
      "INSERT INTO users (user_id, username, email, password, role, last_login) VALUES (?, ?, ?, ?, 'user', NOW())",
      [newUserId, username, email, password]
    );

    // Create initial profile with timestamp
    await dbp.query(
      "INSERT INTO user_profiles (user_id) VALUES (?)",
      [newUserId]
    );

  // Create session for the newly registered user so they are logged in immediately
      if (!req.session) req.session = {};
      req.session.user = {
        user_id: newUserId,
        username,
        email,
        role: 'user',
        loginTime: Date.now()
      };
      
      // Create remember token for persistent login
      const token = crypto.randomBytes(32).toString('hex');
      try {
        await dbp.query('UPDATE users SET remember_token = ? WHERE user_id = ?', [token, newUserId]);
        res.cookie('remember', token, { 
          httpOnly: true, 
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
          sameSite: 'lax', 
          path: '/' 
        });
      } catch (e) {
        console.warn('Could not create remember token:', e.message || e);
      }

      // Save session and respond
      try {
        await new Promise((resolve, reject) => {
          req.session.save((saveErr) => {
            if (saveErr) return reject(saveErr);
            resolve();
          });
        });
        console.log(`✅ User registered & logged in: ${username} (${newUserId})`);
        return res.json({ success: true, message: 'User registered and logged in', user_id: newUserId, user: req.session.user });
      } catch (sessErr) {
        console.error('Registration session handling error:', sessErr);
        // User created but session save failed; return success but indicate session unavailable
        return res.json({ success: true, message: 'User registered (session unavailable)', user_id: newUserId });
      }

  } catch (err) {
    console.error("Registration Error:", err);
    return res.status(500).json({
      success: false,
      error: "Database error during registration"
    });
  }
});


// ---------------------------
// User Login with improved session handling
// ---------------------------
app.post("/user/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username & password required"
      });
    }

    // Check credentials
    const [results] = await dbp.query(
      "SELECT user_id, username, email, role FROM users WHERE username = ? AND password = ? LIMIT 1",
      [username, password]
    );

    if (results.length === 0) {
      return res.json({
        success: false,
        error: "Invalid credentials"
      });
    }

    const user = results[0];
    
    // Set session data directly
    req.session.user = {
      user_id: user.user_id,
      username: user.username,
      role: user.role,
      loginTime: Date.now()
    };

    // Save session explicitly
    await new Promise((resolve) => {
      req.session.save(resolve);
    });

    // Update last_login in DB
    try {
      await dbp.query("UPDATE users SET last_login = NOW() WHERE user_id = ?", [user.user_id]);
    } catch (e) {
      console.warn('Could not update last_login:', e.message || e);
    }

    // Create remember token
    const token = crypto.randomBytes(32).toString('hex');
    try {
      await dbp.query('UPDATE users SET remember_token = ? WHERE user_id = ?', [token, user.user_id]);
      res.cookie('remember', token, { 
        httpOnly: true, 
        maxAge: 30 * 24 * 60 * 60 * 1000, 
        sameSite: 'lax', 
        path: '/' 
      });
    } catch (e) {
      console.warn('Could not create remember token:', e.message || e);
    }

    console.log('👤 User login successful:', user.username);
    return res.json({ 
      success: true, 
      message: 'Login successful', 
      user 
    });

  } catch (err) {
    console.error("Login Error:", err);
    return res.status(500).json({
      success: false,
      error: "Database error during login"
    });
  }
});

// ---------------------------
// Enhanced logout with proper session handling
// ---------------------------
app.post("/logout", async (req, res) => {
  try {
    // Determine if this is an admin logout
    const isAdminLogout = req.path.startsWith('/admin') || (req.session && req.session.admin);
    const sessionStore = isAdminLogout ? adminSessionStore : userSessionStore;
    const sessionCookie = isAdminLogout ? 'admin.sid' : 'user.sid';

    // Get session data before destroying
    let sessionData;
    try {
      sessionData = await getSessionData(req.sessionID, isAdminLogout);
    } catch (e) {
      console.warn('Could not fetch session data during logout:', e);
    }

    // Revoke remember token if present (only for user sessions)
    if (!isAdminLogout) {
      try {
        if (sessionData && sessionData.user && sessionData.user.user_id) {
          await dbp.query('UPDATE users SET remember_token = NULL WHERE user_id = ?', [sessionData.user.user_id]);
        } else if (req.cookies && req.cookies.remember) {
          const token = req.cookies.remember;
          await dbp.query('UPDATE users SET remember_token = NULL WHERE remember_token = ?', [token]);
        }
      } catch (e) {
        console.warn('Could not clear remember_token during logout:', e.message || e);
      }
    }

    // Clear cookies
    res.clearCookie(sessionCookie, {
      path: isAdminLogout ? '/admin' : '/',
      httpOnly: true
    });
    if (!isAdminLogout) {
      try { res.clearCookie('remember', { path: '/' }); } catch (e) {}
    }

    // Destroy session
    await new Promise((resolve, reject) => {
      sessionStore.destroy(req.sessionID, (err) => {
        if (err) {
          console.warn('Session destroy error on logout:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });

    console.log(`🚪 ${isAdminLogout ? 'Admin' : 'User'} logout successful`);
    return res.json({ 
      success: true, 
      message: 'Logged out successfully' 
    });

  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ 
      success: false, 
      error: 'Logout failed' 
    });
  }
});

// =============================================
// 🧍 FETCH USER ID BY USERNAME OR EMAIL
// =============================================
app.post("/api/get-user-id", async (req, res) => {
  const { username, email } = req.body;

  if (!username && !email) {
    return res.status(400).json({
      success: false,
      message: "Username or email is required"
    });
  }

  try {
    const query = `
      SELECT user_id, username, email, role 
      FROM users 
      WHERE username = ? OR email = ?
      LIMIT 1
    `;
    
  const [rows] = await dbp.query(query, [username || email, email || username]);
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found. Please register first."
      });
    }

    res.json({
      success: true,
      user_id: rows[0].user_id,
      username: rows[0].username,
      email: rows[0].email,
      role: rows[0].role
    });
  } catch (err) {
    console.error("Error fetching user ID:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// support 
// Express route in server.js
app.post('/api/support', (req, res) => {
    const { username, email, issue } = req.body;
    const sql = 'INSERT INTO support (username, email, message, status) VALUES (?, ?, ?, ?)';
    db.query(sql, [username, email, issue, 'pending'], (err, result) => {
        if (err) return res.status(500).send('DB Error');
        res.status(200).send('Issue submitted');
    });
});


// No guest users allowed - must register first

// Get latest user ID
app.get("/api/users/latest-id", async (req, res) => {
  try {
    const [rows] = await dbp.query(
      "SELECT user_id FROM users WHERE user_id LIKE 'U%' ORDER BY user_id DESC LIMIT 1"
    );
    res.json({
      success: true,
      lastId: rows[0]?.user_id || "U000"
    });
  } catch (err) {
    console.error("Error fetching latest user ID:", err);
    res.json({
      success: false,
      message: err.message
    });
  }
});

// Info route with persistent session handling
app.get("/info", (req, res) => {
  try {
    // Ensure session exists
    if (!req.session) {
      return res.json({ role: "guest" });
    }

    // Check for admin session first
    if (req.session.admin && req.session.admin.username) {
      return res.json({ 
        role: "admin", 
        username: req.session.admin.username,
        loginTime: req.session.admin.loginTime,
        persistent: true
      });
    }
    
    // Check for user session
    if (req.session.user && req.session.user.user_id) {
      return res.json({ 
        role: "user", 
        user: req.session.user,
        persistent: true
      });
    }

    // No valid session found
    return res.json({ role: "guest" });

  } catch (error) {
    console.error('Session check error:', error);
    // On error, return guest to prevent login issues
    return res.json({ role: "guest" });
  }
});// ============================================================
// FLIGHTS: CRUD & Search (basic)
// ============================================================

app.get("/flights", async (req, res) => {
  try {
  const [rows] = await dbp.query("SELECT * FROM flights");
    const formatted = rows.map(r => ({ ...r, date: formatDate(r.date) }));
    res.json({ success: true, flights: formatted });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ success: false, error: "DB Error" });
  }
});

app.post("/flights/search", (req, res) => {
  const { source, destination } = req.body;
  if (!source || !destination) return res.json({ success: false, error: "Source & Destination required" });
  db.query("SELECT * FROM flights WHERE source = ? AND destination = ?", [source, destination], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: "DB Error" });
    const formatted = rows.map(r => ({ ...r, date: formatDate(r.date) }));
    res.json({ success: true, flights: formatted });
  });
});

app.post("/flights/add", (req, res) => {
  if (!req.session.admin) return res.status(403).json({ success: false, error: "Unauthorized" });
  const { flight_id, flight_name, source, destination, price, date, duration, aircraft_id } = req.body;
  if (!flight_id || !flight_name || !source || !destination) return res.json({ success: false, error: "Missing fields" });

  const sql = "INSERT INTO flights (flight_id, flight_name, source, destination, price, date, duration, aircraft_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
  db.query(sql, [flight_id, flight_name, source, destination, price, date, duration, aircraft_id], (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, message: "Flight added" });
  });
});


// ============================================================
// 🎫 BOOKINGS: Save, Fetch, Cancel, Stream — FINAL FIXED
// ============================================================

// Generate unique ticket IDs (TKT- + timestamp)
function generateTicketId() {
  return "TKT-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
}

// ✅ Save or Update Booking (called from ticket.html)
app.post("/bookings/save", async (req, res) => {
  try {
    const body = req.body || {};
    let {
      user_id: bodyUserId,
      ticket_id,
      flight_id,
      flight_name,
      source,
      destination,
      date,
      duration,
      class_type,
      price,
      username: bodyUsername,
      cancelled,
      cancelReason
    } = body;

    // Prefer session user id when available
    const sessionUser = req.session && req.session.user ? req.session.user : null;
    const effectiveUserId = sessionUser?.user_id || bodyUserId || null;
    const effectiveUsername = sessionUser?.username || bodyUsername || null;

    // Ensure ticket id exists
    const finalTicket = ticket_id || generateTicketId();

    if (!flight_id || !price) {
      return res.status(400).json({ success: false, error: 'Missing flight_id or price' });
    }

    // Require an authenticated session user. Do not auto-create guest users.
    if (!effectiveUserId) {
      return res.status(401).json({ success: false, error: 'Please log in to book tickets' });
    }
    const userIdToUse = effectiveUserId;

    // Upsert booking: if ticket exists update, else insert
    const [existing] = await dbp.query("SELECT id FROM bookings WHERE ticket_id = ? LIMIT 1", [finalTicket]);
    if (existing.length > 0) {
      await dbp.query(
        `UPDATE bookings SET user_id = ?, flight_id = ?, flight_name = ?, source = ?, destination = ?, date = ?, duration = ?, class_type = ?, price = ?, username = ?, cancelled = ?, status = ?, reason = ?, updated_at = NOW() WHERE ticket_id = ?`,
        [userIdToUse, flight_id, flight_name, source, destination, date, duration, class_type, price, effectiveUsername, cancelled ? 1 : 0, cancelled ? 'Cancelled' : 'Confirmed', cancelReason || null, finalTicket]
      );
      console.log(`✅ Booking updated: ${finalTicket} (user ${userIdToUse})`);
      return res.json({ success: true, message: 'Booking updated', ticket_id: finalTicket, user_id: userIdToUse });
    }

    const [result] = await dbp.query(
      `INSERT INTO bookings (user_id, ticket_id, flight_id, flight_name, source, destination, date, duration, class_type, price, username, status, cancelled, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed', 0, ?, NOW())`,
      [userIdToUse, finalTicket, flight_id, flight_name, source, destination, date, duration, class_type, price, effectiveUsername, cancelReason || null]
    );

    console.log(`✅ Booking stored: ${finalTicket} (user ${userIdToUse})`);
    return res.json({ success: true, message: 'Booking stored successfully', ticket_id: finalTicket, booking_id: result.insertId, user_id: userIdToUse });
  } catch (err) {
    console.error('Booking save error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Alternate (compatibility)
app.post("/bookings/add", (req, res) => {
  req.body.ticket_id = req.body.ticket_id || generateTicketId();
  app.handle(req, res, null);
});

// ✅ Fetch latest booking by user_id with security check
app.get("/bookings/latest/:user_id", async (req, res) => {
  try {
    const user_id = req.params.user_id;
    
    // Check if user is logged in and has access
    if (!req.session.user || (req.session.user.user_id !== user_id && !req.session.admin)) {
      return res.status(403).json({ 
        success: false, 
        error: "Unauthorized access" 
      });
    }

    // Get booking with user verification
    const [rows] = await dbp.query(`
      SELECT b.*, u.username, f.flight_name, f.source, f.destination, f.duration 
      FROM bookings b 
      LEFT JOIN users u ON b.user_id = u.user_id
      LEFT JOIN flights f ON b.flight_id = f.flight_id
      WHERE b.user_id = ? 
      ORDER BY b.created_at DESC 
      LIMIT 1
    `, [user_id]);

    if (!rows || rows.length === 0) {
      return res.json({ 
        success: false, 
        message: "No bookings found" 
      });
    }

    return res.json({ 
      success: true, 
      booking: {
        ...rows[0],
        date: formatDate(rows[0].date),
        created_at: formatDate(rows[0].created_at)
      }
    });
  } catch (err) {
    console.error("Booking fetch error:", err);
    return res.status(500).json({
      success: false,
      error: "Database error"
    });
  }
});

// ✅ Admin: Fetch all bookings
app.get("/admin/bookings", (req, res) => {
  // Only verify admin privileges without requiring full session persistence
  const sql = `
    SELECT 
      b.*,
      COALESCE(u.username, b.username) as user_name,
      u.email
    FROM bookings b
    LEFT JOIN users u ON b.user_id = u.user_id
    ORDER BY b.created_at DESC
  `;
  
  db.query(sql, (err, rows) => {
    if (err) {
      console.error('Error fetching admin bookings:', err);
      return res.status(500).json({ success: false, error: err.message });
    }

    // Format dates and ensure consistent data
    const formattedBookings = rows.map(booking => ({
      ...booking,
      date: booking.date ? formatDate(booking.date) : "—",
      created_at: booking.created_at ? formatDate(booking.created_at) : "—",
      updated_at: booking.updated_at ? formatDate(booking.updated_at) : "—",
  reason: booking.cancelReason || booking.reason || "—",
      user_name: booking.user_name || 'Guest User'
    }));
    
    return res.json({ 
      success: true, 
      bookings: formattedBookings,
      count: formattedBookings.length
    });
  });
});

// ✅ Public: Fetch all bookings
app.get("/bookings/all", (req, res) => {
  const sql = "SELECT * FROM bookings ORDER BY created_at DESC";
  db.query(sql, (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    return res.json({ success: true, bookings: rows });
  });
});

// ✅ Cancel Booking by Ticket ID
app.post("/bookings/cancel/:ticketId", async (req, res) => {
  try {
    const ticketId = req.params.ticketId;
    // Determine reason: use provided reason or default to user/admin label
    const provided = req.body && req.body.reason;
    const reason = provided && String(provided).trim() ? String(provided).trim() : (req.session && req.session.admin ? 'Cancelled by admin' : 'cancelled by user');

    // First check if booking exists and not already cancelled
    const [booking] = await dbp.query(
      "SELECT * FROM bookings WHERE ticket_id = ? AND cancelled = 0 LIMIT 1",
      [ticketId]
    );

    if (!booking || booking.length === 0) {
      return res.json({ 
        success: false, 
        error: "Booking not found or already cancelled" 
      });
    }

    // Perform the cancellation
    const [result] = await dbp.query(
      `UPDATE bookings 
       SET cancelled = 1,
           status = 'Cancelled',
           cancelReason = ?,
           reason = ?,
           updated_at = NOW()
       WHERE ticket_id = ?`,
      [reason, reason, ticketId]
    );

    if (result.affectedRows === 0) {
      return res.json({ 
        success: false, 
        error: "Could not cancel booking" 
      });
    }

    console.log(`✅ Booking ${ticketId} cancelled successfully`);
    return res.json({
      success: true,
      message: "Booking cancelled successfully",
      reason
    });

  } catch (err) {
    console.error("Cancel booking error:", err);
    return res.status(500).json({
      success: false,
      error: "Database error during cancellation"
    });
  }
});

// ✅ PUT variant for REST clients
app.put("/bookings/cancel/:ticketId", (req, res) => {
  req.method = "POST";
  app.handle(req, res);
});



// Fetch user data to frontend 




// ============================================================
// ADMIN: Users / Payments / Delete All Bookings
// ============================================================

// Create payments table if not exists
async function createPaymentsTable() {
  try {
    await dbp.query(`
      CREATE TABLE IF NOT EXISTS payments (
        payment_id INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id VARCHAR(50),
        amount DECIMAL(10,2),
        mode VARCHAR(20) NOT NULL,
        payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'Success',
        user_id VARCHAR(50),
        flight_id VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ticket_id) REFERENCES bookings(ticket_id) ON DELETE CASCADE
      );
    `);
    console.log('✅ Payments table created/verified');
  } catch (err) {
    console.error('❌ Error creating payments table:', err);
  }
}

// Process payment and create/update booking
async function processPayment(req, res) {
  let connection;
  try {
    const { ticket_id, amount, mode, user_id, flight_id, booking_details } = req.body;
    
    // Validate required fields
    if (!ticket_id || !amount || !mode) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields. ticket_id, amount and mode are required."
      });
    }

    // Use session user ID if available, otherwise use provided ID or generate guest ID
    const sessionUserId = req.session?.user?.user_id;
    const effectiveUserId = sessionUserId || user_id || (booking_details?.user_id) || ('GUEST-' + Date.now());
    const effectiveUsername = req.session?.user?.username || booking_details?.username || 'Guest User';

    // Get database connection and start transaction
    connection = await dbp.getConnection();
    await connection.beginTransaction();

    // Normalize incoming amount to a number (could be positive for charge or negative for deduction)
    const amountNum = parseFloat(amount) || 0;
    // Start with the incoming amount as a non-negative baseline
    let finalAmount = Math.max(0, amountNum);

    if (booking_details?.cancelled) {
      // Get existing booking details
      const [existingBooking] = await connection.query(
        'SELECT price FROM bookings WHERE ticket_id = ?',
        [ticket_id]
      );

      if (existingBooking && existingBooking.length > 0) {
        const originalPrice = Math.max(0, parseFloat(existingBooking[0].price) || 0);

        if (req.session?.admin) {
          // ADMIN CANCEL: Do NOT allow admin to deduct from the ticket price.
          // - If admin provided a positive amount, treat it as an extra charge and add it to original price.
          // - If admin provided a negative amount (deduction), ignore it and keep original price.
          if (amountNum > 0) {
            finalAmount = originalPrice + amountNum; // add extra charge
          } else {
            finalAmount = originalPrice; // never deduct on admin cancel
          }
        } else {
          // USER CANCEL: allow deduction but not below zero and not more than original price
          const deduction = Math.min(Math.abs(amountNum), originalPrice);
          finalAmount = Math.max(0, originalPrice - deduction);
        }
      }
    }

    // Final safety check to prevent any negative amounts
    finalAmount = Math.max(0, finalAmount);

    try {
      // Check if booking exists
      const [existingBooking] = await connection.query(
        'SELECT ticket_id FROM bookings WHERE ticket_id = ?',
        [ticket_id]
      );

      // Create booking if it doesn't exist
      if (!existingBooking || existingBooking.length === 0) {
        if (!booking_details) {
          throw new Error("Booking details required for new booking");
        }

        const username = effectiveUsername;

        await connection.query(`
          INSERT INTO bookings (
            ticket_id, user_id, flight_id, flight_name, 
            source, destination, date, duration, 
            class_type, price, username, status,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `, [
          ticket_id,
          effectiveUserId,
          flight_id,
          booking_details.flight_name,
          booking_details.source,
          booking_details.destination,
          booking_details.date,
          booking_details.duration,
          booking_details.class_type || 'Economy',
          amount,
          username,
          'Confirmed'
        ]);
      }

      // Decide payment insertion and booking update behavior
      // For admin cancellations: do NOT allow deductions. If admin supplied a negative amount, ignore it (no payment recorded)
      // For admin supplied positive amount on cancellation: treat as an extra charge (record that charge as a payment) but do NOT reduce booking.price
      // For user cancellations: allow deduction up to original price and update booking.price accordingly

      // Fetch booking if exists to get original price
      const [bookingRow] = await connection.query(
        'SELECT price FROM bookings WHERE ticket_id = ? LIMIT 1',
        [ticket_id]
      );
      const bookingExistsNow = bookingRow && bookingRow.length > 0;
      const originalPrice = bookingExistsNow ? Math.max(0, parseFloat(bookingRow[0].price) || 0) : 0;

      // Determine recorded payment amount (non-negative)
      let recordedPayment = Math.max(0, finalAmount);

      if (booking_details?.cancelled && req.session?.admin) {
        // Admin cancellation: ignore negative deductions
        if (amountNum <= 0) {
          recordedPayment = 0; // do not record a negative payment or a refund
        } else {
          // Positive admin-provided amount is an extra charge; record only the extra amount
          recordedPayment = amountNum;
        }
      }

      // Insert payment only if there's something to record (> 0)
      let paymentResult = { insertId: null };
      if (recordedPayment > 0) {
        const [pRes] = await connection.query(
          `INSERT INTO payments (
            ticket_id, amount, mode, user_id, flight_id, status
          ) VALUES (?, ?, ?, ?, ?, 'Success')`,
          [ticket_id, recordedPayment, mode, effectiveUserId, flight_id]
        );
        paymentResult = pRes;
      }

      // Update booking status and price appropriately
      if (bookingExistsNow) {
        if (booking_details?.cancelled) {
          if (req.session?.admin) {
            // Admin cancelled: set status to Cancelled but do NOT change booking.price
            await connection.query(
              `UPDATE bookings SET status = 'Cancelled', updated_at = NOW() WHERE ticket_id = ?`,
              [ticket_id]
            );
          } else {
            // User cancelled: update status and reduce price to remaining amount
            const deduction = Math.min(Math.abs(amountNum), originalPrice);
            const remaining = Math.max(0, originalPrice - deduction);
            await connection.query(
              `UPDATE bookings SET status = 'Cancelled', price = ?, updated_at = NOW() WHERE ticket_id = ?`,
              [remaining, ticket_id]
            );
          }
        } else {
          // Normal payment: mark as Paid (do not overwrite original price)
          await connection.query(
            `UPDATE bookings SET status = 'Paid', updated_at = NOW() WHERE ticket_id = ?`,
            [ticket_id]
          );
        }
      } else {
        // Booking didn't exist earlier and was inserted above; ensure status reflects cancel/paid appropriately
        await connection.query(
          `UPDATE bookings SET status = ?, updated_at = NOW() WHERE ticket_id = ?`,
          [booking_details?.cancelled ? 'Cancelled' : 'Paid', ticket_id]
        );
      }

      // Commit transaction
      await connection.commit();

      console.log('✅ Payment processed successfully:', {
        ticket_id,
        payment_id: paymentResult.insertId,
        amount,
        mode
      });

      res.json({
        success: true,
        message: "Payment processed successfully",
        payment_id: paymentResult.insertId,
        ticket_id: ticket_id
      });

    } catch (err) {
      await connection.rollback();
      throw err;
    }

  } catch (error) {
    console.error('❌ Payment processing error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process payment'
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

app.post("/api/payments/add", processPayment);

// Get all payments endpoint
app.get("/api/payments", async (req, res) => {
  try {
    // Only allow admin access
    if (!req.session.admin) {
      return res.status(403).json({
        success: false,
        error: "Admin access required"
      });
    }

    // Log admin session for debugging
    console.log('Admin session check:', req.session?.admin);
    
    const [rows] = await dbp.query(`
      SELECT 
        p.payment_id,
        p.ticket_id,
        p.amount,
        p.mode,
        p.payment_date,
        p.created_at,
        p.user_id,
        COALESCE(p.flight_id, b.flight_id) AS flight_id,
        b.username,
        b.flight_name,
        b.source,
        b.destination,
        b.class_type,
        u.email
      FROM payments p
      LEFT JOIN bookings b ON p.ticket_id = b.ticket_id 
      LEFT JOIN users u ON b.user_id = u.user_id
      ORDER BY p.payment_date DESC, p.created_at DESC
    `);
    
    console.log('Payments found:', rows?.length || 0);

    res.json({
      success: true,
      payments: rows
    });
  } catch (err) {
    console.error("Error fetching payments:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get("/admin/users", async (req, res) => {
  try {
    if (!req.session.admin) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    const [rows] = await dbp.query(
      "SELECT user_id, username, email, role, created_at FROM users ORDER BY user_id ASC"
    );
    res.json({ success: true, users: rows });
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin-only: Clear all payments (payments table only)
app.post("/admin/clear-payments", async (req, res) => {
  try {
    if (!req.session || !req.session.admin) {
      console.warn('Unauthorized attempt to clear payments');
      return res.status(403).json({ success: false, error: 'Unauthorized - Admin required' });
    }

    // Get current count
    const [countRows] = await dbp.query('SELECT COUNT(*) AS cnt FROM payments');
    const currentCount = (countRows && countRows[0] && countRows[0].cnt) || 0;

    // Truncate payments table (fast) - keep FK checks safe
    await dbp.query('SET FOREIGN_KEY_CHECKS = 0');
    await dbp.query('TRUNCATE TABLE payments');
    await dbp.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log(`✅ Admin ${req.session.admin.username || 'unknown'} cleared ${currentCount} payments`);
    res.json({ success: true, message: `Cleared ${currentCount} payments`, count: currentCount });
  } catch (err) {
    console.error('Error clearing payments:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: sanitize negative payments and booking prices
app.post('/admin/sanitize-payments', async (req, res) => {
  let connection;
  try {
    if (!req.session || !req.session.admin) {
      return res.status(403).json({ success: false, error: 'Admin required' });
    }

    connection = await dbp.getConnection();
    await connection.beginTransaction();

    // Find negative payments
    const [negPayments] = await connection.query('SELECT payment_id, ticket_id, amount FROM payments WHERE amount < 0');
    const paymentsFixed = negPayments.length;

    if (paymentsFixed > 0) {
      // Set negative payments to zero (safe, non-destructive)
      await connection.query('UPDATE payments SET amount = 0 WHERE amount < 0');
    }

    // Fix any bookings with negative price
    const [negBookings] = await connection.query('SELECT ticket_id, price FROM bookings WHERE price < 0');
    const bookingsFixed = negBookings.length;
    if (bookingsFixed > 0) {
      await connection.query('UPDATE bookings SET price = 0 WHERE price < 0');
    }

    await connection.commit();

    console.log(`✅ Sanitized payments (${paymentsFixed}) and bookings (${bookingsFixed}) by admin ${req.session.admin.username}`);
    res.json({ success: true, paymentsFixed, bookingsFixed });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Error sanitizing payments:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/admin/all-bookings", (req, res) => {
  if (!req.session.admin) return res.status(403).json({ success: false, error: "Unauthorized" });
  const sql = `
    SELECT b.*, u.username FROM bookings b
    LEFT JOIN users u ON b.user_id = u.user_id
    ORDER BY b.created_at DESC
  `;
  db.query(sql, (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    
    // Format dates and ensure non-null values for reason
    const formattedBookings = rows.map(booking => ({
      ...booking,
      date: booking.date ? formatDate(booking.date) : "—",
      created_at: booking.created_at ? formatDate(booking.created_at) : "—",
  reason: booking.cancelReason || booking.reason || "—"
    }));
    
    res.json({ success: true, bookings: formattedBookings });
  });
});

// Delete all bookings (admin only)
app.delete("/admin/delete-all-bookings", async (req, res) => {
  let connection;
  try {
    // Verify admin session
    if (!req.session.admin) {
      console.warn('Unauthorized attempt to delete all bookings');
      return res.status(403).json({ 
        success: false, 
        error: "Unauthorized - Admin access required" 
      });
    }

    // Get count before deletion
    const [countResult] = await dbp.query("SELECT COUNT(*) as count FROM bookings");
    const bookingsCount = countResult[0].count;

    // Get a connection for transaction
    connection = await dbp.getConnection();
    await connection.beginTransaction();

    try {
      // First clear payments (ON DELETE CASCADE will handle FK)
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");
      await connection.query("TRUNCATE TABLE payments");
      await connection.query("TRUNCATE TABLE bookings");
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      
      await connection.commit();
      console.log(`✅ All bookings (${bookingsCount}) and payments cleared by admin ${req.session.admin.username}`);
      
      res.json({ 
        success: true, 
        message: `Successfully deleted ${bookingsCount} bookings and their payments`,
        count: bookingsCount
      });
    } catch (delErr) {
      await connection.rollback();
      throw delErr;
    }
  } catch (err) {
    console.error("Error deleting all bookings:", err);
    res.status(500).json({ 
      success: false, 
      error: "Database error while deleting bookings",
      details: err.message 
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Delete user by ID (admin only)
app.delete("/admin/users/:userId", async (req, res) => {
  let connection;
  try {
    if (!req.session.admin) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    connection = await dbp.getConnection();
    await connection.beginTransaction();

    try {
      const userId = req.params.userId;

      // First delete all payments associated with user's bookings
      await connection.query(`
        DELETE p FROM payments p
        INNER JOIN bookings b ON p.ticket_id = b.ticket_id
        WHERE b.user_id = ?
      `, [userId]);

      // Then delete user's bookings
      await connection.query("DELETE FROM bookings WHERE user_id = ?", [userId]);
      
      // Delete from user_profiles
      await connection.query("DELETE FROM user_profiles WHERE user_id = ?", [userId]);
      
      // Finally delete the user
      const [result] = await connection.query("DELETE FROM users WHERE user_id = ?", [userId]);

      if (result.affectedRows === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          error: "User not found"
        });
      }

      await connection.commit();
      console.log(`✅ Admin deleted user ${userId} and all related data`);
      res.json({
        success: true,
        message: "User and all related data deleted successfully"
      });
    } catch (err) {
      if (connection) await connection.rollback();
      throw err;
    }
  } catch (err) {
    console.error("Error deleting user:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Delete user's bookings
app.delete("/api/bookings/user/:userId/clear", async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

  const [result] = await dbp.query(
      "DELETE FROM bookings WHERE user_id = ?",
      [userId]
    );

    if (result.affectedRows === 0) {
      return res.json({
        success: false,
        message: "No bookings found for this user"
      });
    }

    console.log(`Deleted ${result.affectedRows} bookings for user ${userId}`);
    res.json({
      success: true,
      message: `Successfully deleted ${result.affectedRows} bookings`
    });
  } catch (err) {
    console.error("Error deleting user bookings:", err);
    res.status(500).json({
      success: false,
      message: "Database error",
      error: err.message
    });
  }
});

// ============================================================
// Ensure User Exists API
// ============================================================
app.post("/api/ensure-user", async (req, res) => {
  // Guest user creation via this endpoint is disabled.
  // Only allow verification for an already-authenticated session user.
  try {
    if (!req.session || !req.session.user) {
      return res.status(403).json({
        success: false,
        message: "Guest creation disabled. Please register or log in."
      });
    }

    // If session user exists, return verification
    const sessionUserId = req.session.user.user_id;
    return res.json({ success: true, message: 'Session user verified', user_id: sessionUserId });
  } catch (err) {
    console.error("Error in ensure-user (disabled):", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ============================================================
// Auto-register & login (server-side) — creates a proper U### user and session
// ============================================================
app.post('/api/auto-register', async (req, res) => {
  try {
    const { username, email } = req.body || {};

    // If already logged in, return current session
    if (req.session && req.session.user && req.session.user.user_id) {
      return res.json({ success: true, message: 'Already logged in', user: req.session.user });
    }

    // Generate a new server-side user id
    const newUserId = await generateUserId();
    const finalUsername = (username && String(username).trim()) || `Guest${newUserId}`;
    const finalEmail = (email && String(email).trim()) || `${finalUsername.toLowerCase()}@guest.com`;
    const password = 'guest' + Math.floor(Math.random() * 9000 + 1000); // random placeholder

    // Insert user and profile
    await dbp.query(
      "INSERT INTO users (user_id, username, email, password, role, created_at) VALUES (?, ?, ?, ?, 'user', NOW())",
      [newUserId, finalUsername, finalEmail, password]
    );

    await dbp.query(
      "INSERT INTO user_profiles (user_id, created_at) VALUES (?, NOW())",
      [newUserId]
    );

    // Create session
    if (!req.session) req.session = {};
    req.session.user = {
      user_id: newUserId,
      username: finalUsername,
      email: finalEmail,
      role: 'user'
    };

    // Save session and respond
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('Session save error during auto-register:', saveErr);
        return res.status(500).json({ success: false, message: 'Registered but failed to create session' });
      }
      console.log(`✅ Auto-registered user ${finalUsername} (${newUserId})`);
      return res.json({ success: true, message: 'Auto-registered and logged in', user: req.session.user });
    });

  } catch (err) {
    console.error('Auto-register error:', err);
    res.status(500).json({ success: false, message: 'Server error during auto-register', error: err.message });
  }
});

// ============================================================
// USER PROFILE APIs
// ============================================================

// Get user ID from username/email - Only for registered users
app.post("/api/get-user-id", async (req, res) => {
  const { username, email } = req.body;
  
  if (!username && !email && !req.session?.user?.user_id) {
    return res.status(400).json({
      success: false,
      message: "Username or email is required"
    });
  }

  try {
    // Prefer session user if available
    if (req.session && req.session.user && req.session.user.user_id) {
      const sessionUserId = req.session.user.user_id;
      console.log(`Using session user ID: ${sessionUserId}`);
      return res.json({
        success: true,
        user_id: sessionUserId,
        username: req.session.user.username,
        email: req.session.user.email,
        role: req.session.user.role
      });
    }

    // Only fetch from registered users (matching SQL schema)
    const query = `
      SELECT u.user_id, u.username, u.email, u.role, 
             up.full_name, up.contact_no
      FROM users u
      LEFT JOIN user_profiles up ON u.user_id = up.user_id
      WHERE u.username = ? OR u.email = ?
      LIMIT 1
    `;
    
  const [rows] = await dbp.query(query, [username, email]);
    
    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Please log in to book tickets"
      });
    }

    // Format response according to schema
    res.json({
      success: true,
      user_id: rows[0].user_id,      // U001 format from users table
      username: rows[0].username,
      email: rows[0].email,
      role: rows[0].role,
      full_name: rows[0].full_name,
      contact_no: rows[0].contact_no
    });
  } catch (err) {
    console.error("Error fetching user ID:", err);
    res.status(500).json({
      success: false,
      message: "Database error: " + err.message
    });
  }
});

app.get("/api/user/profile/:email", (req, res) => {
  const email = req.params.email;
  const sql = `
    SELECT u.user_id, u.username, u.email, p.full_name, p.age, p.contact_no, p.address, p.city, p.nationality
    FROM users u
    LEFT JOIN user_profiles p ON u.user_id = p.user_id
    WHERE u.email = ? LIMIT 1
  `;
  db.query(sql, [email], (err, rows) => {
    if (err) return res.status(500).json({ error: "Internal Server Error" });
    if (!rows || rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  });
});

app.post("/api/user/profile/update", (req, res) => {
  const { email, full_name, age, contact_no, address, city, nationality } = req.body;
  if (!email) return res.status(400).json({ error: "Missing user email" });

  const getUser = "SELECT user_id FROM users WHERE email = ? LIMIT 1";
  db.query(getUser, [email], (err, rows) => {
    if (err || !rows || rows.length === 0) return res.status(404).json({ error: "User not found" });
    const user_id = rows[0].user_id;
    const sql = `
      INSERT INTO user_profiles (user_id, full_name, age, contact_no, address, city, nationality)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        full_name = VALUES(full_name),
        age = VALUES(age),
        contact_no = VALUES(contact_no),
        address = VALUES(address),
        city = VALUES(city),
        nationality = VALUES(nationality)
    `;
    db.query(sql, [user_id, full_name, age, contact_no, address, city, nationality], (err2) => {
      if (err2) return res.status(500).json({ error: "Database Error" });
      res.json({ success: true, message: "Profile updated" });
    });
  });
});

// Auto-generate next user_id in format U001, U002...
async function generateUserId() {
  const [rows] = await dbp.query("SELECT user_id FROM users ORDER BY user_id DESC LIMIT 1");
  if (rows.length === 0) return "U001";

  const lastId = rows[0].user_id;           // e.g., 'U004'
  const num = parseInt(lastId.replace("U", "")) + 1;
  return "U" + String(num).padStart(3, "0"); // 'U005'
}

// Booking route
app.post("/bookings/save", async (req, res) => {
  try {
    let {
      ticket_id,
      flight_id,
      flight_name,
      source,
      destination,
      date,
      duration,
      class_type,
      price,
      username
    } = req.body;

    // Generate ticket ID if missing
    ticket_id = ticket_id || "TKT-" + Date.now() + "-" + Math.floor(Math.random() * 1000);

    // Require authenticated session user. Do not auto-create guest users.
    const sessionUserId = req.session && req.session.user && req.session.user.user_id;
    if (!sessionUserId) {
      return res.status(401).json({ success: false, error: 'Please log in to save bookings' });
    }
    const user_id = sessionUserId;
    username = username || (req.session.user && req.session.user.username) || username;

    // Prevent duplicate ticket_id
    const [ticketExists] = await dbp.query("SELECT id FROM bookings WHERE ticket_id = ? LIMIT 1", [ticket_id]);
    if (ticketExists.length > 0) return res.json({ success: false, error: "Ticket already exists" });

    // Insert booking
    const [result] = await dbp.query(
      `INSERT INTO bookings
      (user_id, ticket_id, flight_id, flight_name, source, destination, date, duration, class_type, price, username)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user_id, ticket_id, flight_id, flight_name, source, destination, date, duration, class_type, price, username]
    );

    res.json({ success: true, message: "Booking saved", user_id, ticket_id, booking_id: result.insertId });
  } catch (err) {
    console.error("Booking error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// 🎫 Book Ticket - Main booking endpoint used by confirm.html
// ============================================================
app.post("/api/book-ticket", async (req, res) => {
  try {
    const {
      ticket_id,
      user_id,
      flightId: flight_id, // Handle frontend field name
      fname: flight_name,  // Handle frontend field name
      source,
      destination,
      date,
      duration,
      class_type,
      price,
      cancelled,
      cancelReason,
      username
    } = req.body;

    // Generate ticket_id if not provided
    const finalTicketId = ticket_id || `TKT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    // Use session user_id; do not create guest users.
    let finalUserId = (req.session && req.session.user && req.session.user.user_id) || user_id;
    if (!finalUserId) {
      return res.status(401).json({ success: false, error: 'Please log in to book tickets' });
    }

    // Check for existing booking
  const [existing] = await dbp.query(
      "SELECT * FROM bookings WHERE ticket_id = ?",
      [finalTicketId]
    );

    if (existing.length > 0) {
      // Update existing booking if found
  await dbp.query(
        `UPDATE bookings 
         SET flight_id = ?, flight_name = ?, source = ?, destination = ?,
             date = ?, duration = ?, class_type = ?, price = ?,
             cancelled = ?, cancelReason = ?, updated_at = NOW()
         WHERE ticket_id = ?`,
        [
          flight_id,
          flight_name,
          source,
          destination,
          date,
          duration,
          class_type,
          price,
          cancelled || false,
          cancelReason || null,
          finalTicketId
        ]
      );

      return res.json({
        success: true,
        message: "Booking updated successfully",
        ticket_id: finalTicketId,
        user_id: finalUserId
      });
    }

    // Insert new booking
  const [result] = await dbp.query(
      `INSERT INTO bookings (
        ticket_id, user_id, flight_id, flight_name, source, destination,
        date, duration, class_type, price, cancelled, cancelReason,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed', NOW())`,
      [
        finalTicketId,
        finalUserId,
        flight_id,
        flight_name,
        source,
        destination,
        date,
        duration,
        class_type,
        price,
        cancelled || false,
        cancelReason || null
      ]
    );

    console.log(`✅ Booking saved: ${finalTicketId} (User: ${finalUserId})`);
    res.json({
      success: true,
      message: "Booking saved successfully",
      ticket_id: finalTicketId,
      user_id: finalUserId,
      booking_id: result.insertId
    });

  } catch (err) {
    console.error("❌ Booking error:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ===============================
// GET /api/bookings - Fetch bookings with privacy enforcement
// ===============================
app.get("/api/bookings", async (req, res) => {
  try {
    // Check authentication
    if (!req.session || (!req.session.user && !req.session.admin)) {
      console.log('No session found for /api/bookings');
      return res.status(401).json({
        success: false,
        error: "Please log in to view bookings"
      });
    }

    const requestedUserId = req.query.userId;
    const requestedTicketId = req.query.ticketId;
    const sessionUserId = req.session.user?.user_id;
    
    // Log session state for debugging
    console.log(`Bookings request - Session user: ${sessionUserId}, Requested: ${requestedUserId}`);
    
    // If not admin and a userId is requested, ensure it matches session
    if (!req.session.admin && requestedUserId && sessionUserId !== requestedUserId) {
      console.log(`Unauthorized: session user ${sessionUserId} tried to access bookings for ${requestedUserId}`);
      return res.status(403).json({
        success: false,
        error: "You can only view your own bookings"
      });
    }

    let sql = `
      SELECT 
        b.id,
        b.user_id,
        b.ticket_id,
        b.flight_id,
        b.flight_name,
        b.source,
        b.destination,
        b.date,
        b.duration,
        b.class_type,
        b.price,
        b.status,
  b.cancelled,
  b.reason,
  b.cancelReason,
        b.created_at,
        b.updated_at,
        COALESCE(u.username, b.username) as username,
        u.email
      FROM bookings b
      LEFT JOIN users u ON b.user_id = u.user_id
    `;

    const params = [];
    let whereClause = [];

    // Filter by ticket_id if provided
    if (requestedTicketId) {
      whereClause.push('b.ticket_id = ?');
      params.push(requestedTicketId);
    } else {
      // Non-admin users only see their own bookings
      if (!req.session.admin) {
        if (!sessionUserId) {
          return res.status(403).json({
            success: false,
            error: "Session missing user ID"
          });
        }
        whereClause.push('b.user_id = ?');
        params.push(sessionUserId);
      } else if (requestedUserId) {
        // Admin can filter by specific user
        whereClause.push('b.user_id = ?');
        params.push(requestedUserId);
      }
    }

    if (whereClause.length > 0) {
      sql += ' WHERE ' + whereClause.join(' AND ');
    }

    sql += ' ORDER BY b.created_at DESC';

    const [rows] = await dbp.query(sql, params);
    
    // Format dates for frontend
    const bookings = rows.map(b => ({
      ...b,
      date: formatDate(b.date),
      created_at: formatDate(b.created_at),
      updated_at: formatDate(b.updated_at),
      cancelled: !!b.cancelled,
      price: b.price ? parseFloat(b.price) : null,
      // Prefer explicit cancelReason (user/admin) then fallback to legacy reason
      reason: (b.cancelReason && String(b.cancelReason).trim()) || (b.reason && String(b.reason).trim()) || null
    }));

    console.log(`Found ${bookings.length} bookings`);

    const respRole = req.session && req.session.admin ? 'admin' : 'user';
    const respUserId = (req.session && req.session.user && req.session.user.user_id) || requestedUserId || null;

    res.json({ 
      success: true, 
      bookings,
      count: bookings.length,
      role: respRole,
      userId: respUserId
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Database error",
      error: err.message 
    });
  }
});
// ============================================================
// ✈️ ADD BOOKING (FIXED - HANDLES NULL VALUES SAFELY)
// ============================================================
app.post("/bookings/add", async (req, res) => {
  try {
    const {
      ticket_id,
      user_id,
      username,
      flight_id,
      flight_name,
      source,
      destination,
      date,
      duration,
      class_type,
      price,
      status,
      cancelled,
      cancelReason
    } = req.body;

    // Debug log to verify received data
    console.log("📦 Booking Insert Request:", req.body);

    // Validate essential fields
    if (!ticket_id || !user_id || !flight_id) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: ticket_id, user_id, or flight_id"
      });
    }

    const sql = `
      INSERT INTO bookings (
        ticket_id, user_id, username, flight_id, flight_name,
        source, destination, date, duration, class_type,
        price, status, cancelled, cancelReason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      ticket_id || null,
      user_id || null,
      username || null,
      flight_id || null,
      flight_name || null,
      source || null,
      destination || null,
      date || null,
      duration || null,
      class_type || null,
      price || null,
      status || "Confirmed",
      cancelled ? 1 : 0,
      cancelReason || null
    ];

    // Log before inserting to see if any undefined sneaks in
    console.log("🧩 Values to Insert:", values);

    // Execute safely with null replacements
    await db.execute(sql, values);

    res.json({ success: true, message: "Booking saved successfully" });
  } catch (err) {
    console.error("❌ DB Insert Error:", err);
    res.status(500).json({
      success: false,
      error: "Database insert failed — check console for details"
    });
  }
});



// ============================================================
// Get Bookings by User ID
// ============================================================
app.get("/api/bookings/user/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

  const [rows] = await dbp.query(
      `SELECT b.*, u.username 
       FROM bookings b
       LEFT JOIN users u ON b.user_id = u.user_id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC`,
      [userId]
    );
    
    // Format dates and handle nulls
    const bookings = rows.map(b => ({
      ...b,
      date: formatDate(b.date),
      created_at: formatDate(b.created_at),
      updated_at: formatDate(b.updated_at),
      cancelled: !!b.cancelled,
      price: b.price ? parseFloat(b.price) : null
    }));

    res.json({ 
      success: true, 
      bookings,
      count: bookings.length
    });
  } catch (err) {
    console.error("Error fetching user bookings:", err);
    res.status(500).json({
      success: false,
      message: "Database error",
      error: err.message
    });
  }
});

// ============================================================
// STREAM: Server-Sent Events for live admin bookings
// ============================================================
app.get("/bookings/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders && res.flushHeaders();

  const sendBookings = () => {
    const sql = `
      SELECT user_id, ticket_id, flight_id, flight_name, source, destination, date, class_type, price, cancelled, cancelReason, reason
      FROM bookings
      ORDER BY created_at DESC
    `;
    db.query(sql, (err, results) => {
      if (err) {
        console.error("Stream fetch error:", err);
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
        return;
      }
      res.write(`data: ${JSON.stringify(results)}\n\n`);
    });
  };

  // Initial send and interval
  sendBookings();
  const interval = setInterval(sendBookings, 4000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

// Helper function to get the appropriate session for user/admin
function getSessionStore(req) {
  return req.path.startsWith('/admin') ? adminSessionStore : userSessionStore;
}

// Helper to get session data
async function getSessionData(sessionId, isAdmin = false) {
  try {
    const store = isAdmin ? adminSessionStore : userSessionStore;
    return new Promise((resolve, reject) => {
      store.get(sessionId, (err, session) => {
        if (err) reject(err);
        else resolve(session);
      });
    });
  } catch (err) {
    console.error('Session fetch error:', err);
    return null;
  }
}

// Utility: Convert DD/MM/YYYY -> YYYY-MM-DD
function formatDateToMySQL(ddmmyyyy) {
  const [dd, mm, yyyy] = ddmmyyyy.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

// Example: Cancel Ticket API
app.post("/api/cancel-ticket/:ticket_id", async (req, res) => {
  const ticket_id = req.params.ticket_id;
  const { cancelReason, username, user_id, date } = req.body; // date in DD/MM/YYYY
  try {
    const mysqlDate = date ? formatDateToMySQL(date) : null;
    const sql = `UPDATE bookings SET cancelled = true, cancelReason = ?, reason = ?, date = ? WHERE ticket_id = ?`;
  await dbp.query(sql, [cancelReason || "No reason provided", cancelReason || "No reason provided", mysqlDate, ticket_id]);
    res.json({ success: true, message: "Ticket cancelled successfully" });
  } catch (err) {
    console.error("Cancel ticket error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// Utility Functions
// ============================================================
function formatDateToMySQL(ddmmyyyy) {
  if (!ddmmyyyy) return null;
  const [dd, mm, yyyy] = ddmmyyyy.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateToDDMMYYYY(yyyy_mm_dd) {
  if (!yyyy_mm_dd) return "—";
  const date = new Date(yyyy_mm_dd);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ============================================================
// Save booking with improved session handling and logging
// ============================================================
app.post("/api/book-ticket", async (req, res) => {
  try {
    console.log('Book ticket request - Session:', req.session?.user || 'no session user');
    
    const {
      ticket_id: providedTicketId,
      user_id: providedUserId,
      flightId: flight_id,
      fname: flight_name,
      source,
      destination,
      date,
      duration,
      class_type,
      price,
      cancelled,
      cancelReason
    } = req.body;

    // Generate ticket_id if not provided
    const ticket_id = providedTicketId || `TKT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    // Prefer session user_id over provided user_id
    const user_id = (req.session?.user?.user_id) || providedUserId;
    const username = (req.session?.user?.username) || req.body.username;

    if (!user_id) {
      console.log('No user_id available for booking');
      return res.status(400).json({
        success: false,
        error: "User ID required for booking"
      });
    }

    console.log('Creating booking for user:', { user_id, username, ticket_id });

    // Check for existing booking first
    const [existing] = await dbp.query(
      "SELECT * FROM bookings WHERE ticket_id = ?",
      [ticket_id]
    );

    if (existing.length > 0) {
      // Update existing
      await dbp.query(
        `UPDATE bookings 
         SET flight_id = ?, flight_name = ?, source = ?, destination = ?,
             date = ?, duration = ?, class_type = ?, price = ?,
             cancelled = ?, reason = ?, updated_at = NOW()
         WHERE ticket_id = ?`,
        [
          flight_id,
          flight_name,
          source,
          destination,
          date,
          duration,
          class_type,
          price,
          cancelled || false,
          cancelReason || null,
          ticket_id
        ]
      );
    } else {
      // Insert new
      await dbp.query(
        `INSERT INTO bookings (
          ticket_id, user_id, flight_id, flight_name, source, destination,
          date, duration, class_type, price, username, status, 
          cancelled, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed', false, NULL, NOW())`,
        [
          ticket_id,
          user_id,
          flight_id,
          flight_name,
          source,
          destination,
          date,
          duration,
          class_type,
          price,
          username
        ]
      );
    }

    console.log(`✅ Booking saved: ${ticket_id} (User: ${user_id})`);
    res.json({
      success: true,
      message: "Booking saved successfully",
      ticket_id,
      user_id
    });

  } catch (err) {
    console.error("❌ Booking error:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ============================================================
// ❌ Cancel Booking Route
// ============================================================
app.post("/api/bookings/cancel", async (req, res) => {
  try {
    const { ticket_id, cancelReason } = req.body;

    if (!ticket_id) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing ticket_id" 
      });
    }

    // First get the current booking to preserve date
    const [booking] = await dbp.query(
      "SELECT date FROM bookings WHERE ticket_id = ?",
      [ticket_id]
    );

    if (!booking || booking.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    // Update booking status while preserving date
    const [result] = await dbp.query(
      `UPDATE bookings 
       SET cancelled = true,
           cancelReason = ?,
           reason = ?,
           status = 'Cancelled',
           updated_at = NOW(),
           date = ?
       WHERE ticket_id = ?`,
      [cancelReason || "No reason provided", 
       cancelReason || "No reason provided", 
       booking[0].date,
       ticket_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Booking not found" 
      });
    }

    console.log(`✅ Booking cancelled: ${ticket_id}`);
    res.json({ 
      success: true, 
      message: "Booking cancelled successfully"
    });
  } catch (err) {
    console.error("❌ Cancel Error:", err);
    res.status(500).json({ 
      success: false, 
      message: err.message 
    });
  }
});

// Cancel individual booking by ID with refund handling
app.post("/booking/cancel/:bookingId", async (req, res) => {
  let connection;
  try {
    const bookingId = req.params.bookingId;
    if (!bookingId) {
      return res.status(400).json({ 
        success: false, 
        message: "Booking ID is required" 
      });
    }

    // Get a connection and start transaction
    connection = await dbp.getConnection();
    await connection.beginTransaction();

    try {
      // First verify if booking exists and its current status
      const [booking] = await connection.query(
        'SELECT id, ticket_id, cancelled, price, class_type FROM bookings WHERE id = ?',
        [bookingId]
      );

      if (!booking || booking.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: "Booking not found" 
        });
      }

      if (booking[0].cancelled) {
        return res.status(400).json({ 
          success: false, 
          message: "Booking is already cancelled" 
        });
      }

      // Calculate refund amount
      const basePrice = parseFloat(booking[0].price || 0);
      const classMultiplier = booking[0].class_type === 'Business' ? 1.5 : 
                             booking[0].class_type === 'First' ? 2 : 1;
      const subtotal = basePrice * classMultiplier;
      const gst = subtotal * 0.18;
      const fees = 250; // Standard convenience fee
      const totalRefund = subtotal + gst + fees;

      // Update booking status
  // Determine admin status robustly: support both req.session.admin flag and session user role
  const isAdmin = !!(req.session && (req.session.admin || (req.session.user && String(req.session.user.role).toLowerCase() === 'admin')));

  // Minimal request-level logging to help debug mis-attributed cancels.
  // Logs session presence and whether it was treated as admin (no secrets printed).
  console.log(`Cancel request: bookingId=${bookingId}, sessionID=${req.sessionID || 'no-session'}, isAdmin=${isAdmin}, sessionUser=${req.session?.user?.user_id || 'none'}`);
      const cancelLabel = isAdmin ? 'Cancelled by admin' : 'Cancelled by user';

      // Update booking status and store both cancelReason and legacy reason for compatibility
      await connection.query(
        `UPDATE bookings 
         SET cancelled = true,
             status = 'Cancelled',
             updated_at = NOW(),
             cancelReason = ?,
             reason = ?
         WHERE id = ?`,
        [cancelLabel, cancelLabel, bookingId]
      );

      // Record refund in payments only for user-initiated cancellations.
      // Admin cancellations should not create negative payment entries (no deduction).
      if (!isAdmin) {
        await connection.query(
          `INSERT INTO payments (ticket_id, amount, mode)
           VALUES (?, ?, 'Card')`,  // Using 'Card' as the refund mode
          [booking[0].ticket_id, -Math.abs(totalRefund)]
        );
      } else {
        // Admin cancelled: do not insert negative payment. If desired, admin can add a positive charge separately.
        console.log(`ℹ️ Admin cancellation: skipping negative refund insertion for booking ${bookingId}`);
      }

      await connection.commit();
      console.log(`✅ Booking ${bookingId} cancelled by ${isAdmin ? 'admin' : 'user'}${!isAdmin ? `, refund: ${totalRefund}` : ''}`);

      res.json({ 
        success: true, 
        message: isAdmin ? 'Booking cancelled by admin' : 'Booking cancelled and refund initiated',
        refund_amount: !isAdmin ? totalRefund : 0,
        reason: cancelLabel
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    }
  } catch (err) {
    console.error("❌ Cancel Error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Server error while cancelling booking" 
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ============================================================
// 🚀 START SERVER
// ============================================================
// Start server after making sure DB schema is in expected state
(async () => {
  try {
    // First ensure the tables exist
    await dbp.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(100) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await dbp.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id VARCHAR(50) UNIQUE NOT NULL,
        user_id VARCHAR(50),
        flight_id VARCHAR(50),
        flight_name VARCHAR(100),
        source VARCHAR(100),
        destination VARCHAR(100),
        date DATE,
        duration VARCHAR(50),
        class_type VARCHAR(20),
        price DECIMAL(10,2),
        username VARCHAR(100),
        status VARCHAR(20) DEFAULT 'Confirmed',
        cancelled BOOLEAN DEFAULT FALSE,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
      );
    `);

    await dbp.query(`
      CREATE TABLE IF NOT EXISTS payments (
        payment_id INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id VARCHAR(50) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        mode ENUM('UPI','Cash','Card','NetBanking') NOT NULL,
        payment_date DATE DEFAULT (CURRENT_DATE),
        payment_time TIME DEFAULT (CURRENT_TIME),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ticket_id) REFERENCES bookings(ticket_id) ON DELETE CASCADE
      );
    `);

    await ensureBookingColumns();
    console.log('✅ Database schema verified');

    // Start the server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Error during server initialization:', err);
    process.exit(1);
  }
})();
