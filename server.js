// server.js - Final Version with FIXED Session Table setup for Render PG
// MODIFIED TO INCLUDE EMAIL IN USER LIST, REMOVE USER FUNCTION, AND USE userIdentifier

const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const { Pool } = require('pg');        // PostgreSQL client
const bcrypt = require('bcrypt');       // Password hashing
const session = require('express-session'); // Session management
const pgSession = require('connect-pg-simple')(session); // Store sessions in PG
// No crypto needed for recovery codes in this version

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Configuration & Constants ---
const port = process.env.PORT || 3000;
const saltRounds = 10;
const INITIAL_BALANCE = 10.00; // Initial balance for new users is 10
const ADMIN_USERNAME = 'MyGameAdmin'; // <<< SET YOUR ADMIN USERNAME HERE
const BETTING_DURATION = 7000;
const PREPARING_DURATION = 3000;
const CRASHED_DURATION = 4000;
const GAME_TICK_INTERVAL = 100;
const MAX_HISTORY_ITEMS_SERVER = 20;
const ADMIN_HISTORY_LIMIT = 50;

// --- Check Environment Variables ---
if (!process.env.DATABASE_URL) { console.error("FATAL ERROR: DATABASE_URL environment variable is not set!"); process.exit(1); }
if (!process.env.SESSION_SECRET) { console.error("FATAL ERROR: SESSION_SECRET environment variable is not set!"); process.exit(1); }

// --- PostgreSQL Connection Pool ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // ssl: { rejectUnauthorized: false } // Uncomment if needed on Render
});

// --- Session Middleware Setup ---
app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: process.env.SESSION_SECRET,
    resave: false, saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, secure: 'auto', httpOnly: true }
}));

// --- Middleware for Parsing Request Bodies ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Game State Variables ---
let gameState = 'IDLE'; let currentMultiplier = 1.00; let crashPoint = 0; let gameStartTime = 0;
let tickIntervalId = null; let nextStateTimeoutId = null;
let players = {}; let gameHistory = []; let onlineUsers = {};

// --- Database Setup Function ---
async function setupDatabase() {
    const client = await pool.connect();
    console.log("Checking/Creating database tables ('users', 'deposit_requests', 'withdrawal_requests', 'session')...");
    try {
        // Users table definition (Now includes email explicitly)
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(60) NOT NULL,
                balance DECIMAL(12, 2) DEFAULT ${INITIAL_BALANCE.toFixed(2)} NOT NULL,
                status VARCHAR(10) DEFAULT 'active' NOT NULL,
                email VARCHAR(255) UNIQUE,
                email_verified BOOLEAN DEFAULT false NOT NULL,
                otp TEXT NULL, -- Kept for potential future email verify
                otp_expires_at TIMESTAMPTZ NULL, -- Kept for potential future email verify
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("Table 'users' checked/created.");
        // Ensure relevant columns exist (redundant if CREATE TABLE is up-to-date, but safe)
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(10) DEFAULT 'active' NOT NULL;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false NOT NULL;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS otp TEXT NULL;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ NULL;`);
        console.log("Columns for 'users' table checked/modified.");

        // Other tables (Deposit/Withdrawal)
        await client.query(`CREATE TABLE IF NOT EXISTS deposit_requests (id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id) ON DELETE CASCADE, username VARCHAR(50) NOT NULL, transaction_id VARCHAR(255) NOT NULL, status VARCHAR(20) DEFAULT 'pending' NOT NULL, requested_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, approved_by VARCHAR(50) NULL, approved_amount DECIMAL(12, 2) NULL, approved_at TIMESTAMPTZ NULL);`);
        console.log("Table 'deposit_requests' checked/created.");
        await client.query(`CREATE TABLE IF NOT EXISTS withdrawal_requests (id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id) ON DELETE CASCADE, username VARCHAR(50) NOT NULL, amount DECIMAL(12, 2) NOT NULL, upi_id VARCHAR(100) NOT NULL, status VARCHAR(20) DEFAULT 'pending' NOT NULL, requested_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, processed_by VARCHAR(50) NULL, processed_at TIMESTAMPTZ NULL);`);
        console.log("Table 'withdrawal_requests' checked/created.");

        // Add user_id column and foreign key constraints if they don't exist
        // Deposit Requests
        try { await client.query('ALTER TABLE deposit_requests ADD COLUMN user_id INT;'); } catch (e) { if (e.code !== '42701') console.error("Ignoring error adding user_id (likely exists):", e.message); } // Ignore if column exists
        try { await client.query('ALTER TABLE deposit_requests ADD CONSTRAINT fk_user_deposit FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;'); } catch (e) { if (e.code !== '42710') console.error("Ignoring error adding fk_user_deposit (likely exists):", e.message); } // Ignore if constraint exists
        // Withdrawal Requests
        try { await client.query('ALTER TABLE withdrawal_requests ADD COLUMN user_id INT;'); } catch (e) { if (e.code !== '42701') console.error("Ignoring error adding user_id (likely exists):", e.message); }
        try { await client.query('ALTER TABLE withdrawal_requests ADD CONSTRAINT fk_user_withdrawal FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;'); } catch (e) { if (e.code !== '42710') console.error("Ignoring error adding fk_user_withdrawal (likely exists):", e.message); }

        // *** Session Table Creation (Corrected) ***
        const createSessionTableQuery = `
        CREATE TABLE IF NOT EXISTS "session" (
            "sid" varchar NOT NULL COLLATE "default",
            "sess" json NOT NULL,
            "expire" timestamp(6) NOT NULL,
            CONSTRAINT "session_pkey" PRIMARY KEY ("sid") -- Define PK directly
        );
        `;
        await client.query(createSessionTableQuery);
        await client.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");`);
        console.log("Table 'session' and index checked/created successfully.");
        // *** END Corrected Block ***

    } catch (err) { console.error("ERROR creating/checking database tables:", err); }
    finally { client.release(); }
}

// --- PostgreSQL Database Helper Functions ---
// Gets relevant user data (including email)
async function getUserData(username) { if (!username) return null; const query = 'SELECT id, username, password_hash, balance, status, email, email_verified FROM users WHERE username = $1'; const values = [username.toLowerCase()]; let client; try { client = await pool.connect(); const result = await client.query(query, values); if (result.rows.length > 0) { const user = result.rows[0]; user.balance = parseFloat(user.balance); return user; } else { return null; } } catch (err) { console.error(`Error in getUserData for ${username}:`, err); return null; } finally { if (client) client.release(); } }
// Gets user by email
async function getUserByEmail(email) { if (!email) return null; const query = 'SELECT id, username, email FROM users WHERE email = $1'; const values = [email.toLowerCase()]; let client; try { client = await pool.connect(); const result = await client.query(query, values); return result.rows.length > 0 ? result.rows[0] : null; } catch (err) { console.error(`Error in getUserByEmail for ${email}:`, err); return null; } finally { if (client) client.release(); } }
// Creates user with email, no recovery code
async function createUser(username, passwordHash, email) { if (!username || !passwordHash || !email) return false; const query = 'INSERT INTO users (username, password_hash, balance, status, email, email_verified) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id'; const values = [username.toLowerCase(), passwordHash, INITIAL_BALANCE, 'active', email.toLowerCase(), false]; let client; try { client = await pool.connect(); const result = await client.query(query, values); console.log(`[createUser] User ${username} created with ID: ${result.rows[0].id}`); return result.rows[0].id; } catch(err) { if (err.code === '23505') { console.log(`[createUser] Attempted to register existing username/email: ${username}/${email}`); } else { console.error(`Error creating user ${username}:`, err); } return false; } finally { if (client) client.release(); } }
// Update balance
async function updateUserBalance(username, newBalance) { if (!username || typeof newBalance !== 'number') return false; const query = 'UPDATE users SET balance = $1 WHERE username = $2'; const values = [newBalance.toFixed(2), username.toLowerCase()]; let client; try { client = await pool.connect(); const result = await client.query(query, values); if (result.rowCount > 0) { console.log(`[updateUserBalance] Updated DB balance for ${username} to ${newBalance.toFixed(2)}`); return true; } else { console.error(`[updateUserBalance] User ${username} not found during balance update.`); return false; } } catch (err) { console.error(`Error updating balance for ${username}:`, err); return false; } finally { if (client) client.release(); } }
// Update status - Kept for reference, but block/unblock now use direct SQL
// async function updateUserStatus(username, status) { ... }


// --- Serve Static Files (Frontend) ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// --- Authentication HTTP Routes ---
app.post('/login', async (req, res) => { const { username, password } = req.body; if (!username || !password) return res.status(400).json({ status: 'error', message: 'Missing credentials' }); console.log(`Login attempt: ${username}`); const userData = await getUserData(username); if (!userData) { return res.json({ status: 'error', message: 'Invalid username or password' }); } if (userData.status === 'blocked') { console.log(`Login failed (user blocked): ${username}`); return res.json({ status: 'error', message: 'You Have Been Blocked By The Server' }); } if (!userData.password_hash) { console.error(`Data integrity error: User ${username} found but no password hash.`); return res.json({ status: 'error', message: 'Invalid user data.' });} try { const match = await bcrypt.compare(password, userData.password_hash); if (match) { console.log(`Login successful: ${username}`); // Use userId from DB
req.session.user = { userId: userData.id, username: userData.username, isAdmin: (userData.username.toLowerCase() === ADMIN_USERNAME.toLowerCase()) }; req.session.save(err => { if (err) { console.error("Session save error:", err); return res.status(500).json({ status: 'error', message: 'Session error' }); } res.json({ status: 'success', username: userData.username }); }); } else { console.log(`Login failed (password mismatch): ${username}`); res.json({ status: 'error', message: 'Invalid username or password' }); } } catch (err) { console.error("Login bcrypt error:", err); res.status(500).json({ status: 'error', message: 'Server error during login' });} });
// Register route WITHOUT recovery code
app.post('/register', async (req, res) => { const { username, password, email } = req.body; if (!username || !password || !email || username.length < 3 || password.length < 6 || !email.includes('@')) { return res.status(400).json({ status: 'error', message: 'Valid username (>=3), password (>=6), and email required.' }); } console.log(`Registration attempt: ${username}`); const existingUser = await getUserData(username); if (existingUser) { return res.json({ status: 'error', message: 'Username already exists' }); } const existingEmailUser = await getUserByEmail(email); if (existingEmailUser) { return res.json({ status: 'error', message: 'Email address already registered.' }); } console.log(`Proceeding with registration for ${username}...`); try { const passwordHash = await bcrypt.hash(password, saltRounds); const newUserId = await createUser(username, passwordHash, email); // Calls simplified createUser
    if (newUserId) { console.log(`Registration successful: ${username}`); res.json({ status: 'success', message: 'Registration successful! Please log in.' }); // NO recovery code sent
    } else { console.error(`Registration failed for ${username}, potentially DB error.`); res.status(500).json({ status: 'error', message: 'Registration failed (server error).' }); } } catch (err) { console.error("Error during registration hashing/saving:", err); res.status(500).json({ status: 'error', message: 'Server error during registration' }); } });
app.post('/logout', (req, res) => { const username = req.session?.user?.username; req.session.destroy(err => { if (err) { console.error("Error destroying session:", err); return res.status(500).json({ status: 'error', message: 'Logout failed' }); } res.clearCookie('connect.sid'); console.log(`User ${username || '(unknown)'} logged out, session destroyed.`); res.json({ status: 'success', message: 'Logged out' }); }); });

// --- Admin Section ---
function isAdmin(req, res, next) { if (req.session && req.session.user && req.session.user.isAdmin) { req.adminUsername = req.session.user.username; // Make admin username available
    return next(); } else { console.warn("Unauthorized attempt to access admin route by:", req.session?.user?.username || 'Not logged in'); res.status(403).send('Forbidden: Admin access required.'); } }
app.get('/admin', isAdmin, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

// Apply isAdmin middleware to all following /api/admin routes
app.use('/api/admin', isAdmin);

app.get('/api/admin/pending-deposits', async (req, res) => { /* ... Keep as is ... */ console.log("Admin requesting pending deposits..."); const query = `SELECT id, username, transaction_id, status, requested_at FROM deposit_requests WHERE status = 'pending' ORDER BY requested_at ASC;`; let client; try { client = await pool.connect(); const result = await client.query(query); res.json(result.rows); } catch (err) { console.error("Error fetching pending deposits for admin:", err); res.status(500).json({ message: "Error fetching requests" }); } finally { if (client) client.release(); } });
app.get('/api/admin/pending-withdrawals', async (req, res) => { /* ... Keep as is ... */ console.log("Admin requesting pending withdrawals..."); const query = `SELECT id, username, amount, upi_id, status, requested_at FROM withdrawal_requests WHERE status = 'pending' ORDER BY requested_at ASC;`; let client; try { client = await pool.connect(); const result = await client.query(query); res.json(result.rows); } catch (err) { console.error("Error fetching pending withdrawals for admin:", err); res.status(500).json({ message: "Error fetching requests" }); } finally { if (client) client.release(); } });
app.get('/api/admin/request-history', async (req, res) => { /* ... Keep as is ... */ console.log("Admin requesting processed request history..."); const query = ` (SELECT dr.id, 'deposit' as type, dr.username, dr.transaction_id as details, dr.status, dr.requested_at, dr.approved_by as processed_by, dr.approved_at as processed_at, dr.approved_amount as amount FROM deposit_requests dr WHERE dr.status != 'pending' ORDER BY COALESCE(dr.approved_at, dr.requested_at) DESC LIMIT $1) UNION ALL (SELECT wr.id, 'withdrawal' as type, wr.username, wr.upi_id as details, wr.status, wr.requested_at, wr.processed_by, wr.processed_at, wr.amount FROM withdrawal_requests wr WHERE wr.status != 'pending' ORDER BY COALESCE(wr.processed_at, wr.requested_at) DESC LIMIT $1) ORDER BY processed_at DESC NULLS LAST, requested_at DESC LIMIT $1;`; let client; try { client = await pool.connect(); const result = await client.query(query, [ADMIN_HISTORY_LIMIT]); res.json(result.rows); } catch (err) { console.error("Error fetching request history for admin:", err); res.status(500).json({ message: "Error fetching history" }); } finally { if (client) client.release(); } });

// *** MODIFIED: GET /api/admin/users - Now includes email ***
app.get('/api/admin/users', async (req, res) => {
    console.log("Admin requesting user list...");
    // *** ADDED 'email' to the SELECT statement ***
    const query = `SELECT id, username, email, balance, status, created_at FROM users ORDER BY username ASC;`;
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(query);
        // Parse balance, include email in response
        const users = result.rows.map(user => ({
            id: user.id,
            username: user.username,
            email: user.email, // Include email
            balance: parseFloat(user.balance),
            status: user.status,
            created_at: user.created_at
        }));
        res.json(users);
    } catch (err) {
        console.error("Error fetching user list for admin:", err);
        res.status(500).json({ message: "Error fetching user list" });
    } finally {
        if (client) client.release();
    }
});

app.post('/api/admin/approve-deposit', async (req, res) => { /* ... Keep as is ... */ const { requestId, verifiedAmount } = req.body; const adminUsername = req.adminUsername; // Use username from middleware
    const requestIdNum = parseInt(requestId); if (isNaN(requestIdNum) || typeof verifiedAmount !== 'number' || verifiedAmount <= 0) { return res.status(400).json({ status: 'error', message: 'Invalid Request ID or Verified Amount format.' }); } console.log(`ADMIN API: ${adminUsername} approving Deposit ID [${requestIdNum}] for amount [${verifiedAmount}]`); let client; try { client = await pool.connect(); await client.query('BEGIN'); const getRequestQuery = `SELECT dr.*, u.balance as current_balance FROM deposit_requests dr JOIN users u ON dr.username = u.username WHERE dr.id = $1 AND dr.status = 'pending' FOR UPDATE`; const requestResult = await client.query(getRequestQuery, [requestIdNum]); if (requestResult.rows.length === 0) { throw new Error(`Request ID ${requestIdNum} not found or not pending.`); } const requestData = requestResult.rows[0]; const targetUsername = requestData.username; const currentBalance = parseFloat(requestData.current_balance); const newBalance = currentBalance + verifiedAmount; const updateBalanceQuery = 'UPDATE users SET balance = $1 WHERE username = $2'; await client.query(updateBalanceQuery, [newBalance.toFixed(2), targetUsername]); const updateRequestQuery = `UPDATE deposit_requests SET status = $1, approved_by = $2, approved_amount = $3, approved_at = NOW() WHERE id = $4`; await client.query(updateRequestQuery, ['completed', adminUsername, verifiedAmount, requestIdNum]); await client.query('COMMIT'); console.log(`ADMIN API SUCCESS: Approved deposit ${requestIdNum} for ${targetUsername}.`); const targetSocketId = Object.keys(onlineUsers).find(id => onlineUsers[id] === targetUsername); if (targetSocketId) { io.to(targetSocketId).emit('balanceUpdate', { newBalance: newBalance }); io.to(targetSocketId).emit('depositResult', { success: true, message: `Your deposit was approved for ${verifiedAmount}. New balance: ${Math.floor(newBalance)}` }); console.log(`Sent updates via Socket.IO to online user ${targetUsername}`); } else { console.log(`User ${targetUsername} is offline, balance updated in DB.`); } res.json({ status: 'success', message: `Approved request ${requestIdNum}.` }); } catch (err) { if (client) await client.query('ROLLBACK'); console.error(`ADMIN API ERROR approving deposit ${requestIdNum}:`, err); res.status(500).json({ status: 'error', message: err.message || 'Server error during approval.' }); } finally { if (client) client.release(); } });
app.post('/api/admin/reject-deposit', async (req, res) => { /* ... Keep as is ... */ const { requestId } = req.body; const adminUsername = req.adminUsername; const requestIdNum = parseInt(requestId); if (isNaN(requestIdNum)) { return res.status(400).json({ status: 'error', message: 'Invalid Request ID format.' }); } console.log(`ADMIN API: ${adminUsername} rejecting Deposit ID [${requestIdNum}]`); let client; try { client = await pool.connect(); const updateQuery = `UPDATE deposit_requests SET status = $1, approved_by = $2, approved_at = NOW() WHERE id = $3 AND status = 'pending'`; const result = await client.query(updateQuery, ['rejected', adminUsername, requestIdNum]); if (result.rowCount > 0) { console.log(`ADMIN SUCCESS: Rejected deposit request ${requestIdNum}.`); res.json({ status: 'success', message: `Request ${requestIdNum} rejected.` }); } else { console.log(`ADMIN WARN: Reject deposit failed - Request ID ${requestIdNum} not found or not pending.`); res.status(404).json({ status: 'error', message: `Request ID ${requestIdNum} not found or not pending.` }); } } catch (err) { console.error(`ADMIN API ERROR rejecting deposit ${requestIdNum}:`, err); res.status(500).json({ status: 'error', message: 'Server error during rejection.' }); } finally { if (client) client.release(); } });
app.post('/api/admin/approve-withdrawal', async (req, res) => { /* ... Keep as is ... */ const { requestId } = req.body; const adminUsername = req.adminUsername; const requestIdNum = parseInt(requestId); if (isNaN(requestIdNum)) { return res.status(400).json({ status: 'error', message: 'Invalid Request ID format.' }); } console.log(`ADMIN API: ${adminUsername} approving Withdrawal Request ID [${requestIdNum}]`); let client; try { client = await pool.connect(); await client.query('BEGIN'); const getRequestQuery = `SELECT wr.*, u.balance as current_balance FROM withdrawal_requests wr JOIN users u ON wr.username = u.username WHERE wr.id = $1 AND wr.status = 'pending' FOR UPDATE`; const requestResult = await client.query(getRequestQuery, [requestIdNum]); if (requestResult.rows.length === 0) { throw new Error(`Withdrawal request ID ${requestIdNum} not found or not pending.`); } const requestData = requestResult.rows[0]; const targetUsername = requestData.username; const withdrawalAmount = parseFloat(requestData.amount); const currentBalance = parseFloat(requestData.current_balance); if (currentBalance < withdrawalAmount) { throw new Error(`User ${targetUsername} insufficient balance (needs ${withdrawalAmount}, has ${currentBalance}).`); } const newBalance = currentBalance - withdrawalAmount; const updateBalanceQuery = 'UPDATE users SET balance = $1 WHERE username = $2'; await client.query(updateBalanceQuery, [newBalance.toFixed(2), targetUsername]); const updateRequestQuery = `UPDATE withdrawal_requests SET status = $1, processed_by = $2, processed_at = NOW() WHERE id = $3`; await client.query(updateRequestQuery, ['completed', adminUsername, requestIdNum]); await client.query('COMMIT'); console.log(`ADMIN API SUCCESS: Approved withdrawal ${requestIdNum} for ${targetUsername}. Balance updated.`); const targetSocketId = Object.keys(onlineUsers).find(id => onlineUsers[id] === targetUsername); if (targetSocketId) { io.to(targetSocketId).emit('balanceUpdate', { newBalance: newBalance }); io.to(targetSocketId).emit('withdrawalResult', { success: true, message: `Your withdrawal request for ${withdrawalAmount.toFixed(2)} was processed. New balance: ${Math.floor(newBalance)}` }); console.log(`Sent updates via Socket.IO to online user ${targetUsername}`); } else { console.log(`User ${targetUsername} is offline, balance updated in DB.`); } res.json({ status: 'success', message: `Approved withdrawal request ${requestIdNum}.` }); } catch (err) { if (client) await client.query('ROLLBACK'); console.error(`ADMIN API ERROR approving withdrawal ${requestIdNum}:`, err); res.status(500).json({ status: 'error', message: err.message || 'Server error during withdrawal approval.' }); } finally { if (client) client.release(); } });
app.post('/api/admin/reject-withdrawal', async (req, res) => { /* ... Keep as is ... */ const { requestId } = req.body; const adminUsername = req.adminUsername; const requestIdNum = parseInt(requestId); if (isNaN(requestIdNum)) { return res.status(400).json({ status: 'error', message: 'Invalid Request ID.' }); } console.log(`ADMIN API: ${adminUsername} rejecting Withdrawal ID [${requestIdNum}]`); let client; try { client = await pool.connect(); const updateQuery = `UPDATE withdrawal_requests SET status = $1, processed_by = $2, processed_at = NOW() WHERE id = $3 AND status = 'pending'`; const result = await client.query(updateQuery, ['rejected', adminUsername, requestIdNum]); if (result.rowCount > 0) { console.log(`ADMIN SUCCESS: Rejected withdrawal request ${requestIdNum}.`); res.json({ status: 'success', message: `Request ${requestIdNum} rejected.` }); } else { console.log(`ADMIN WARN: Reject withdrawal failed - Req ID ${requestIdNum} not found/pending.`); res.status(404).json({ status: 'error', message: `Request ID ${requestIdNum} not found or not pending.` }); } } catch (err) { console.error(`ADMIN API ERROR rejecting withdrawal ${requestIdNum}:`, err); res.status(500).json({ status: 'error', message: 'Server error during rejection.' }); } finally { if (client) client.release(); } });

// *** MODIFIED: POST /api/admin/block-user - Uses userIdentifier ***
app.post('/api/admin/block-user', async (req, res) => {
    const { userIdentifier } = req.body; // Expect id or username
    const adminUsername = req.adminUsername;

    if (!userIdentifier) return res.status(400).json({ status: 'error', message: 'User identifier required.' });

    console.log(`ADMIN API: ${adminUsername} blocking user: ${userIdentifier}`);

    // Prevent admin from blocking themselves
    // Note: This check might need adjustment if identifier is ID vs username
    // if (String(userIdentifier).toLowerCase() === adminUsername.toLowerCase()) {
    //     return res.status(400).json({ status: 'error', message: 'Cannot block yourself.' });
    // }

    let client;
    try {
        client = await pool.connect();
        let query;
        let targetUsername = String(userIdentifier); // Default for logging/finding socket

        // Determine if identifier is likely ID (numeric) or username (string)
        if (typeof userIdentifier === 'number' || !isNaN(parseInt(userIdentifier))) {
             query = {
                 text: "UPDATE users SET status = 'blocked' WHERE id = $1 RETURNING username",
                 values: [parseInt(userIdentifier)]
             };
        } else {
             query = {
                 text: "UPDATE users SET status = 'blocked' WHERE username = $1 RETURNING username",
                 values: [userIdentifier]
             };
        }
        const result = await client.query(query);

        if (result.rowCount > 0) {
            targetUsername = result.rows[0].username; // Get actual username
            console.log(`ADMIN SUCCESS: User ${targetUsername} blocked by ${adminUsername}.`);

            // Find and disconnect socket if user is online
            const targetSocketId = Object.keys(onlineUsers).find(id => onlineUsers[id].toLowerCase() === targetUsername.toLowerCase());
            if(targetSocketId && io.sockets.sockets.get(targetSocketId)){
                try {
                    io.to(targetSocketId).emit('forceDisconnect', { message: 'Your account has been blocked.' });
                    io.sockets.sockets.get(targetSocketId).disconnect(true);
                    console.log(`Disconnected blocked user: ${targetUsername}`);
                } catch (sockErr) { console.error("Error disconnecting socket:", sockErr); }
            }
            res.json({ status: 'success', message: `User ${targetUsername} blocked.` });
        } else {
            console.log(`ADMIN WARN: Block user failed - Identifier ${userIdentifier} not found.`);
            res.status(404).json({ status: 'error', message: `User identifier '${userIdentifier}' not found.` });
        }
    } catch (err) {
        console.error(`ADMIN API ERROR blocking user ${userIdentifier}:`, err);
        res.status(500).json({ status: 'error', message: 'Server error during block operation.' });
    } finally {
        if (client) client.release();
    }
});

// *** MODIFIED: POST /api/admin/unblock-user - Uses userIdentifier ***
app.post('/api/admin/unblock-user', async (req, res) => {
    const { userIdentifier } = req.body; // Expect id or username
    const adminUsername = req.adminUsername;

    if (!userIdentifier) return res.status(400).json({ status: 'error', message: 'User identifier required.' });

    console.log(`ADMIN API: ${adminUsername} unblocking user: ${userIdentifier}`);
    let client;
    try {
        client = await pool.connect();
        let query;
        let targetUsername = String(userIdentifier); // Default

        // Determine if identifier is likely ID (numeric) or username (string)
        if (typeof userIdentifier === 'number' || !isNaN(parseInt(userIdentifier))) {
             query = {
                 text: "UPDATE users SET status = 'active' WHERE id = $1 AND status = 'blocked' RETURNING username",
                 values: [parseInt(userIdentifier)]
             };
        } else {
             query = {
                 text: "UPDATE users SET status = 'active' WHERE username = $1 AND status = 'blocked' RETURNING username",
                 values: [userIdentifier]
             };
        }
        const result = await client.query(query);

        if (result.rowCount > 0) {
            targetUsername = result.rows[0].username; // Get actual username
            console.log(`ADMIN SUCCESS: User ${targetUsername} unblocked by ${adminUsername}.`);
            res.json({ status: 'success', message: `User ${targetUsername} unblocked.` });
        } else {
            // Check if the user exists but wasn't blocked
            const checkUserQuery = typeof userIdentifier === 'number' || !isNaN(parseInt(userIdentifier))
                ? 'SELECT status FROM users WHERE id = $1'
                : 'SELECT status FROM users WHERE username = $1';
            const checkResult = await client.query(checkUserQuery, [userIdentifier]);

            if (checkResult.rowCount === 0) {
                 console.log(`ADMIN WARN: Unblock user failed - Identifier ${userIdentifier} not found.`);
                 res.status(404).json({ status: 'error', message: `User identifier '${userIdentifier}' not found.` });
            } else {
                 console.log(`ADMIN WARN: Unblock user failed - User ${userIdentifier} was not blocked (Status: ${checkResult.rows[0].status}).`);
                 res.status(400).json({ status: 'error', message: `User '${userIdentifier}' was not blocked.` });
            }
        }
    } catch (err) {
        console.error(`ADMIN API ERROR unblocking user ${userIdentifier}:`, err);
        res.status(500).json({ status: 'error', message: 'Server error during unblock operation.' });
    } finally {
        if (client) client.release();
    }
});


// *** NEW: DELETE /api/admin/remove-user - Uses userIdentifier ***
app.delete('/api/admin/remove-user', async (req, res) => {
    const { userIdentifier } = req.body; // Expect id or username
    const adminUserId = req.session.user.userId; // Get ID of admin performing action
    const adminUsername = req.adminUsername;

    if (!userIdentifier) return res.status(400).json({ status: 'error', message: 'User identifier required.' });

    console.log(`ADMIN API: ${adminUsername} (ID: ${adminUserId}) attempting to PERMANENTLY REMOVE user: ${userIdentifier}`);

    let targetUserId = null;
    let targetUsername = String(userIdentifier);

    // Determine target user's ID and username if possible, and check for self-deletion
    let client; // Declare client outside try block for broader scope
    try {
        client = await pool.connect();
        let findUserQuery;
        if (typeof userIdentifier === 'number' || !isNaN(parseInt(userIdentifier))) {
            findUserQuery = { text: 'SELECT id, username FROM users WHERE id = $1', values: [parseInt(userIdentifier)] };
        } else {
            findUserQuery = { text: 'SELECT id, username FROM users WHERE username = $1', values: [userIdentifier] };
        }
        const findResult = await client.query(findUserQuery);
        if (findResult.rowCount === 0) {
            return res.status(404).json({ status: 'error', message: `User identifier '${userIdentifier}' not found.` });
        }
        targetUserId = findResult.rows[0].id;
        targetUsername = findResult.rows[0].username; // Use actual username found

        // Prevent admin from deleting themselves
        if (targetUserId === adminUserId) {
            console.warn(`ADMIN WARN: ${adminUsername} attempted to remove their own account.`);
            return res.status(400).json({ status: 'error', message: 'Cannot remove your own account.' });
        }
        // OPTIONAL: Add check here to prevent deleting other admins if needed

        // --- IMPORTANT: Deletion Logic ---
        // This assumes ON DELETE CASCADE is set for foreign keys in deposit_requests
        // and withdrawal_requests referencing users.id. If not, you MUST manually
        // delete related records BEFORE deleting the user.
        const deleteQuery = { text: 'DELETE FROM users WHERE id = $1', values: [targetUserId] };
        const deleteResult = await client.query(deleteQuery);

        if (deleteResult.rowCount > 0) {
            console.log(`ADMIN SUCCESS: User ${targetUsername} (ID: ${targetUserId}) PERMANENTLY REMOVED by ${adminUsername}.`);
             // Optionally log this critical action to an audit table
            res.status(200).json({ status: 'success', message: `User ${targetUsername} removed.` }); // Send 200 OK
        } else {
            // Should not happen if findUser worked, but include as safeguard
            console.error(`ADMIN ERROR: Found user ${targetUsername} but failed to delete.`);
            res.status(500).json({ status: 'error', message: 'Deletion failed unexpectedly after finding user.' });
        }

    } catch (err) {
        console.error(`ADMIN API ERROR removing user ${userIdentifier}:`, err);
        // Check for specific DB errors e.g., foreign key violation if cascade wasn't set
        res.status(500).json({ status: 'error', message: 'Server error during remove operation.' });
    } finally {
        if (client) client.release();
    }
});

// --- Game Logic Functions ---
// [Keep all game logic functions: generateCrashPoint, calculateMultiplier, gameTick, setBettingState, setPreparingState, setRunningState, broadcastPlayerCount]
function generateCrashPoint() { const r = Math.random(); let crash; if (r < 0.02) { crash = 1.00; } else if (r < 0.50) { crash = 1.01 + Math.random() * 0.98; } else if (r < 0.80) { crash = 2 + Math.random() * 3; } else if (r < 0.95) { crash = 5 + Math.random() * 10; } else { crash = 15 + Math.random() * 15; } return Math.max(1.00, parseFloat(crash.toFixed(2))); }
function calculateMultiplier(timeMillis) { const base = 1.00; const growthRate = 0.08; const exponent = 1.3; const multiplier = base + growthRate * Math.pow(timeMillis / 1000, exponent); return Math.max(1.00, parseFloat(multiplier.toFixed(2))); }
function gameTick() { if (gameState !== 'RUNNING') { clearInterval(tickIntervalId); return; } const elapsed = Date.now() - gameStartTime; currentMultiplier = calculateMultiplier(elapsed); if (currentMultiplier >= crashPoint) { clearInterval(tickIntervalId); currentMultiplier = crashPoint; gameState = 'ENDED'; console.log(`SERVER: Crashed at ${currentMultiplier}x`); io.emit('gameCrash', { multiplier: currentMultiplier }); gameHistory.unshift(currentMultiplier); gameHistory = gameHistory.slice(0, MAX_HISTORY_ITEMS_SERVER); io.emit('historyUpdate', gameHistory); clearTimeout(nextStateTimeoutId); nextStateTimeoutId = setTimeout(setBettingState, CRASHED_DURATION); } else { io.emit('multiplierUpdate', { multiplier: currentMultiplier }); } }
function setBettingState() { clearTimeout(nextStateTimeoutId); clearInterval(tickIntervalId); console.log("SERVER: Betting phase starting..."); gameState = 'BETTING'; currentMultiplier = 1.00; crashPoint = 0; players = {}; io.emit('gameState', { state: 'BETTING', duration: BETTING_DURATION }); nextStateTimeoutId = setTimeout(setPreparingState, BETTING_DURATION); }
function setPreparingState() { clearTimeout(nextStateTimeoutId); console.log("SERVER: Preparing phase starting..."); gameState = 'PREPARING'; crashPoint = generateCrashPoint(); console.log(`SERVER: Next crash point determined: ${crashPoint}x`); io.emit('gameState', { state: 'PREPARING', duration: PREPARING_DURATION }); nextStateTimeoutId = setTimeout(setRunningState, PREPARING_DURATION); }
function setRunningState() { clearTimeout(nextStateTimeoutId); console.log("SERVER: Running phase starting..."); gameState = 'RUNNING'; currentMultiplier = 1.00; gameStartTime = Date.now(); io.emit('gameState', { state: 'RUNNING', multiplier: currentMultiplier }); clearInterval(tickIntervalId); tickIntervalId = setInterval(gameTick, GAME_TICK_INTERVAL); }
function broadcastPlayerCount() { const count = Object.keys(onlineUsers).length; console.log(`Broadcasting player count: ${count}`); io.emit('playerCountUpdate', { count: count }); }


// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.emit('gameState', { state: gameState, multiplier: currentMultiplier, duration: gameState === 'BETTING' ? BETTING_DURATION : (gameState === 'PREPARING' ? PREPARING_DURATION : 0) });
    socket.emit('historyUpdate', gameHistory);

    socket.on('authenticate', async (data) => { const username = data?.username; const userData = await getUserData(username); if (!username || !userData) { console.log(`Authentication failed for socket ${socket.id} - user ${username} not found.`); socket.disconnect(true); return; } if (userData.status === 'blocked') { console.log(`Blocked user ${username} attempted socket connection.`); socket.emit('forceDisconnect', { message: 'Your account is blocked.' }); socket.disconnect(true); return; } console.log(`Socket ${socket.id} authenticated as user ${username}`); onlineUsers[socket.id] = username; socket.emit('balanceUpdate', { newBalance: userData.balance }); broadcastPlayerCount(); });
    socket.on('placeBet', async (data) => { const username = onlineUsers[socket.id]; if (!username) return socket.emit('betError', { message: "Not authenticated." }); if (gameState !== 'BETTING') return socket.emit('betError', { message: "Betting phase is over." }); const amount = parseInt(data?.amount); if (isNaN(amount) || amount <= 0) return socket.emit('betError', { message: "Invalid bet amount." }); const userData = await getUserData(username); if (!userData || userData.balance < amount) { return socket.emit('betError', { message: "Insufficient balance." }); } let newBalance = userData.balance - amount; let updateSuccess = await updateUserBalance(username, newBalance); if (updateSuccess) { players[socket.id] = { betAmount: amount, cashedOutAt: null }; console.log(`Player ${username} bet ${amount}. New balance: ${newBalance}`); socket.emit('betSuccess', { amount: amount }); socket.emit('balanceUpdate', { newBalance: newBalance }); } else { socket.emit('betError', { message: "Failed to place bet (server error)." }); } });
    socket.on('cashOut', async () => { const username = onlineUsers[socket.id]; if (!username) return; if (gameState !== 'RUNNING') return; const player = players[socket.id]; if (!player || player.cashedOutAt !== null) return; player.cashedOutAt = currentMultiplier; const winnings = player.betAmount * player.cashedOutAt; const userData = await getUserData(username); if (userData === null) { console.error(`Could not read user data for ${username} during cashout.`); socket.emit('cashOutSuccess', { multiplier: currentMultiplier, amount: player.betAmount }); return; } let newBalance = userData.balance + winnings; let updateSuccess = await updateUserBalance(username, newBalance); if (updateSuccess) { console.log(`Player ${username} cashed out at ${currentMultiplier}x, won ${winnings.toFixed(2)}. New balance: ${newBalance}`); socket.emit('cashOutSuccess', { multiplier: currentMultiplier, amount: player.betAmount }); socket.emit('balanceUpdate', { newBalance: newBalance }); } else { console.error(`Could not update balance for ${username} after cashout.`); socket.emit('cashOutSuccess', { multiplier: currentMultiplier, amount: player.betAmount }); } });
    socket.on('submitDepositRequest', async (data) => { const username = onlineUsers[socket.id]; if (!username) { return socket.emit('depositResult', { success: false, message: "Authentication error." }); } const transactionId = data?.transactionId?.trim(); if (!transactionId || transactionId.length < 10 || transactionId.length > 255) { // Adjusted max length
        return socket.emit('depositResult', { success: false, message: "Invalid Transaction ID format (10-255 chars)." }); } const userData = await getUserData(username); if (!userData) return socket.emit('depositResult', { success: false, message: "User not found." }); const insertQuery = `INSERT INTO deposit_requests (user_id, username, transaction_id, status) VALUES ($1, $2, $3, $4) RETURNING id;`; const values = [userData.id, username.toLowerCase(), transactionId, 'pending']; let client; try { client = await pool.connect(); const result = await client.query(insertQuery, values); const requestId = result.rows[0].id; console.log(`--- DEPOSIT REQUEST LOGGED [ID: ${requestId}] ---\nUsername: ${username}\nTransaction ID: ${transactionId}\nStatus: pending\nTime: ${new Date().toISOString()}\n---------------------------------`); socket.emit('depositResult', { success: null, pending: true, message: "Deposit submitted for manual review. Balance updated after verification." }); } catch (err) { console.error(`Error saving deposit request to PostgreSQL for ${username} (Txn: ${transactionId}):`, err); socket.emit('depositResult', { success: false, message: "Error submitting request. Please try again." }); } finally { if (client) client.release(); } });
    socket.on('submitWithdrawalRequest', async (data) => { const username = onlineUsers[socket.id]; if (!username) return socket.emit('withdrawalResult', { success: false, message: "Authentication error." }); const amount = parseFloat(data?.amount); const upiId = data?.upiId?.trim(); if (isNaN(amount) || amount <= 0 || amount < 100) { return socket.emit('withdrawalResult', { success: false, message: "Invalid amount (Min withdrawal ₹100)." }); } if (!upiId || !upiId.includes('@') || upiId.length < 5) { return socket.emit('withdrawalResult', { success: false, message: "Invalid UPI ID format." }); } console.log(`Received withdrawal request from ${username} for ${amount} to UPI ${upiId}`); let client; try { client = await pool.connect(); const userData = await getUserData(username); if (!userData) { throw new Error("User not found."); } if (userData.balance < amount) { throw new Error("Insufficient balance for withdrawal."); } const insertQuery = `INSERT INTO withdrawal_requests (user_id, username, amount, upi_id, status) VALUES ($1, $2, $3, $4, $5) RETURNING id;`; const values = [userData.id, username.toLowerCase(), amount, upiId, 'pending']; const result = await client.query(insertQuery, values); const requestId = result.rows[0].id; console.log(`--- WITHDRAWAL REQUEST LOGGED [ID: ${requestId}] ---\nUsername: ${username}\nAmount: ${amount}\nUPI ID: ${upiId}\nStatus: pending\nTime: ${new Date().toISOString()}\n-------------------------------------`); socket.emit('withdrawalResult', { success: null, pending: true, message: "Withdrawal request submitted for manual processing." }); } catch (err) { console.error(`Error saving withdrawal request to PostgreSQL for ${username}:`, err); socket.emit('withdrawalResult', { success: false, message: err.message || "Error submitting withdrawal request. Please try again." }); } finally { if (client) client.release(); } });
    socket.on('forceDisconnect', (data) => { console.log(`Received forceDisconnect from server for socket ${socket.id}. Reason: ${data?.message}`); socket.disconnect(true); /* Client side needs to handle this too */ });

    socket.on('disconnect', (reason) => { const username = onlineUsers[socket.id]; console.log(`Client disconnected: ${socket.id}${username ? ` (${username})` : ''}. Reason: ${reason}`); delete players[socket.id]; delete onlineUsers[socket.id]; broadcastPlayerCount(); });
});


// --- Start the Server ---
async function startServer() {
    console.log("Attempting DB Connection & Table Setup...");
    try {
        await setupDatabase(); // Ensure ALL tables exist
        server.listen(port, () => { // Start web server AFTER setup check
            console.log(`Crash Game Server using PostgreSQL listening on port ${port}`);
            setBettingState(); // Start game loop
        });
    } catch (dbError) {
         console.error("!!! FATAL: FAILED TO CONNECT TO DB OR SETUP TABLES !!!");
         console.error("Ensure DATABASE_URL environment variable is correct and the Render DB is available.");
         console.error(dbError); process.exit(1);
    }
}

startServer(); // Call the async function to start the server process.