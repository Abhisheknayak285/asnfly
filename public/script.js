// public/script.js - Client for Synchronized Crash Game - FULL VERSION

document.addEventListener('DOMContentLoaded', () => {
    console.log("Full Multiplayer crash game client script loaded.");

    // --- Get DOM Elements ---
    // Auth
    const authContainer = document.getElementById('authContainer');
    const gameWrapper = document.getElementById('gameWrapper');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const loginUsernameInput = document.getElementById('loginUsername');
    const loginPasswordInput = document.getElementById('loginPassword');
    const registerUsernameInput = document.getElementById('registerUsername');
    const registerPasswordInput = document.getElementById('registerPassword');
    const registerConfirmPasswordInput = document.getElementById('registerConfirmPassword');
    const loginError = document.getElementById('loginError');
    const registerError = document.getElementById('registerError');
    const loginButton = document.getElementById('loginButton');
    const registerButton = document.getElementById('registerButton');
    const showRegisterLink = document.getElementById('showRegister');
    const showLoginLink = document.getElementById('showLogin');
    // Game Core
    const multiplierDisplay = document.getElementById('multiplier');
    const gameStatusDisplay = document.getElementById('gameStatus');
    const rocket = document.getElementById('rocket');
    const balanceDisplay = document.getElementById('balance');
    const playerCountDisplay = document.getElementById('playerCount');
    const mainHistoryDisplay = document.getElementById('mainHistoryDisplay');
    const gameNotification = document.getElementById('gameNotification');
    const cloudsBackground = document.querySelector('.clouds-background');
    // Controls
    const betAmountInput = document.getElementById('betAmount');
    const mainActionButton = document.getElementById('mainActionButton');
    const potentialWinDisplay = document.getElementById('potentialWinDisplay');
    const decreaseBetBtn = document.getElementById('decreaseBet');
    const increaseBetBtn = document.getElementById('increaseBet');
    const quickBetBtns = document.querySelectorAll('.quick-bet-btn');
    // Menu & Popups
    const menuIcon = document.getElementById('menuIcon');
    const mainMenuPopup = document.getElementById('mainMenuPopup');
    const closeMenuButton = document.getElementById('closeMenuButton');
    const menuWalletBtn = document.getElementById('menuWalletBtn');
    const menuAutoBtn = document.getElementById('menuAutoBtn');
    const menuSoundBtn = document.getElementById('menuSoundBtn');
    const menuSoundIcon = document.getElementById('menuSoundIcon');
    const logoutButton = document.getElementById('logoutButton');
    const walletPopup = document.getElementById('walletPopup');
    const autoPopup = document.getElementById('autoPopup');
    const closeWalletButton = document.getElementById('closeWalletButton');
    const closeAutoButton = document.getElementById('closeAutoButton');
    // Wallet Inner Elements
    const showAddMoneyBtn = document.getElementById('showAddMoneyBtn');
    const showWithdrawMoneyBtn = document.getElementById('showWithdrawMoneyBtn');
    const addMoneySection = document.getElementById('addMoneySection');
    const withdrawMoneySection = document.getElementById('withdrawMoneySection');
    const paymentMethodSelect = document.getElementById('paymentMethod');
    const upiDetailsDiv = document.getElementById('upiDetails');
    const qrCodeDetailsDiv = document.getElementById('qrCodeDetails');
    const transactionIdSection = document.getElementById('transactionIdSection');
    const transactionIdInput = document.getElementById('transactionIdInput');
    const submitDepositButton = document.getElementById('submitDepositButton');
    const depositStatus = document.getElementById('depositStatus');
    const withdrawAmountInput = document.getElementById('withdrawAmountInput');
    const userUpiIdInput = document.getElementById('userUpiIdInput');
    const submitWithdrawalButton = document.getElementById('submitWithdrawalButton');
    const withdrawalStatus = document.getElementById('withdrawalStatus');


    // --- Client State Variables ---
    let currentBetThisRound = null;
    let hasCashedOutThisRound = false;
    let currentServerState = 'IDLE';
    let socket = null;
    let soundEnabled = true;
    let loggedInUsername = null;
    let notificationTimeout = null;

    // --- Helper Functions ---
    function setBetControlsDisabled(disabled) { if (betAmountInput) betAmountInput.disabled = disabled; if (decreaseBetBtn) decreaseBetBtn.disabled = disabled; if (increaseBetBtn) increaseBetBtn.disabled = disabled; if (quickBetBtns) quickBetBtns.forEach(btn => btn.disabled = disabled); }
    function updateRocketPosition(multiplier) { if (!rocket) return; if (currentServerState !== 'RUNNING') { rocket.className = 'rocket-placeholder'; rocket.style.bottom = ''; rocket.style.left = ''; if (cloudsBackground) cloudsBackground.classList.remove('clouds-active'); return; } rocket.classList.add('flying'); if (cloudsBackground) cloudsBackground.classList.add('clouds-active'); const growthRate = 0.08; const exponent = 1.3; const timeApproximation = multiplier <= 1.00 ? 0 : Math.pow((multiplier - 1.00) / growthRate, 1 / exponent) * 1000; const initialPosPercent = 5; const speedFactor = 7; const accelerationFactor = 1.25; const maxPosPercent = 88; let positionPercentage = initialPosPercent + speedFactor * Math.pow(timeApproximation / 1000, accelerationFactor); positionPercentage = Math.min(maxPosPercent, positionPercentage); const initialLeftPercent = 10; const maxLeftPercent = 90; const diagonalFactor = 0.9; let leftPercentage = initialLeftPercent + (positionPercentage - initialPosPercent) * diagonalFactor; leftPercentage = Math.min(maxLeftPercent, leftPercentage); rocket.style.bottom = `${positionPercentage}%`; rocket.style.left = `${leftPercentage}%`; }
    function resetUIForNewRound() { if (!multiplierDisplay || !gameStatusDisplay || !mainActionButton) return; multiplierDisplay.textContent = '1.00x'; multiplierDisplay.className = 'multiplier-zone'; gameStatusDisplay.textContent = 'Place your bet!'; mainActionButton.textContent = 'Place Bet'; mainActionButton.className = 'state-idle'; mainActionButton.disabled = false; setBetControlsDisabled(false); currentBetThisRound = null; hasCashedOutThisRound = false; if (rocket) { rocket.className = 'rocket-placeholder'; rocket.style.bottom = ''; rocket.style.left = ''; } if (potentialWinDisplay) { potentialWinDisplay.classList.add('hidden'); potentialWinDisplay.textContent = ''; } if (betAmountInput) betAmountInput.classList.remove('hidden'); if (cloudsBackground) cloudsBackground.classList.remove('clouds-active'); }
    function openPopup(popupElement) { if (popupElement) popupElement.classList.remove('hidden'); }
    function closePopup(popupElement) { if (popupElement) popupElement.classList.add('hidden'); }
    function closeAllPopups() { closePopup(mainMenuPopup); closePopup(walletPopup); closePopup(autoPopup); }
    function updateHistoryDisplay(historyArray) { if (!mainHistoryDisplay) return; mainHistoryDisplay.innerHTML = ''; if (!historyArray || historyArray.length === 0) { mainHistoryDisplay.innerHTML = '<span class="history-empty-message">No history yet.</span>'; return; } const itemsToDisplay = historyArray.slice(0, 12); itemsToDisplay.forEach(multiplier => { const item = document.createElement('div'); item.classList.add('history-item'); if (multiplier < 1.5) item.classList.add('low'); else if (multiplier < 5) item.classList.add('medium'); else item.classList.add('high'); item.innerHTML = `<span class="history-item-multiplier">${multiplier.toFixed(2)}x</span>`; mainHistoryDisplay.appendChild(item); }); }
    function updateSoundIcon() { if (!menuSoundIcon) return; if (soundEnabled) { menuSoundIcon.textContent = '🔊'; menuSoundIcon.classList.remove('muted'); } else { menuSoundIcon.textContent = '🔇'; menuSoundIcon.classList.add('muted'); } }
    function toggleSound() { soundEnabled = !soundEnabled; updateSoundIcon(); console.log('Sound Enabled:', soundEnabled); /* Add sound logic */ }
    function displayLoginError(message) { if(loginError) { loginError.textContent = message; loginError.classList.remove('success-message'); loginError.classList.add('show'); } }
    function clearLoginError() { if(loginError) { loginError.textContent = ''; loginError.classList.remove('show', 'success-message'); } }
    function displayRegisterError(message) { if(registerError) { registerError.textContent = message; registerError.classList.remove('success-message'); registerError.classList.add('show'); } }
    function clearRegisterError() { if(registerError) { registerError.textContent = ''; registerError.classList.remove('show', 'success-message'); } }
    function showGameNotification(message, type = 'error', duration = 3000) { if (!gameNotification) return; if (notificationTimeout) { clearTimeout(notificationTimeout); } gameNotification.textContent = message; gameNotification.className = 'game-notification'; if (type) { gameNotification.classList.add(type); } gameNotification.classList.add('show'); notificationTimeout = setTimeout(() => { gameNotification.classList.remove('show'); }, duration); }

    // --- Show/Hide Auth vs Game ---
    function showGameScreen() { if (!authContainer || !gameWrapper) return; console.log("Showing game screen..."); authContainer.classList.add('hidden'); gameWrapper.classList.remove('hidden'); if(gameStatusDisplay) gameStatusDisplay.textContent = "Connecting..."; if(multiplierDisplay) multiplierDisplay.textContent = "---"; if(balanceDisplay) balanceDisplay.textContent = "..."; if(playerCountDisplay) playerCountDisplay.textContent = "-"; if(mainHistoryDisplay) mainHistoryDisplay.innerHTML = ''; closeAllPopups(); }
    function showAuthScreen() { if (!authContainer || !gameWrapper) return; console.log("Showing auth screen..."); if(socket) { socket.disconnect(); socket = null; } loggedInUsername = null; authContainer.classList.remove('hidden'); gameWrapper.classList.add('hidden'); clearLoginError(); clearRegisterError(); if(loginForm) loginForm.reset(); if(registerForm) registerForm.reset(); closeAllPopups(); }

    // --- WebSocket Connection ---
    function connectWebSocket() {
        if (socket) { console.log("WebSocket already connected or connecting."); return; }
        if (!loggedInUsername) { console.error("Cannot connect WebSocket without loggedInUsername."); return; }
        console.log("Initializing WebSocket connection...");
        socket = io();

        socket.on('connect', () => {
            console.log('Connected to server!', socket.id);
            if (gameStatusDisplay) gameStatusDisplay.textContent = "Authenticating...";
            console.log(`Sending authenticate event for user: ${loggedInUsername}`);
            socket.emit('authenticate', { username: loggedInUsername });
        });

        // --- Socket Event Listeners ---
        socket.on('disconnect', () => { console.log('Disconnected from server.'); if (gameStatusDisplay) gameStatusDisplay.textContent = "Disconnected! Refresh page."; if (multiplierDisplay) multiplierDisplay.textContent = '---'; if (mainActionButton) { mainActionButton.textContent = 'Offline'; mainActionButton.disabled = true; } setBetControlsDisabled(true); if (rocket) rocket.className = 'rocket-placeholder'; if (cloudsBackground) cloudsBackground.classList.remove('clouds-active'); currentBetThisRound = null; hasCashedOutThisRound = false; currentServerState = 'IDLE'; socket = null; });
        socket.on('gameState', (data) => { console.log('Server gameState:', data.state); if (!multiplierDisplay || !gameStatusDisplay || !mainActionButton) return; currentServerState = data.state; switch (data.state) { case 'BETTING': resetUIForNewRound(); gameStatusDisplay.textContent = `Place your bet! (${(data.duration / 1000).toFixed(0)}s left)`; break; case 'PREPARING': gameStatusDisplay.textContent = `Get Ready! Launching soon...`; mainActionButton.textContent = currentBetThisRound ? 'Bet Placed' : 'Waiting for Launch'; mainActionButton.className = 'state-waiting_start'; mainActionButton.disabled = true; setBetControlsDisabled(true); if(rocket) rocket.className = 'rocket-placeholder'; if(cloudsBackground) cloudsBackground.classList.remove('clouds-active'); if(potentialWinDisplay) potentialWinDisplay.classList.add('hidden'); if(currentBetThisRound && betAmountInput) betAmountInput.classList.add('hidden'); break; case 'RUNNING': gameStatusDisplay.textContent = "🚀 Rocket Launched!"; multiplierDisplay.textContent = `${data.multiplier.toFixed(2)}x`; multiplierDisplay.className = 'multiplier-zone running'; if (currentBetThisRound && !hasCashedOutThisRound) { mainActionButton.textContent = `Cash Out @ ${data.multiplier.toFixed(2)}x`; mainActionButton.className = 'state-running'; mainActionButton.disabled = false; const potentialWin = currentBetThisRound.amount * data.multiplier; if(potentialWinDisplay) { potentialWinDisplay.textContent = potentialWin.toFixed(2); potentialWinDisplay.classList.remove('hidden'); } if(betAmountInput) betAmountInput.classList.add('hidden'); } else { mainActionButton.textContent = 'In Progress'; mainActionButton.className = 'state-waiting_start'; mainActionButton.disabled = true; if(potentialWinDisplay) potentialWinDisplay.classList.add('hidden'); if(betAmountInput) betAmountInput.classList.remove('hidden'); } setBetControlsDisabled(true); updateRocketPosition(data.multiplier); break; } });
        socket.on('multiplierUpdate', (data) => { if (currentServerState !== 'RUNNING' || !multiplierDisplay) return; multiplierDisplay.textContent = `${data.multiplier.toFixed(2)}x`; if (currentBetThisRound && !hasCashedOutThisRound) { mainActionButton.textContent = `Cash Out @ ${data.multiplier.toFixed(2)}x`; const potentialWin = currentBetThisRound.amount * data.multiplier; if(potentialWinDisplay) potentialWinDisplay.textContent = potentialWin.toFixed(2); } updateRocketPosition(data.multiplier); });
        socket.on('gameCrash', (data) => { if (!multiplierDisplay || !gameStatusDisplay || !mainActionButton) return; console.log('Server gameCrash:', data.multiplier); currentServerState = 'ENDED'; multiplierDisplay.textContent = `${data.multiplier.toFixed(2)}x`; multiplierDisplay.className = 'multiplier-zone crashed'; if(rocket) rocket.className = 'rocket-placeholder crashed'; if(cloudsBackground) cloudsBackground.classList.remove('clouds-active'); setBetControlsDisabled(true); if (currentBetThisRound) { if (hasCashedOutThisRound) { gameStatusDisplay.textContent = `Round Finished. Crashed @ ${data.multiplier.toFixed(2)}x`; } else { mainActionButton.textContent = 'Crashed'; mainActionButton.className = 'state-crashed'; mainActionButton.disabled = true; gameStatusDisplay.textContent = `Crashed @ ${data.multiplier.toFixed(2)}x! You lost.`; } } else { mainActionButton.textContent = 'Round Over'; mainActionButton.className = 'state-crashed'; mainActionButton.disabled = true; gameStatusDisplay.textContent = `Crashed @ ${data.multiplier.toFixed(2)}x`; } if(potentialWinDisplay) potentialWinDisplay.classList.add('hidden'); if(betAmountInput) betAmountInput.classList.remove('hidden'); });
        socket.on('betSuccess', (data) => { console.log('Server confirmed bet:', data.amount); currentBetThisRound = { amount: data.amount }; hasCashedOutThisRound = false; if(mainActionButton) { mainActionButton.textContent = 'Bet Placed'; mainActionButton.className = 'state-waiting_start'; mainActionButton.disabled = true; } setBetControlsDisabled(true); if(betAmountInput) betAmountInput.classList.add('hidden'); if(potentialWinDisplay) { potentialWinDisplay.classList.remove('hidden'); potentialWinDisplay.textContent = (data.amount * 1.00).toFixed(2); } });
        socket.on('cashOutSuccess', (data) => { console.log('Server confirmed cashOut at:', data.multiplier); if (!currentBetThisRound || hasCashedOutThisRound) return; hasCashedOutThisRound = true; if(mainActionButton) { mainActionButton.textContent = `Cashed Out @ ${data.multiplier.toFixed(2)}x`; mainActionButton.className = 'state-cashed_out'; mainActionButton.disabled = true; } setBetControlsDisabled(true); if(gameStatusDisplay) gameStatusDisplay.textContent = `Successfully Cashed Out @ ${data.multiplier.toFixed(2)}x!`; if(betAmountInput) betAmountInput.classList.remove('hidden'); if(potentialWinDisplay) potentialWinDisplay.classList.add('hidden'); });
        socket.on('betError', (data) => { console.error('Bet Error from server:', data.message); showGameNotification(`Bet Error: ${data.message}`, 'error'); if (currentServerState === 'BETTING') { if(mainActionButton) { mainActionButton.textContent = 'Place Bet'; mainActionButton.className = 'state-idle'; mainActionButton.disabled = false; } setBetControlsDisabled(false); currentBetThisRound = null; } });
        socket.on('historyUpdate', (historyFromServer) => { console.log('Received history update:', historyFromServer); updateHistoryDisplay(historyFromServer); });
        socket.on('playerCountUpdate', (data) => { console.log('Received player count update:', data.count); if (playerCountDisplay) { playerCountDisplay.textContent = data.count; } });
        socket.on('balanceUpdate', (data) => { console.log('Received balance update:', data.newBalance); if (balanceDisplay) { balanceDisplay.textContent = Math.floor(data.newBalance); } });

    } // End of connectWebSocket

    // --- Functions to Send Actions to Server ---
    function placeBetAction() { if (currentServerState !== 'BETTING' || !betAmountInput) return; const amount = parseInt(betAmountInput.value); if (isNaN(amount) || amount <= 0) { showGameNotification("Please enter a valid bet amount > 0.", 'error'); return; } if (!socket || !socket.connected) { showGameNotification("Not connected to game server.", 'error'); return; } console.log(`Client sending 'placeBet' event with amount: ${amount}`); socket.emit('placeBet', { amount: amount }); if(mainActionButton) { mainActionButton.textContent = 'Placing Bet...'; mainActionButton.disabled = true; } }
    function cashOutAction() { if (currentServerState !== 'RUNNING' || !currentBetThisRound || hasCashedOutThisRound) return; if (!socket || !socket.connected) { showGameNotification("Not connected to game server.", 'error'); return; } console.log("Client sending 'cashOut' event"); socket.emit('cashOut'); if(mainActionButton) { mainActionButton.textContent = 'Cashing out...'; mainActionButton.disabled = true; } }

    // --- Event Listeners Setup ---

    // Login Form
    if (loginForm) { loginForm.addEventListener('submit', async (event) => { event.preventDefault(); clearLoginError(); const username = loginUsernameInput.value; const password = loginPasswordInput.value; if (!username || !password) { displayLoginError("Username and password required."); return; } if(loginButton) loginButton.disabled = true; try { const response = await fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }); const data = await response.json(); if (response.ok && data.status === 'success') { loggedInUsername = data.username; showGameScreen(); connectWebSocket(); } else { displayLoginError(data.message || 'Login failed.'); } } catch (error) { console.error("Login fetch error:", error); displayLoginError('Network error or server unavailable.'); } finally { if(loginButton) loginButton.disabled = false; } }); }
    // Registration Form
    if (registerForm) { registerForm.addEventListener('submit', async (event) => { event.preventDefault(); clearRegisterError(); const username = registerUsernameInput.value; const password = registerPasswordInput.value; const confirmPassword = registerConfirmPasswordInput.value; if (password !== confirmPassword) { displayRegisterError('Passwords do not match.'); return; } if (!username || username.length < 3) { displayRegisterError('Username must be >= 3 chars.'); return; } if (!password || password.length < 6) { displayRegisterError('Password must be >= 6 chars.'); return; } if(registerButton) registerButton.disabled = true; try { const response = await fetch('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }); const data = await response.json(); if (response.ok && data.status === 'success') { console.log("Registration successful:", data.message); if (loginError) { loginError.textContent = data.message; loginError.classList.remove('show', 'success-message'); loginError.classList.add('show', 'success-message'); } if(registerForm) registerForm.classList.add('hidden'); if(loginForm) { loginForm.classList.remove('hidden'); loginForm.reset(); } if(registerForm) registerForm.reset(); } else { console.error("Registration failed:", data.message); displayRegisterError(data.message || 'Registration failed.'); } } catch (error) { console.error("Registration fetch error:", error); displayRegisterError('Network error or server unavailable.'); } finally { if(registerButton) registerButton.disabled = false; } }); }
    // Switch between Login/Register links
    if (showRegisterLink) { showRegisterLink.addEventListener('click', (event) => { event.preventDefault(); clearLoginError(); if(loginForm) loginForm.classList.add('hidden'); if(registerForm) registerForm.classList.remove('hidden'); }); }
    if (showLoginLink) { showLoginLink.addEventListener('click', (event) => { event.preventDefault(); clearRegisterError(); if(registerForm) registerForm.classList.add('hidden'); if(loginForm) loginForm.classList.remove('hidden'); }); }
    // Main Game Action Button
    if (mainActionButton) { mainActionButton.addEventListener('click', () => { if (currentServerState === 'BETTING' && !currentBetThisRound) { placeBetAction(); } else if (currentServerState === 'RUNNING' && currentBetThisRound && !hasCashedOutThisRound) { cashOutAction(); } }); }
    // Bet Adjustment Buttons
    if(decreaseBetBtn) decreaseBetBtn.addEventListener('click', () => { let curVal = parseInt(betAmountInput.value); if (curVal > 1) betAmountInput.value = curVal - 1; });
    if(increaseBetBtn) increaseBetBtn.addEventListener('click', () => { let curVal = parseInt(betAmountInput.value); betAmountInput.value = curVal + 1; });
    if(quickBetBtns) quickBetBtns.forEach(btn => { btn.addEventListener('click', () => { if(betAmountInput) betAmountInput.value = btn.dataset.set; }); });
    if(betAmountInput) betAmountInput.addEventListener('input', () => { let val = parseInt(betAmountInput.value); if (isNaN(val) || val < 1) { if (document.activeElement === betAmountInput) { if(betAmountInput) betAmountInput.value = 1; } } });
    // Hamburger Menu Logic
    if (menuIcon) { menuIcon.addEventListener('click', (e) => { e.stopPropagation(); if (mainMenuPopup && mainMenuPopup.classList.contains('hidden')) { openPopup(mainMenuPopup); } else { closePopup(mainMenuPopup); } }); }
    if (closeMenuButton) { closeMenuButton.addEventListener('click', () => closePopup(mainMenuPopup)); }
    document.addEventListener('click', (event) => { if (mainMenuPopup && !mainMenuPopup.classList.contains('hidden') && !mainMenuPopup.contains(event.target) && event.target !== menuIcon) { closePopup(mainMenuPopup); } if (walletPopup && !walletPopup.classList.contains('hidden') && !walletPopup.contains(event.target) && event.target !== menuWalletBtn) { closePopup(walletPopup); } if (autoPopup && !autoPopup.classList.contains('hidden') && !autoPopup.contains(event.target) && event.target !== menuAutoBtn) { closePopup(autoPopup); } });
    // Menu Item Buttons
    if (menuWalletBtn) { menuWalletBtn.addEventListener('click', () => { closePopup(mainMenuPopup); openPopup(walletPopup); /* Add setupWalletUI() call here */ }); }
    if (closeWalletButton) { closeWalletButton.addEventListener('click', () => closePopup(walletPopup)); }
    if (menuAutoBtn) { menuAutoBtn.addEventListener('click', () => { closePopup(mainMenuPopup); openPopup(autoPopup); /* Add setupAutoPlay() if needed */ }); }
    if (closeAutoButton) { closeAutoButton.addEventListener('click', () => closePopup(autoPopup)); }
    if (menuSoundBtn) { menuSoundBtn.addEventListener('click', toggleSound); updateSoundIcon(); }
    if (logoutButton) { logoutButton.addEventListener('click', () => { console.log("Logout clicked"); showAuthScreen(); }); } // Use showAuthScreen for logout

    // --- Setup Wallet UI Listeners ---
    // (Moved this function call down here to ensure elements exist)
    function resetWalletForms() { if (paymentMethodSelect) paymentMethodSelect.value = ''; if (upiDetailsDiv) upiDetailsDiv.classList.add('hidden'); if (qrCodeDetailsDiv) qrCodeDetailsDiv.classList.add('hidden'); if (transactionIdSection) transactionIdSection.classList.add('hidden'); if (transactionIdInput) transactionIdInput.value = ''; if (submitDepositButton) submitDepositButton.disabled = true; if (depositStatus) { depositStatus.textContent = ''; depositStatus.className = 'wallet-status'; } if (withdrawAmountInput) withdrawAmountInput.value = ''; if (userUpiIdInput) userUpiIdInput.value = ''; if (withdrawalStatus) { withdrawalStatus.textContent = ''; withdrawalStatus.className = 'wallet-status'; } if (submitWithdrawalButton) submitWithdrawalButton.disabled = false; if (transactionIdInput && submitDepositButton) submitDepositButton.disabled = (transactionIdInput.value.trim().length < 10); }
    function setupWalletUI() { if (showAddMoneyBtn) { showAddMoneyBtn.addEventListener('click', () => { if (addMoneySection) addMoneySection.classList.add('active'); if (withdrawMoneySection) withdrawMoneySection.classList.remove('active'); showAddMoneyBtn.classList.add('active'); if (showWithdrawMoneyBtn) showWithdrawMoneyBtn.classList.remove('active'); resetWalletForms(); }); } if (showWithdrawMoneyBtn) { showWithdrawMoneyBtn.addEventListener('click', () => { if (addMoneySection) addMoneySection.classList.remove('active'); if (withdrawMoneySection) withdrawMoneySection.classList.add('active'); showWithdrawMoneyBtn.classList.add('active'); if (showAddMoneyBtn) showAddMoneyBtn.classList.remove('active'); resetWalletForms(); }); } if (paymentMethodSelect) { paymentMethodSelect.addEventListener('change', () => { const method = paymentMethodSelect.value; if (upiDetailsDiv) upiDetailsDiv.classList.add('hidden'); if (qrCodeDetailsDiv) qrCodeDetailsDiv.classList.add('hidden'); if (transactionIdSection) transactionIdSection.classList.add('hidden'); if (submitDepositButton) submitDepositButton.disabled = true; if (depositStatus) depositStatus.textContent = ''; if (method === 'upi') { if (upiDetailsDiv) upiDetailsDiv.classList.remove('hidden'); if (transactionIdSection) transactionIdSection.classList.remove('hidden'); } else if (method === 'qr') { if (qrCodeDetailsDiv) qrCodeDetailsDiv.classList.remove('hidden'); if (transactionIdSection) transactionIdSection.classList.remove('hidden'); } if (transactionIdInput && submitDepositButton) submitDepositButton.disabled = (transactionIdInput.value.trim().length < 10); }); } if (transactionIdInput && submitDepositButton) { transactionIdInput.addEventListener('input', () => { submitDepositButton.disabled = transactionIdInput.value.trim().length < 10; }); } if (submitDepositButton) { submitDepositButton.addEventListener('click', () => { const txnId = transactionIdInput.value.trim(); if(depositStatus) { depositStatus.textContent = 'Processing deposit... (Demo)'; depositStatus.className = 'wallet-status pending'; } submitDepositButton.disabled = true; setTimeout(() => { const success = Math.random() > 0.2; if (success) { if(depositStatus) { depositStatus.textContent = 'Deposit successful! (Demo - Balance updated by server)'; depositStatus.className = 'wallet-status success'; } } else { if(depositStatus) { depositStatus.textContent = 'Deposit verification failed. (Demo)'; depositStatus.className = 'wallet-status error'; } } if(paymentMethodSelect) paymentMethodSelect.value = ''; if(upiDetailsDiv) upiDetailsDiv.classList.add('hidden'); if(qrCodeDetailsDiv) qrCodeDetailsDiv.classList.add('hidden'); if(transactionIdSection) transactionIdSection.classList.add('hidden'); if(transactionIdInput) transactionIdInput.value = ''; submitDepositButton.disabled = true; }, 2500); }); } if (submitWithdrawalButton) { submitWithdrawalButton.addEventListener('click', () => { const amount = parseFloat(withdrawAmountInput.value); const upiId = userUpiIdInput.value.trim(); if(withdrawalStatus) { withdrawalStatus.textContent = ''; withdrawalStatus.className = 'wallet-status'; } if (isNaN(amount) || amount < 100) { if(withdrawalStatus) { withdrawalStatus.textContent = 'Minimum withdrawal is ₹100. (Demo)'; withdrawalStatus.className = 'wallet-status error'; } return; } if (!upiId || !upiId.includes('@')) { if(withdrawalStatus) { withdrawalStatus.textContent = 'Please enter a valid UPI ID. (Demo)'; withdrawalStatus.className = 'wallet-status error'; } return; } if(withdrawalStatus) { withdrawalStatus.textContent = 'Processing withdrawal... (Demo)'; withdrawalStatus.className = 'wallet-status pending'; } submitWithdrawalButton.disabled = true; setTimeout(() => { if(withdrawalStatus) { withdrawalStatus.textContent = 'Withdrawal request submitted. (Demo - Balance updated by server)'; withdrawalStatus.className = 'wallet-status success'; } if (withdrawAmountInput) withdrawAmountInput.value = ''; if (userUpiIdInput) userUpiIdInput.value = ''; submitWithdrawalButton.disabled = false; }, 2000); }); } }
    setupWalletUI(); // Call the function to attach wallet listeners

    // --- Initial UI State ---
    showAuthScreen(); // Start by showing the authentication screen
    updateHistoryDisplay([]); // Show empty history display initially
    if(playerCountDisplay) playerCountDisplay.textContent = '-'; // Placeholder count
    if(balanceDisplay) balanceDisplay.textContent = '...'; // Placeholder balance


}); // End DOMContentLoaded