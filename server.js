// server.js - Uses Render PostgreSQL, Bcrypt, Synced Game, Manual Deposit & Admin Approval (Admin set to MyGameAdmin)

const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const { Pool } = require('pg'); // Import the pg Pool class for PostgreSQL
const bcrypt = require('bcrypt'); // Import bcrypt for password hashing

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Use port provided by hosting environment (Render) or default to 3000
const port = process.env.PORT || 3000;
const saltRounds = 10; // Cost factor for bcrypt hashing

// --- PostgreSQL Connection Pool ---
// Reads the connection string from the DATABASE_URL environment variable
if (!process.env.DATABASE_URL) {
    console.error("FATAL ERROR: DATABASE_URL environment variable is not set!");
    console.error("Please add DATABASE_URL to your Render Environment Variables.");
    process.exit(1); // Stop the server if the database URL is missing
}
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Render PostgreSQL might require SSL. Add this block if you get SSL connection errors later.
    // ssl: {
    //   rejectUnauthorized: false
    // }
});

// --- Function to Setup Database Tables ---
// Creates 'users' and 'deposit_requests' tables if they don't exist
async function setupDatabase() {
    const client = await pool.connect();
    console.log("Checking/Creating database tables ('users', 'deposit_requests')...");
    const createUserTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(60) NOT NULL,
        balance DECIMAL(12, 2) DEFAULT 10.00 NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    `;
    const createDepositTableQuery = `
    CREATE TABLE IF NOT EXISTS deposit_requests (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        transaction_id VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' NOT NULL, -- pending, completed, rejected
        requested_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        approved_by VARCHAR(50) NULL,
        approved_amount DECIMAL(12, 2) NULL,
        approved_at TIMESTAMPTZ NULL
    );
    `;
    try {
        await client.query(createUserTableQuery);
        console.log("Database table 'users' checked/created successfully.");
        await client.query(createDepositTableQuery);
        console.log("Database table 'deposit_requests' checked/created successfully.");
    } catch (err) {
        console.error("ERROR creating/checking database tables:", err);
    } finally {
        client.release();
    }
}

// --- Game State & Constants ---
const BETTING_DURATION = 7000;
const PREPARING_DURATION = 3000;
const CRASHED_DURATION = 4000;
const GAME_TICK_INTERVAL = 100;
const MAX_HISTORY_ITEMS_SERVER = 20;
let gameState = 'IDLE';
let currentMultiplier = 1.00;
let crashPoint = 0;
let gameStartTime = 0;
let tickIntervalId = null;
let nextStateTimeoutId = null;
let players = {}; // In-memory bet/cashout status for CURRENT round
let gameHistory = [];
let onlineUsers = {}; // In-memory map: { socket.id: username }
const INITIAL_BALANCE = 10.00; // Initial balance for new users

// --- Middleware ---
app.use(express.json());

// --- Serve Static Files ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// --- PostgreSQL Database Helper Functions ---

// Gets user data object { id, username, password_hash, balance } or null
async function getUserData(username) {
    if (!username) return null;
    const query = 'SELECT id, username, password_hash, balance FROM users WHERE username = $1';
    const values = [username.toLowerCase()];
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(query, values);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            user.balance = parseFloat(user.balance);
            return user;
        } else { return null; }
    } catch (err) { console.error(`Error in getUserData for ${username}:`, err); return null; }
    finally { if (client) client.release(); }
}

// Creates a new user in the DB
async function createUser(username, passwordHash) {
     if (!username || !passwordHash) return false;
     const query = 'INSERT INTO users (username, password_hash, balance) VALUES ($1, $2, $3) RETURNING id';
     const values = [username.toLowerCase(), passwordHash, INITIAL_BALANCE];
     let client;
     try {
        client = await pool.connect();
        const result = await client.query(query, values);
        console.log(`[createUser] User ${username} created with ID: ${result.rows[0].id}`);
        return true;
     } catch(err) {
         if (err.code === '23505') { console.log(`[createUser] Attempted to register existing username: ${username}`); }
         else { console.error(`Error creating user ${username}:`, err); }
         return false;
     } finally { if (client) client.release(); }
}

// Updates only the balance for a user
async function updateUserBalance(username, newBalance) {
    if (!username || typeof newBalance !== 'number') return false;
    const query = 'UPDATE users SET balance = $1 WHERE username = $2';
    const values = [newBalance.toFixed(2), username.toLowerCase()];
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(query, values);
        if (result.rowCount > 0) {
            console.log(`[updateUserBalance] Updated DB balance for ${username} to ${newBalance.toFixed(2)}`);
            return true;
        } else { console.error(`[updateUserBalance] User ${username} not found during balance update (rowCount was 0).`); return false; }
    } catch (err) { console.error(`Error updating balance for ${username}:`, err); return false; }
    finally { if (client) client.release(); }
}

// --- Authentication HTTP Routes ---

// LOGIN Endpoint
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) { return res.status(400).json({ status: 'error', message: 'Missing credentials' }); }
    console.log(`Login attempt: ${username}`);
    const userData = await getUserData(username);
    if (!userData || !userData.password_hash) { return res.json({ status: 'error', message: 'Invalid username or password' }); }
    try {
        const match = await bcrypt.compare(password, userData.password_hash);
        if (match) { console.log(`Login successful: ${username}`); res.json({ status: 'success', username: username }); }
        else { console.log(`Login failed (password mismatch): ${username}`); res.json({ status: 'error', message: 'Invalid username or password' }); }
    } catch (compareError) { console.error(`Error during bcrypt.compare for ${username}:`, compareError); res.status(500).json({ status: 'error', message: 'Server error during login' }); }
});

// REGISTER Endpoint
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || username.length < 3 || password.length < 6) { return res.status(400).json({ status: 'error', message: 'Username >= 3 chars, Password >= 6 chars.' }); }
    console.log(`Registration attempt: ${username}`);
    const existingUser = await getUserData(username);
    if (existingUser) { return res.json({ status: 'error', message: 'Username already exists' }); }
    console.log(`Proceeding with registration for ${username}...`);
    try {
        const passwordHash = await bcrypt.hash(password, saltRounds);
        const success = await createUser(username, passwordHash);
        if (success) { console.log(`Registration successful: ${username}`); res.json({ status: 'success', message: 'Registration successful! Please log in.' }); }
        else { console.error(`Registration failed for ${username}, potentially DB error.`); res.status(500).json({ status: 'error', message: 'Registration failed (server error).' }); }
    } catch (err) { console.error("Error during registration hashing/saving:", err); res.status(500).json({ status: 'error', message: 'Server error during registration' }); }
});

// --- Game Logic Functions ---
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
    // Don't broadcast count or send balance until authenticated

    socket.on('authenticate', async (data) => {
        const username = data?.username;
        const userData = await getUserData(username); // Check DB
        if (!username || !userData) { console.log(`Authentication failed for socket ${socket.id} - user ${username} not found.`); socket.disconnect(true); return; }
        console.log(`Socket ${socket.id} authenticated as user ${username}`);
        onlineUsers[socket.id] = username;
        socket.emit('balanceUpdate', { newBalance: userData.balance }); // Send DB balance
        broadcastPlayerCount();
    });

    socket.on('placeBet', async (data) => {
        const username = onlineUsers[socket.id];
        if (!username) return socket.emit('betError', { message: "Not authenticated." });
        if (gameState !== 'BETTING') return socket.emit('betError', { message: "Betting phase is over." });
        const amount = parseInt(data?.amount);
        if (isNaN(amount) || amount <= 0) return socket.emit('betError', { message: "Invalid bet amount." });
        const userData = await getUserData(username);
        if (!userData || userData.balance < amount) { return socket.emit('betError', { message: "Insufficient balance." }); }
        let newBalance = userData.balance - amount;
        let updateSuccess = await updateUserBalance(username, newBalance);
        if (updateSuccess) { players[socket.id] = { betAmount: amount, cashedOutAt: null }; console.log(`Player ${username} bet ${amount}. New balance: ${newBalance}`); socket.emit('betSuccess', { amount: amount }); socket.emit('balanceUpdate', { newBalance: newBalance }); }
        else { socket.emit('betError', { message: "Failed to place bet (server error)." }); }
    });

    socket.on('cashOut', async () => {
        const username = onlineUsers[socket.id];
        if (!username) return; if (gameState !== 'RUNNING') return;
        const player = players[socket.id];
        if (!player || player.cashedOutAt !== null) return;
        player.cashedOutAt = currentMultiplier;
        const winnings = player.betAmount * player.cashedOutAt;
        const userData = await getUserData(username);
        if (userData === null) { console.error(`Could not read user data for ${username} during cashout.`); socket.emit('cashOutSuccess', { multiplier: currentMultiplier, amount: player.betAmount }); return; }
        let newBalance = userData.balance + winnings;
        let updateSuccess = await updateUserBalance(username, newBalance);
        if (updateSuccess) { console.log(`Player ${username} cashed out at ${currentMultiplier}x, won ${winnings.toFixed(2)}. New balance: ${newBalance}`); socket.emit('cashOutSuccess', { multiplier: currentMultiplier, amount: player.betAmount }); socket.emit('balanceUpdate', { newBalance: newBalance }); }
        else { console.error(`Could not update balance for ${username} after cashout.`); socket.emit('cashOutSuccess', { multiplier: currentMultiplier, amount: player.betAmount }); }
    });

    // Listener for Manual Deposit Requests (Saves to PostgreSQL)
    socket.on('submitDepositRequest', async (data) => {
        const username = onlineUsers[socket.id];
        if (!username) { return socket.emit('depositResult', { success: false, message: "Authentication error." }); }
        const transactionId = data?.transactionId?.trim();
        if (!transactionId || transactionId.length < 10 || transactionId.length > 20) { return socket.emit('depositResult', { success: false, message: "Invalid Transaction ID format." }); }
        const insertQuery = `INSERT INTO deposit_requests (username, transaction_id, status) VALUES ($1, $2, $3) RETURNING id;`;
        const values = [username, transactionId, 'pending'];
        let client;
        try {
            client = await pool.connect();
            const result = await client.query(insertQuery, values);
            const requestId = result.rows[0].id;
            console.log(`--- DEPOSIT REQUEST LOGGED [ID: ${requestId}] ---\nUsername: ${username}\nTransaction ID: ${transactionId}\nStatus: pending\nTime: ${new Date().toISOString()}\n---------------------------------`);
            socket.emit('depositResult', { success: null, pending: true, message: "Deposit submitted for manual review. Balance updated after verification." });
        } catch (err) { console.error(`Error saving deposit request to PostgreSQL for ${username} (Txn: ${transactionId}):`, err); socket.emit('depositResult', { success: false, message: "Error submitting request. Please try again." }); }
        finally { if (client) client.release(); }
    });

    // Listener for Admin Deposit Approval (Updates PostgreSQL DB)
    socket.on('adminApproveDeposit', async (data) => {
        const adminUsername = onlineUsers[socket.id];
        const { requestId, verifiedAmount } = data;
        // --- Basic Security Check ---
        const ADMIN_USERNAME = 'MyGameAdmin'; // <<< Your Admin Username is SET HERE <<<
        // --- End Security Check ---
        if (adminUsername !== ADMIN_USERNAME) { console.warn(`Unauthorized admin command attempt by: ${adminUsername || socket.id}`); return socket.emit('adminResult', { success: false, message: 'Not authorized.' }); }
        const requestIdNum = parseInt(requestId);
        if (isNaN(requestIdNum) || typeof verifiedAmount !== 'number' || verifiedAmount <= 0) { return socket.emit('adminResult', { success: false, message: 'Invalid Request ID or Verified Amount format.' }); }
        console.log(`ADMIN COMMAND: ${adminUsername} attempting to approve Request ID [${requestIdNum}] for amount [${verifiedAmount}]`);
        let client;
        try {
            client = await pool.connect();
            const getRequestQuery = `SELECT * FROM deposit_requests WHERE id = $1 AND status = 'pending' FOR UPDATE`; // Lock row during transaction
            const requestResult = await client.query(getRequestQuery, [requestIdNum]);
            if (requestResult.rows.length === 0) { console.log(`ADMIN WARN: Deposit request ID ${requestIdNum} not found or not pending.`); client.release(); return socket.emit('adminResult', { success: false, message: `Request ID ${requestIdNum} not found or not pending.` }); }
            const requestData = requestResult.rows[0]; const targetUsername = requestData.username;
            const userData = await getUserData(targetUsername); // Uses PG helper
            if (!userData) { console.error(`ADMIN ERROR: Target user ${targetUsername} for request ID ${requestIdNum} not found!`); client.release(); return socket.emit('adminResult', { success: false, message: `Target user ${targetUsername} not found.` }); }
            const currentBalance = userData.balance; const newBalance = currentBalance + verifiedAmount;
            const updateSuccess = await updateUserBalance(targetUsername, newBalance); // Uses PG helper
            if (updateSuccess) {
                console.log(`ADMIN SUCCESS: Balance for ${targetUsername} updated to ${newBalance}.`);
                const updateRequestQuery = `UPDATE deposit_requests SET status = $1, approved_by = $2, approved_amount = $3, approved_at = NOW() WHERE id = $4`;
                await client.query(updateRequestQuery, ['completed', adminUsername, verifiedAmount, requestIdNum]);
                console.log(`Marked deposit request ID ${requestIdNum} as completed.`);
                const targetSocketId = Object.keys(onlineUsers).find(id => onlineUsers[id] === targetUsername);
                if (targetSocketId) { io.to(targetSocketId).emit('balanceUpdate', { newBalance: newBalance }); io.to(targetSocketId).emit('depositResult', { success: true, message: `Your deposit was approved for ${verifiedAmount}. New balance: ${Math.floor(newBalance)}` }); console.log(`Sent updates to online user ${targetUsername}`); }
                else { console.log(`User ${targetUsername} is offline, balance updated in DB.`); }
                socket.emit('adminResult', { success: true, message: `Successfully updated balance for ${targetUsername} to ${newBalance}. Request ID ${requestIdNum} marked completed.` });
            } else { console.error(`ADMIN ERROR: Failed to update balance for ${targetUsername} via updateUserBalance.`); socket.emit('adminResult', { success: false, message: `Failed to update balance in DB for ${targetUsername}.` }); }
        } catch (err) { console.error(`ADMIN ERROR processing approval for Request ID ${requestIdNum}:`, err); socket.emit('adminResult', { success: false, message: 'Server error during approval process.' }); }
        finally { if (client) client.release(); }
    });

    socket.on('disconnect', () => {
        const username = onlineUsers[socket.id];
        console.log(`Client disconnected: ${socket.id}` + (username ? ` (${username})` : ''));
        delete players[socket.id]; delete onlineUsers[socket.id];
        broadcastPlayerCount();
    });
});

// --- Start the Server ---
async function startServer() {
    console.log("Attempting to connect to PostgreSQL and setup DB tables...");
    try {
        // Test connection and setup tables before starting server fully
        const client = await pool.connect();
        console.log("PostgreSQL DB connected temporarily for setup check.");
        await setupDatabase(); // Ensure tables exist
        client.release();
        // If we reached here, DB connection and table setup worked
        server.listen(port, () => { // Now start listening
            console.log(`Crash Game Server with PostgreSQL listening on port ${port}`);
            setBettingState(); // Start the game cycle
        });
    } catch (dbError) {
         console.error("!!! FAILED TO CONNECT TO POSTGRESQL DATABASE OR SETUP TABLE !!!");
         console.error("Ensure DATABASE_URL environment variable is correct and the Render DB is available.");
         console.error(dbError);
    }
}

startServer(); // Call the async function to start the server process