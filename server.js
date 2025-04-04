// server.js - Uses Render PostgreSQL for Auth/Balance & Bcrypt for Passwords

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
    // Render PostgreSQL might require SSL. Add this block if you get SSL connection errors.
    // ssl: {
    //   rejectUnauthorized: false
    // }
});

// --- Function to Setup Database Table ---
// Creates the 'users' table if it doesn't already exist when the server starts
async function setupDatabase() {
    const client = await pool.connect(); // Get a client from the pool
    console.log("Checking/Creating database table 'users'...");
    const createTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(60) NOT NULL,
        balance DECIMAL(12, 2) DEFAULT 10.00 NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    `;
    try {
        await client.query(createTableQuery); // Execute the create table command
        console.log("Database table 'users' check/creation successful.");
    } catch (err) {
        console.error("ERROR creating/checking database table 'users':", err);
        // Consider stopping the server if the table setup fails critically
        // process.exit(1);
    } finally {
        client.release(); // VERY IMPORTANT: Release the client back to the pool
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
let players = {}; // In-memory bet/cashout status for CURRENT round { socket.id: { betAmount: number, cashedOutAt: number | null } }
let gameHistory = [];
let onlineUsers = {}; // In-memory map: { socket.id: username }
const INITIAL_BALANCE = 10.00; // Initial balance for new users

// --- Middleware ---
app.use(express.json()); // To parse JSON from Fetch requests

// --- Serve Static Files ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// --- PostgreSQL Database Helper Functions ---

// Gets user data { id, username, password_hash, balance } from DB
async function getUserData(username) {
    if (!username) return null;
    const query = 'SELECT id, username, password_hash, balance FROM users WHERE username = $1';
    const values = [username.toLowerCase()]; // Use parameterized query
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(query, values);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            user.balance = parseFloat(user.balance); // Ensure balance is number
            // console.log(`[getUserData] Found user: ${username}`); // Optional log
            return user;
        } else {
            // console.log(`[getUserData] User not found: ${username}`); // Optional log
            return null;
        }
    } catch (err) {
        console.error(`Error in getUserData for ${username}:`, err);
        return null;
    } finally {
        if (client) client.release(); // Release client in finally block
    }
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
         if (err.code === '23505') { // Handle unique constraint violation
             console.log(`[createUser] Attempted to register existing username: ${username}`);
         } else {
             console.error(`Error creating user ${username}:`, err);
         }
         return false; // Indicate failure
     } finally {
        if (client) client.release();
     }
}

// Updates only the balance for a user
async function updateUserBalance(username, newBalance) {
    if (!username || typeof newBalance !== 'number') return false;
    const query = 'UPDATE users SET balance = $1 WHERE username = $2';
    // Ensure balance is formatted correctly for DECIMAL type in DB
    const values = [newBalance.toFixed(2), username.toLowerCase()];
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(query, values);
        if (result.rowCount > 0) {
            console.log(`[updateUserBalance] Updated DB balance for ${username} to ${newBalance.toFixed(2)}`);
            return true;
        } else {
             console.error(`[updateUserBalance] User ${username} not found during balance update (rowCount was 0).`);
             return false;
        }
    } catch (err) {
        console.error(`Error updating balance for ${username}:`, err);
        return false;
    } finally {
        if (client) client.release();
    }
}

// --- Authentication HTTP Routes (Using PostgreSQL & Bcrypt) ---

// LOGIN Endpoint
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) { return res.status(400).json({ status: 'error', message: 'Missing credentials' }); }
    console.log(`Login attempt: ${username}`);
    const userData = await getUserData(username); // Get user from PostgreSQL

    if (!userData || !userData.password_hash) {
        console.log(`Login failed (user ${username} not found or DB error).`);
        return res.json({ status: 'error', message: 'Invalid username or password' });
    }

    try {
        const match = await bcrypt.compare(password, userData.password_hash);
        console.log(`Login bcrypt.compare result for ${username}: ${match}`);
        if (match) {
            console.log(`Login successful: ${username}`);
            res.json({ status: 'success', username: username });
        } else {
            console.log(`Login failed (password mismatch): ${username}`);
            res.json({ status: 'error', message: 'Invalid username or password' });
        }
    } catch (compareError) {
         console.error(`Error during bcrypt.compare for ${username}:`, compareError);
         res.status(500).json({ status: 'error', message: 'Server error during login' });
    }
});

// REGISTER Endpoint
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || username.length < 3 || password.length < 6) {
         return res.status(400).json({ status: 'error', message: 'Username >= 3 chars, Password >= 6 chars.' });
    }
    console.log(`Registration attempt: ${username}`);

    const existingUser = await getUserData(username);
    if (existingUser) { // Check if user data was found
        return res.json({ status: 'error', message: 'Username already exists' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, saltRounds);
        const success = await createUser(username, passwordHash); // Create user in PostgreSQL

        if (success) {
            console.log(`Registration successful: ${username}`);
            res.json({ status: 'success', message: 'Registration successful! Please log in.' });
        } else {
             // createUser handles duplicate check, so this implies another DB error
             console.error(`Registration failed for ${username}, potentially DB error.`);
             res.status(500).json({ status: 'error', message: 'Registration failed (server error).' });
        }
    } catch (err) {
        console.error("Error during registration hashing/saving:", err);
        res.status(500).json({ status: 'error', message: 'Server error during registration' });
    }
});


// --- Game Logic Functions (Same as before) ---
function generateCrashPoint() { const r = Math.random(); let crash; if (r < 0.02) { crash = 1.00; } else if (r < 0.50) { crash = 1.01 + Math.random() * 0.98; } else if (r < 0.80) { crash = 2 + Math.random() * 3; } else if (r < 0.95) { crash = 5 + Math.random() * 10; } else { crash = 15 + Math.random() * 15; } return Math.max(1.00, parseFloat(crash.toFixed(2))); }
function calculateMultiplier(timeMillis) { const base = 1.00; const growthRate = 0.08; const exponent = 1.3; const multiplier = base + growthRate * Math.pow(timeMillis / 1000, exponent); return Math.max(1.00, parseFloat(multiplier.toFixed(2))); }
function gameTick() { if (gameState !== 'RUNNING') { clearInterval(tickIntervalId); return; } const elapsed = Date.now() - gameStartTime; currentMultiplier = calculateMultiplier(elapsed); if (currentMultiplier >= crashPoint) { clearInterval(tickIntervalId); currentMultiplier = crashPoint; gameState = 'ENDED'; console.log(`SERVER: Crashed at ${currentMultiplier}x`); io.emit('gameCrash', { multiplier: currentMultiplier }); gameHistory.unshift(currentMultiplier); gameHistory = gameHistory.slice(0, MAX_HISTORY_ITEMS_SERVER); io.emit('historyUpdate', gameHistory); clearTimeout(nextStateTimeoutId); nextStateTimeoutId = setTimeout(setBettingState, CRASHED_DURATION); } else { io.emit('multiplierUpdate', { multiplier: currentMultiplier }); } }
function setBettingState() { clearTimeout(nextStateTimeoutId); clearInterval(tickIntervalId); console.log("SERVER: Betting phase starting..."); gameState = 'BETTING'; currentMultiplier = 1.00; crashPoint = 0; players = {}; io.emit('gameState', { state: 'BETTING', duration: BETTING_DURATION }); nextStateTimeoutId = setTimeout(setPreparingState, BETTING_DURATION); }
function setPreparingState() { clearTimeout(nextStateTimeoutId); console.log("SERVER: Preparing phase starting..."); gameState = 'PREPARING'; crashPoint = generateCrashPoint(); console.log(`SERVER: Next crash point determined: ${crashPoint}x`); io.emit('gameState', { state: 'PREPARING', duration: PREPARING_DURATION }); nextStateTimeoutId = setTimeout(setRunningState, PREPARING_DURATION); }
function setRunningState() { clearTimeout(nextStateTimeoutId); console.log("SERVER: Running phase starting..."); gameState = 'RUNNING'; currentMultiplier = 1.00; gameStartTime = Date.now(); io.emit('gameState', { state: 'RUNNING', multiplier: currentMultiplier }); clearInterval(tickIntervalId); tickIntervalId = setInterval(gameTick, GAME_TICK_INTERVAL); }
function broadcastPlayerCount() { const count = Object.keys(onlineUsers).length; console.log(`Broadcasting player count: ${count}`); io.emit('playerCountUpdate', { count: count }); }


// --- Socket.IO Connection Handling (Uses PostgreSQL for Balance) ---
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.emit('gameState', { state: gameState, multiplier: currentMultiplier, duration: gameState === 'BETTING' ? BETTING_DURATION : (gameState === 'PREPARING' ? PREPARING_DURATION : 0) });
    socket.emit('historyUpdate', gameHistory);
    // Don't broadcast count or send balance until authenticated

    socket.on('authenticate', async (data) => {
        const username = data?.username;
        const userData = await getUserData(username); // Check PostgreSQL
        if (!username || !userData) {
            console.log(`Authentication failed for socket ${socket.id} - user ${username} not found.`);
            socket.disconnect(true); return;
        }
        console.log(`Socket ${socket.id} authenticated as user ${username}`);
        onlineUsers[socket.id] = username;
        socket.emit('balanceUpdate', { newBalance: userData.balance }); // Send balance from DB
        broadcastPlayerCount();
    });

    socket.on('placeBet', async (data) => {
        const username = onlineUsers[socket.id];
        if (!username) return socket.emit('betError', { message: "Not authenticated." });
        if (gameState !== 'BETTING') return socket.emit('betError', { message: "Betting phase is over." });
        const amount = parseInt(data?.amount);
        if (isNaN(amount) || amount <= 0) return socket.emit('betError', { message: "Invalid bet amount." });

        const userData = await getUserData(username); // Get current balance from DB
        if (!userData || userData.balance < amount) {
            return socket.emit('betError', { message: "Insufficient balance." });
        }
        let newBalance = userData.balance - amount;
        let updateSuccess = await updateUserBalance(username, newBalance); // Update in DB

        if (updateSuccess) {
            players[socket.id] = { betAmount: amount, cashedOutAt: null };
            console.log(`Player ${username} bet ${amount}. New balance: ${newBalance}`);
            socket.emit('betSuccess', { amount: amount });
            socket.emit('balanceUpdate', { newBalance: newBalance });
        } else { socket.emit('betError', { message: "Failed to place bet (server error)." }); }
    });

    socket.on('cashOut', async () => {
        const username = onlineUsers[socket.id];
        if (!username) return; if (gameState !== 'RUNNING') return;
        const player = players[socket.id];
        if (!player || player.cashedOutAt !== null) return;

        player.cashedOutAt = currentMultiplier;
        const winnings = player.betAmount * player.cashedOutAt;
        const userData = await getUserData(username); // Get current balance from DB
        if (userData === null) {
             console.error(`Could not read user data for ${username} during cashout.`);
             socket.emit('cashOutSuccess', { multiplier: currentMultiplier, amount: player.betAmount }); return;
        }
        let newBalance = userData.balance + winnings;
        let updateSuccess = await updateUserBalance(username, newBalance); // Update in DB

        if (updateSuccess) {
            console.log(`Player ${username} cashed out at ${currentMultiplier}x, won ${winnings.toFixed(2)}. New balance: ${newBalance}`);
            socket.emit('cashOutSuccess', { multiplier: currentMultiplier, amount: player.betAmount });
            socket.emit('balanceUpdate', { newBalance: newBalance });
        } else {
             console.error(`Could not update balance for ${username} after cashout.`);
             socket.emit('cashOutSuccess', { multiplier: currentMultiplier, amount: player.betAmount });
        }
    });

    // Listener for Manual Deposit Requests (Logs to console, saves request to Replit DB for review)
    socket.on('submitDepositRequest', async (data) => {
        const username = onlineUsers[socket.id];
        if (!username) { return socket.emit('depositResult', { success: false, message: "Authentication error." }); }
        const transactionId = data?.transactionId?.trim();
        if (!transactionId || transactionId.length < 10 || transactionId.length > 20) { return socket.emit('depositResult', { success: false, message: "Invalid Transaction ID format." }); }
        const requestKey = `deposit_${Date.now()}_${username}`;
        const requestData = { username: username, transactionId: transactionId, status: 'pending', requestedAt: new Date().toISOString() };
        console.log(`\n--- DEPOSIT REQUEST RECEIVED ---\nUsername: ${username}\nTransaction ID: ${transactionId}\nRequest Key: ${requestKey}\nTime: ${requestData.requestedAt}\n----------------------------`);
        try {
            // Using Replit DB just to log the request easily - NOT for balance
            const requestDb = new Database(process.env.REPLIT_DB_URL); // Separate client instance maybe? Or use main 'db'
            await requestDb.set(requestKey, requestData);
            console.log(`Stored deposit request under key: ${requestKey} in Replit DB`);
            socket.emit('depositResult', { success: null, pending: true, message: "Deposit submitted for manual review. Balance will be updated after verification." });
        } catch (err) { console.error(`Error saving deposit request for ${username} (Txn: ${transactionId}):`, err); socket.emit('depositResult', { success: false, message: "Error submitting request. Please try again." }); }
    });

    // Listener for Admin Deposit Approval (Updates PostgreSQL DB)
    socket.on('adminApproveDeposit', async (data) => {
        const adminUsername = onlineUsers[socket.id];
        const { requestKey, verifiedAmount } = data;
        const ADMIN_USERNAME = 'YOUR_ADMIN_USERNAME'; // <<< CHANGE THIS
        if (adminUsername !== ADMIN_USERNAME) { console.warn(`Unauthorized admin command attempt by: ${adminUsername || socket.id}`); return socket.emit('adminResult', { success: false, message: 'Not authorized.' }); }
        if (!requestKey || typeof verifiedAmount !== 'number' || verifiedAmount <= 0) { return socket.emit('adminResult', { success: false, message: 'Invalid request key or amount.' }); }
        console.log(`ADMIN COMMAND: ${adminUsername} attempting to approve ${requestKey} for amount ${verifiedAmount}`);
        try {
            // Still using Replit DB to fetch/update the *request status* record
             const requestDb = new Database(process.env.REPLIT_DB_URL);
            const requestData = await requestDb.get(requestKey);
            if (!requestData || requestData.status !== 'pending') { console.log(`ADMIN WARN: Deposit request ${requestKey} not found or not pending.`); return socket.emit('adminResult', { success: false, message: `Request ${requestKey} not found or not pending.` }); }
            const targetUsername = requestData.username;

            // Update balance in PostgreSQL
            const userData = await getUserData(targetUsername); // Get user from PG
            if (!userData) { console.error(`ADMIN ERROR: Target user ${targetUsername} not found!`); return socket.emit('adminResult', { success: false, message: `Target user ${targetUsername} not found.` }); }
            const currentBalance = userData.balance;
            const newBalance = currentBalance + verifiedAmount;
            const updateSuccess = await updateUserBalance(targetUsername, newBalance); // Update PG balance

            if (updateSuccess) {
                console.log(`ADMIN SUCCESS: PG Balance for ${targetUsername} updated to ${newBalance}.`);
                requestData.status = 'completed'; requestData.approvedBy = adminUsername; requestData.approvedAmount = verifiedAmount; requestData.approvedAt = new Date().toISOString();
                await requestDb.set(requestKey, requestData); // Update request status in Replit DB
                const targetSocketId = Object.keys(onlineUsers).find(id => onlineUsers[id] === targetUsername);
                if (targetSocketId) { io.to(targetSocketId).emit('balanceUpdate', { newBalance: newBalance }); io.to(targetSocketId).emit('depositResult', { success: true, message: `Your deposit was approved for ${verifiedAmount}. New balance: ${Math.floor(newBalance)}` }); console.log(`Sent updates to online user ${targetUsername}`); }
                else { console.log(`User ${targetUsername} is offline, balance updated in DB.`); }
                socket.emit('adminResult', { success: true, message: `Successfully updated balance for ${targetUsername} to ${newBalance}. Request marked completed.` });
            } else { console.error(`ADMIN ERROR: Failed to update PG balance for ${targetUsername}.`); socket.emit('adminResult', { success: false, message: `Failed to update balance in DB for ${targetUsername}.` }); }
        } catch (err) { console.error(`ADMIN ERROR processing approval for ${requestKey}:`, err); socket.emit('adminResult', { success: false, message: 'Server error during approval process.' }); }
    });


    socket.on('disconnect', () => {
        const username = onlineUsers[socket.id];
        console.log(`Client disconnected: ${socket.id}` + (username ? ` (${username})` : ''));
        delete players[socket.id];
        delete onlineUsers[socket.id];
        broadcastPlayerCount();
    });
});

// --- Start the Server ---
async function startServer() {
    console.log("Attempting to connect to PostgreSQL and setup DB table...");
    // Test DB connection and setup table before starting server fully
    try {
        const client = await pool.connect(); // Try connecting
        console.log("PostgreSQL DB connected temporarily for setup check.");
        await setupDatabase(); // Make sure table exists
        client.release(); // Release the client
        // If we reached here, DB connection and table setup worked
        server.listen(port, () => { // Now start listening for web requests
            console.log(`Crash Game Server with PostgreSQL listening on port ${port}`);
            setBettingState(); // Start the game cycle
        });
    } catch (dbError) {
         console.error("!!! FAILED TO CONNECT TO POSTGRESQL DATABASE OR SETUP TABLE !!!");
         console.error("Ensure DATABASE_URL environment variable/secret is correct and the Render DB is available.");
         console.error(dbError);
         // Don't start the game loop if DB isn't ready
    }
}

startServer(); // Call the async function to start the server process