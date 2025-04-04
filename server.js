// server.js - Uses Replit DB for Auth/Balance & Bcrypt for Passwords (with REFINED getUserData fix & DEBUG LOGS)

const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const Database = require("@replit/database"); // Import Replit Database client
const bcrypt = require('bcrypt'); // Import bcrypt for password hashing

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const db = new Database(process.env.REPLIT_DB_URL); // Initialize DB client

const port = process.env.PORT || 3000;
const saltRounds = 10; // Cost factor for bcrypt hashing

// --- Middleware ---
app.use(express.json()); // Needed to parse JSON body from client fetch requests

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
let players = {}; // In-memory bet/cashout status for CURRENT round: { socket.id: { betAmount: number, cashedOutAt: number | null } }
let gameHistory = [];
let onlineUsers = {}; // In-memory map: { socket.id: username }
const INITIAL_BALANCE = 10; // Set initial balance to 10 for new users

// --- Serve Static Files ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Database Helper Functions ---

// Gets user data object { passwordHash, balance } OR null if not found/error (REFINED VERSION)
async function getUserData(username) {
    if (!username) return null;
    const key = "user_" + username.toLowerCase(); // Use consistent key format
    // *** DEBUG LOG ***
    console.log(`[getUserData REFINED DEBUG] Checking DB for key: '${key}'`);
    try {
        const rawData = await db.get(key); // Get potentially wrapped data
        // *** DEBUG LOG ***
        console.log(`[getUserData REFINED DEBUG] db.get raw returned value for key '${key}':`, JSON.stringify(rawData));

        // Check 1: Is the raw data exactly null or undefined? If so, user not found.
        if (rawData === null || typeof rawData === 'undefined') {
             console.log(`[getUserData REFINED DEBUG] db.get returned null/undefined. User not found.`);
             return null;
        }

        // Check 2: Is it the specific {ok: false} error structure? If so, treat as not found/error.
         if (typeof rawData === 'object' && rawData !== null && rawData.ok === false) {
             console.log(`[getUserData REFINED DEBUG] db.get returned {ok: false}. User not found or error.`);
             return null;
        }

        // Check 3: Is it the specific {ok: true, value: ...} wrapper structure?
        if (typeof rawData === 'object' && rawData !== null && rawData.ok === true && rawData.hasOwnProperty('value')) {
            console.log(`[getUserData REFINED DEBUG] Found wrapped data {ok: true} for key '${key}'. Returning inner value.`);
            // Return the actual user data stored in the 'value' property.
            // Also handle if 'value' itself is null/undefined inside the wrapper.
            return rawData.value || null;
        }

        // Fallback: If it's not null and not the known {ok:...} structures,
        // assume it might be the direct user data object itself (less likely now).
        console.warn(`[getUserData REFINED DEBUG] db.get returned unexpected structure for key '${key}'. Assuming it's direct user data.`);
        return rawData;

    } catch (error) {
        // *** DEBUG LOG ***
        console.error(`[getUserData REFINED DEBUG] Exception during db.get for key '${key}':`, error);
        return null; // Return null on any exception
    }
}


// Sets user data object { passwordHash, balance } in Replit DB
async function setUserData(username, data) {
    if (!username) return false;
    try {
        const key = "user_" + username.toLowerCase();
        await db.set(key, data); // Store the plain data object
        console.log(`[setUserData] Successfully set data for key '${key}'`);
        return true;
    } catch (error) {
        console.error(`[setUserData] Error setting data for user ${username}:`, error);
        return false;
    }
}

// Updates only the balance for a user in Replit DB
async function updateUserBalance(username, newBalance) {
    if (!username) return false;
    try {
        // Use the refined getUserData to get the current user object correctly
        const currentUserData = await getUserData(username);
        if (!currentUserData) { // Check if user actually exists (getUserData returns null if not)
            console.error(`[updateUserBalance] Cannot update balance, user ${username} not found.`);
            return false;
        }
        // Modify the retrieved user data object's balance property
        currentUserData.balance = parseFloat(newBalance.toFixed(2)); // Ensure number, 2 decimals
        // Use setUserData to save the entire modified object back
        const success = await setUserData(username, currentUserData);
        if (success) {
           console.log(`[updateUserBalance] Updated balance for ${username} to ${currentUserData.balance}`);
        }
        return success;
    } catch (error) {
        console.error(`[updateUserBalance] Error updating balance in DB for ${username}:`, error);
        return false;
    }
}


// --- Authentication HTTP Routes (Using Replit DB & Bcrypt + Debugging) ---

// LOGIN Endpoint (with Enhanced Debugging)
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
         console.log("[Login Route DEBUG] Missing username or password in request.");
         return res.status(400).json({ status: 'error', message: 'Missing credentials' });
    }

    // *** DEBUG LOG ***
    console.log(`[Login Route DEBUG] Login attempt for username: ${username}`);
    const userData = await getUserData(username); // Uses the REFINED version with logs
    // *** DEBUG LOG ***
    console.log(`[Login Route DEBUG] User data retrieved by login route for ${username}:`, JSON.stringify(userData));

    // Check if user data was retrieved successfully (is not null) and has a password hash
    if (!userData || !userData.passwordHash) {
        console.log(`[Login Route DEBUG] Login failed because user ${username} not found in DB (userData is null/falsy) or passwordHash missing.`);
        return res.json({ status: 'error', message: 'Invalid username or password' }); // Keep error generic
    }

    // *** DEBUG LOG ***
    console.log(`[Login Route DEBUG] Comparing provided password "${password}" (length ${password?.length}) with stored hash "${userData.passwordHash}"`);

    try {
        // Compare submitted password with stored hash using bcrypt
        const match = await bcrypt.compare(password, userData.passwordHash);
        // *** DEBUG LOG ***
        console.log(`[Login Route DEBUG] bcrypt.compare result (passwords match?): ${match}`); // Log boolean result

        if (match) {
            console.log(`[Login Route DEBUG] Passwords match for ${username}. Login successful.`);
            res.json({ status: 'success', username: username }); // Send username back
        } else {
            console.log(`[Login Route DEBUG] Passwords DO NOT match for ${username}.`);
            res.json({ status: 'error', message: 'Invalid username or password' });
        }
    } catch (compareError) {
         console.error(`[Login Route DEBUG] Error during bcrypt.compare for ${username}:`, compareError);
         res.status(500).json({ status: 'error', message: 'Server error during login comparison' });
    }
});

// REGISTER Endpoint (with Debugging)
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || username.length < 3 || password.length < 6) {
         return res.status(400).json({ status: 'error', message: 'Username >= 3 chars, Password >= 6 chars.' });
    }

    // *** DEBUG LOG ***
    console.log(`[Register Route DEBUG] Registration attempt: ${username}`);
    const existingUser = await getUserData(username); // Calls the updated function
    // *** DEBUG LOG ***
    console.log(`[Register Route DEBUG] Value of existingUser BEFORE 'if' check:`, JSON.stringify(existingUser));

    // This check should now ONLY be true if getUserData found and returned the actual user data object
    if (existingUser !== null) {
        // *** DEBUG LOG ***
        console.log(`[Register Route DEBUG] existingUser is NOT strictly null ('${JSON.stringify(existingUser)}'), sending 'Username already exists' error.`);
        return res.json({ status: 'error', message: 'Username already exists' });
    }

    // *** DEBUG LOG ***
    console.log(`[Register Route DEBUG] existingUser IS null, proceeding with registration...`);
    try {
        // Hash the password before saving
        const passwordHash = await bcrypt.hash(password, saltRounds);
        const newUser = {
            passwordHash: passwordHash, // Store the hash
            balance: INITIAL_BALANCE    // Set initial balance (now 10)
        };
        // Use the function to save the user data
        const success = await setUserData(username, newUser);

        if (success) {
            // *** DEBUG LOG ***
            console.log(`[Register Route DEBUG] Registration successful in DB for: ${username}`);
            res.json({ status: 'success', message: 'Registration successful! Please log in.' });
        } else {
            console.error(`[Register Route DEBUG] setUserData failed for ${username}`);
            throw new Error("Failed to save user data."); // Trigger catch block
        }
    } catch (err) {
        console.error("[Register Route DEBUG] Error during password hashing or saving:", err);
        res.status(500).json({ status: 'error', message: 'Server error during registration' });
    }
});


// --- Game Logic Functions ---
function generateCrashPoint() { const r = Math.random(); let crash; if (r < 0.02) { crash = 1.00; } else if (r < 0.50) { crash = 1.01 + Math.random() * 0.98; } else if (r < 0.80) { crash = 2 + Math.random() * 3; } else if (r < 0.95) { crash = 5 + Math.random() * 10; } else { crash = 15 + Math.random() * 15; } return Math.max(1.00, parseFloat(crash.toFixed(2))); }
function calculateMultiplier(timeMillis) { const base = 1.00; const growthRate = 0.08; const exponent = 1.3; const multiplier = base + growthRate * Math.pow(timeMillis / 1000, exponent); return Math.max(1.00, parseFloat(multiplier.toFixed(2))); }
function gameTick() { if (gameState !== 'RUNNING') { clearInterval(tickIntervalId); return; } const elapsed = Date.now() - gameStartTime; currentMultiplier = calculateMultiplier(elapsed); if (currentMultiplier >= crashPoint) { clearInterval(tickIntervalId); currentMultiplier = crashPoint; gameState = 'ENDED'; console.log(`SERVER: Crashed at ${currentMultiplier}x`); io.emit('gameCrash', { multiplier: currentMultiplier }); gameHistory.unshift(currentMultiplier); gameHistory = gameHistory.slice(0, MAX_HISTORY_ITEMS_SERVER); io.emit('historyUpdate', gameHistory); clearTimeout(nextStateTimeoutId); nextStateTimeoutId = setTimeout(setBettingState, CRASHED_DURATION); } else { io.emit('multiplierUpdate', { multiplier: currentMultiplier }); } }
function setBettingState() { clearTimeout(nextStateTimeoutId); clearInterval(tickIntervalId); console.log("SERVER: Betting phase starting..."); gameState = 'BETTING'; currentMultiplier = 1.00; crashPoint = 0; players = {}; io.emit('gameState', { state: 'BETTING', duration: BETTING_DURATION }); nextStateTimeoutId = setTimeout(setPreparingState, BETTING_DURATION); }
function setPreparingState() { clearTimeout(nextStateTimeoutId); console.log("SERVER: Preparing phase starting..."); gameState = 'PREPARING'; crashPoint = generateCrashPoint(); console.log(`SERVER: Next crash point determined: ${crashPoint}x`); io.emit('gameState', { state: 'PREPARING', duration: PREPARING_DURATION }); nextStateTimeoutId = setTimeout(setRunningState, PREPARING_DURATION); }
function setRunningState() { clearTimeout(nextStateTimeoutId); console.log("SERVER: Running phase starting..."); gameState = 'RUNNING'; currentMultiplier = 1.00; gameStartTime = Date.now(); io.emit('gameState', { state: 'RUNNING', multiplier: currentMultiplier }); clearInterval(tickIntervalId); tickIntervalId = setInterval(gameTick, GAME_TICK_INTERVAL); }
function broadcastPlayerCount() { const count = Object.keys(onlineUsers).length; console.log(`Broadcasting player count: ${count}`); io.emit('playerCountUpdate', { count: count }); }


// --- Socket.IO Connection Handling (Uses Replit DB for Balance) ---
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Send initial game state and history
    socket.emit('gameState', { state: gameState, multiplier: currentMultiplier, duration: gameState === 'BETTING' ? BETTING_DURATION : (gameState === 'PREPARING' ? PREPARING_DURATION : 0) });
    socket.emit('historyUpdate', gameHistory);
    // Don't broadcast count or send balance until authenticated

    // Client authenticates itself after successful HTTP login
    socket.on('authenticate', async (data) => {
        const username = data?.username;
        const userData = await getUserData(username); // Check if user exists in DB

        if (!username || !userData) { // Check if user data was actually found
            console.log(`Authentication failed for socket ${socket.id} - user ${username} not found in DB.`);
            socket.disconnect(true); // Disconnect invalid users
            return;
        }
        console.log(`Socket ${socket.id} authenticated as user ${username}`);
        onlineUsers[socket.id] = username; // Map socket ID to username

        socket.emit('balanceUpdate', { newBalance: userData.balance }); // Send balance from DB
        broadcastPlayerCount(); // Update count now that user is authenticated
    });

    // Handle 'placeBet'
    socket.on('placeBet', async (data) => {
        const username = onlineUsers[socket.id];
        if (!username) { return socket.emit('betError', { message: "Not authenticated." }); }
        if (gameState !== 'BETTING') { return socket.emit('betError', { message: "Betting phase is over." }); }

        const amount = parseInt(data?.amount);
        if (isNaN(amount) || amount <= 0) { return socket.emit('betError', { message: "Invalid bet amount." }); }

        const userData = await getUserData(username); // Get current data from DB
        if (!userData || userData.balance < amount) {
            return socket.emit('betError', { message: "Insufficient balance." });
        }

        let newBalance = userData.balance - amount;
        let updateSuccess = await updateUserBalance(username, newBalance); // Update in DB

        if (updateSuccess) {
            players[socket.id] = { betAmount: amount, cashedOutAt: null }; // Track bet for the round
            console.log(`Player ${username} (${socket.id}) bet ${amount}. New balance: ${newBalance}`);
            socket.emit('betSuccess', { amount: amount });
            socket.emit('balanceUpdate', { newBalance: newBalance }); // Confirm balance update
        } else {
             console.error(`Failed to update balance in DB after bet for ${username}`);
             socket.emit('betError', { message: "Failed to place bet (server error)." });
        }
    });

    // Handle 'cashOut'
    socket.on('cashOut', async () => {
        const username = onlineUsers[socket.id];
        if (!username) return; // Not authenticated
        if (gameState !== 'RUNNING') { return; } // Can only cash out while running

        const player = players[socket.id];
        if (!player || player.cashedOutAt !== null) { return; } // No bet or already cashed out

        player.cashedOutAt = currentMultiplier; // Mark cashout multiplier locally for this round

        const winnings = player.betAmount * player.cashedOutAt;
        const userData = await getUserData(username); // Get current data from DB
        if (userData === null) {
             console.error(`Could not read user data for ${username} during cashout.`);
             socket.emit('cashOutSuccess', { multiplier: currentMultiplier, amount: player.betAmount }); // Ack but no balance update sent
             return;
        }

        let newBalance = userData.balance + winnings;
        let updateSuccess = await updateUserBalance(username, newBalance); // Update in DB

        if (updateSuccess) {
            console.log(`Player ${username} (${socket.id}) cashed out at ${currentMultiplier}x, won ${winnings.toFixed(2)}. New balance: ${newBalance}`);
            socket.emit('cashOutSuccess', { multiplier: currentMultiplier, amount: player.betAmount });
            socket.emit('balanceUpdate', { newBalance: newBalance }); // Send updated balance
        } else {
             console.error(`Could not update balance for ${username} after cashout.`);
             socket.emit('cashOutSuccess', { multiplier: currentMultiplier, amount: player.betAmount }); // Still acknowledge cashout attempt
        }
    });

    // Handle client disconnection
    socket.on('disconnect', () => {
        const username = onlineUsers[socket.id];
        console.log(`Client disconnected: ${socket.id}` + (username ? ` (${username})` : ''));
        delete players[socket.id];      // Remove from active round players
        delete onlineUsers[socket.id];  // Remove from username map
        // Balance persists in DB, no need to delete from memory here
        broadcastPlayerCount(); // Update count after user mapping removed
    });
});

// --- Start the Server ---
server.listen(port, () => {
    console.log(`Crash Game Server listening on port ${port}`);
    // Start the game cycle
    setBettingState();
});