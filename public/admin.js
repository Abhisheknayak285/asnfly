// public/admin.js - Logic for Admin Page with Tabs & User Management

document.addEventListener('DOMContentLoaded', () => {
    console.log("Admin script loaded.");

    // --- Get DOM Elements ---
    // Menu & Views
    const viewButtons = document.querySelectorAll('.admin-view-btn');
    const views = document.querySelectorAll('.admin-view');
    const adminLogoutBtn = document.getElementById('adminLogoutBtn');

    // Deposit Elements
    const depositTableBody = document.getElementById('depositRequestsTableBody');
    const loadingDepositIndicator = document.getElementById('loadingDepositIndicator');
    const adminDepositMessage = document.getElementById('adminDepositMessage');
    const refreshDepositsButton = document.getElementById('refreshDeposits');

    // Withdrawal Elements
    const withdrawalTableBody = document.getElementById('withdrawalRequestsTableBody');
    const loadingWithdrawalIndicator = document.getElementById('loadingWithdrawalIndicator');
    const adminWithdrawalMessage = document.getElementById('adminWithdrawalMessage');
    const refreshWithdrawalsButton = document.getElementById('refreshWithdrawals');

    // User Log Elements
    const usersTableBody = document.getElementById('usersTableBody');
    const loadingUsersIndicator = document.getElementById('loadingUsersIndicator');
    const adminUserMessage = document.getElementById('adminUserMessage');
    const refreshUsersButton = document.getElementById('refreshUsers');

    // History Elements
    const historyTableBody = document.getElementById('historyTableBody');
    const loadingHistoryIndicator = document.getElementById('loadingHistoryIndicator');
    const adminHistoryMessage = document.getElementById('adminHistoryMessage');
    const refreshHistoryButton = document.getElementById('refreshHistory');

    // Basic check for core elements
    if (!depositTableBody || !withdrawalTableBody || !usersTableBody || !historyTableBody || !adminLogoutBtn) {
        console.error("Admin page HTML elements not found! Check IDs.");
        alert("Error: Critical Admin page elements missing. Check console.");
        return;
    }

    // --- Helper Functions ---
    function showLoading(indicatorElement, show) { if (indicatorElement) indicatorElement.style.display = show ? 'block' : 'none'; }
    function showAdminMessage(messageElement, message, isError = false, duration = 4000) { if(!messageElement) return; messageElement.textContent = message; messageElement.className = 'admin-message'; messageElement.classList.add(isError ? 'error' : 'success', 'show'); if (messageElement.timeoutId) { clearTimeout(messageElement.timeoutId); } messageElement.timeoutId = setTimeout(() => { if(messageElement) messageElement.classList.remove('show'); }, duration); }

    // --- Tab / View Switching Logic ---
    function switchView(viewToShowId) {
        views.forEach(view => view.classList.remove('active')); // Hide all
        viewButtons.forEach(button => button.classList.remove('active')); // Deactivate all buttons

        const viewElement = document.getElementById(viewToShowId); // Find view div by ID
        if (viewElement) { viewElement.classList.add('active'); } // Show selected view
        else { console.error(`View element '${viewToShowId}' not found.`); document.getElementById('viewPendingDeposits').classList.add('active'); } // Fallback

        const activeButton = document.querySelector(`.admin-view-btn[data-view="${viewToShowId.replace('view', '')}"]`); // Find button by data-view
        if(activeButton) { activeButton.classList.add('active'); }

        // Automatically load data for the shown view
        switch (viewToShowId) {
            case 'viewPendingDeposits': fetchPendingDeposits(); break;
            case 'viewPendingWithdrawals': fetchPendingWithdrawals(); break;
            case 'viewUsers': fetchAllUsers(); break;
            case 'viewHistory': fetchHistory(); break;
        }
    }

    // Add event listeners to view buttons
    viewButtons.forEach(button => {
        if (button.id === 'adminLogoutBtn') return; // Skip logout button
        const viewId = `view${button.dataset.view}`; // Construct view ID from data-view attribute
        if (button.dataset.view) { button.addEventListener('click', () => switchView(viewId)); }
        else { console.warn("Admin menu button missing data-view attribute:", button); }
    });

    // --- Logout ---
    adminLogoutBtn.addEventListener('click', async () => {
        console.log("Admin logout clicked");
        try { await fetch('/logout', { method: 'POST' }); }
        catch(err) { console.error("Error during fetch /logout:", err); }
        finally { window.location.href = '/'; } // Redirect to login page anyway
    });

    // --- API Fetch & Display Functions ---

    // Deposits
    async function fetchPendingDeposits() { showLoading(loadingDepositIndicator, true); if (depositTableBody) depositTableBody.innerHTML = ''; if (adminDepositMessage) adminDepositMessage.textContent = ''; try { const response = await fetch('/api/admin/pending-deposits'); if (!response.ok) { if (response.status === 403) throw new Error('Forbidden'); throw new Error(`HTTP ${response.status}`); } const requests = await response.json(); displayDepositRequests(requests); } catch (error) { console.error("Error fetching pending deposits:", error); showAdminMessage(adminDepositMessage, `Error: ${error.message}`, true); } finally { showLoading(loadingDepositIndicator, false); } }
    function displayDepositRequests(requests) { if (!depositTableBody) return; if (requests.length === 0) { depositTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No pending deposit requests.</td></tr>'; return; } depositTableBody.innerHTML = ''; requests.forEach(req => { const row = depositTableBody.insertRow(); row.insertCell().textContent = req.id; row.insertCell().textContent = req.username; row.insertCell().textContent = req.transaction_id; row.insertCell().textContent = new Date(req.requested_at).toLocaleString(); const statusCell = row.insertCell(); statusCell.textContent = req.status; statusCell.classList.add(`status-${req.status}`); const actionCell = row.insertCell(); if (req.status === 'pending') { const approveBtn = document.createElement('button'); approveBtn.textContent = 'Approve'; approveBtn.classList.add('admin-action', 'approve'); approveBtn.onclick = () => handleDepositApprove(req.id, approveBtn); actionCell.appendChild(approveBtn); const rejectBtn = document.createElement('button'); rejectBtn.textContent = 'Reject'; rejectBtn.classList.add('admin-action', 'reject'); rejectBtn.onclick = () => handleDepositReject(req.id, rejectBtn); actionCell.appendChild(rejectBtn); } else { actionCell.textContent = '-'; } }); }
    async function handleDepositApprove(requestId, button) { const amountString = prompt(`Approve Deposit ID: ${requestId}\nEnter EXACT amount verified:`); if (amountString === null) return; const verifiedAmount = parseFloat(amountString); if (isNaN(verifiedAmount) || verifiedAmount <= 0) { alert("Invalid amount."); return; } button.disabled = true; button.textContent = '...'; try { const response = await fetch('/api/admin/approve-deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId, verifiedAmount: verifiedAmount }) }); const result = await response.json(); if (response.ok && result.status === 'success') { showAdminMessage(adminDepositMessage, `Request ${requestId} approved.`); fetchPendingDeposits(); fetchHistory(); } else { throw new Error(result.message || 'Approval failed.'); } } catch (error) { console.error(`Error approving deposit ${requestId}:`, error); showAdminMessage(adminDepositMessage, `Error: ${error.message}`, true); button.disabled = false; button.textContent = 'Approve'; } }
    async function handleDepositReject(requestId, button) { if (!confirm(`Reject Deposit ID: ${requestId}?`)) return; button.disabled = true; button.textContent = '...'; try { const response = await fetch('/api/admin/reject-deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId }) }); const result = await response.json(); if (response.ok && result.status === 'success') { showAdminMessage(adminDepositMessage, `Request ${requestId} rejected.`); fetchPendingDeposits(); fetchHistory(); } else { throw new Error(result.message || 'Rejection failed.'); } } catch (error) { console.error(`Error rejecting deposit ${requestId}:`, error); showAdminMessage(adminDepositMessage, `Error: ${error.message}`, true); button.disabled = false; button.textContent = 'Reject'; } }

    // Withdrawals
    async function fetchPendingWithdrawals() { showLoading(loadingWithdrawalIndicator, true); if(withdrawalTableBody) withdrawalTableBody.innerHTML = ''; if(adminWithdrawalMessage) adminWithdrawalMessage.textContent = ''; try { const response = await fetch('/api/admin/pending-withdrawals'); if (!response.ok) { if (response.status === 403) throw new Error('Forbidden'); throw new Error(`HTTP ${response.status}`); } const requests = await response.json(); displayWithdrawals(requests); } catch (error) { console.error("Error fetching pending withdrawals:", error); showAdminMessage(adminWithdrawalMessage, `Error: ${error.message}`, true); } finally { showLoading(loadingWithdrawalIndicator, false); } }
    function displayWithdrawals(requests) { if(!withdrawalTableBody) return; if (requests.length === 0) { withdrawalTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No pending withdrawal requests.</td></tr>'; return; } withdrawalTableBody.innerHTML = ''; requests.forEach(req => { const row = withdrawalTableBody.insertRow(); row.insertCell().textContent = req.id; row.insertCell().textContent = req.username; row.insertCell().textContent = parseFloat(req.amount).toFixed(2); row.insertCell().textContent = req.upi_id; row.insertCell().textContent = new Date(req.requested_at).toLocaleString(); const statusCell = row.insertCell(); statusCell.textContent = req.status; statusCell.classList.add(`status-${req.status}`); const actionCell = row.insertCell(); if (req.status === 'pending') { const approveBtn = document.createElement('button'); approveBtn.textContent = 'Approve (Paid)'; approveBtn.classList.add('admin-action', 'approve'); approveBtn.onclick = () => handleWithdrawalApprove(req.id, approveBtn); actionCell.appendChild(approveBtn); const rejectBtn = document.createElement('button'); rejectBtn.textContent = 'Reject'; rejectBtn.classList.add('admin-action', 'reject'); rejectBtn.onclick = () => handleWithdrawalReject(req.id, rejectBtn); actionCell.appendChild(rejectBtn); } else { actionCell.textContent = '-'; } }); }
    async function handleWithdrawalApprove(requestId, button) { if (!confirm(`Approve Withdrawal ID: ${requestId}?\n\nCONFIRM you have ALREADY SENT the funds externally.`)) return; button.disabled = true; button.textContent = '...'; try { const response = await fetch('/api/admin/approve-withdrawal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId }) }); const result = await response.json(); if (response.ok && result.status === 'success') { showAdminMessage(adminWithdrawalMessage, `Withdrawal ${requestId} approved.`); fetchPendingWithdrawals(); fetchHistory(); } else { throw new Error(result.message || 'Approval failed.'); } } catch (error) { console.error(`Error approving withdrawal ${requestId}:`, error); showAdminMessage(adminWithdrawalMessage, `Error: ${error.message}`, true); button.disabled = false; button.textContent = 'Approve (Paid)'; } }
    async function handleWithdrawalReject(requestId, button) { if (!confirm(`Reject Withdrawal ID: ${requestId}?`)) return; button.disabled = true; button.textContent = '...'; try { const response = await fetch('/api/admin/reject-withdrawal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId }) }); const result = await response.json(); if (response.ok && result.status === 'success') { showAdminMessage(adminWithdrawalMessage, `Withdrawal ${requestId} rejected.`); fetchPendingWithdrawals(); fetchHistory(); } else { throw new Error(result.message || 'Rejection failed.'); } } catch (error) { console.error(`Error rejecting withdrawal ${requestId}:`, error); showAdminMessage(adminWithdrawalMessage, `Error: ${error.message}`, true); button.disabled = false; button.textContent = 'Reject'; } }

    // Users Log
    async function fetchAllUsers() { showLoading(loadingUsersIndicator, true); if(usersTableBody) usersTableBody.innerHTML = ''; if(adminUserMessage) adminUserMessage.textContent = ''; try { const response = await fetch('/api/admin/users'); if (!response.ok) { if (response.status === 403) throw new Error('Forbidden'); throw new Error(`HTTP ${response.status}`); } const users = await response.json(); displayUsers(users); } catch (error) { console.error("Error fetching users:", error); showAdminMessage(adminUserMessage, `Error: ${error.message}`, true); } finally { showLoading(loadingUsersIndicator, false); } }
    function displayUsers(users) { if(!usersTableBody) return; if (users.length === 0) { usersTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No users found.</td></tr>'; return; } usersTableBody.innerHTML = ''; users.forEach(user => { const row = usersTableBody.insertRow(); row.insertCell().textContent = user.username; row.insertCell().textContent = parseFloat(user.balance).toFixed(2); const statusCell = row.insertCell(); statusCell.textContent = user.status; statusCell.classList.add(`status-${user.status}`); row.insertCell().textContent = new Date(user.created_at).toLocaleString(); const actionCell = row.insertCell(); if (user.status === 'active') { const blockButton = document.createElement('button'); blockButton.textContent = 'Block'; blockButton.classList.add('admin-action', 'block'); blockButton.onclick = () => handleBlockUser(user.username, blockButton); actionCell.appendChild(blockButton); } else if (user.status === 'blocked') { const unblockButton = document.createElement('button'); unblockButton.textContent = 'Unblock'; unblockButton.classList.add('admin-action', 'unblock'); unblockButton.onclick = () => handleUnblockUser(user.username, unblockButton); actionCell.appendChild(unblockButton); } else { actionCell.textContent = '-'; } }); }
    async function handleBlockUser(username, button) { if (!confirm(`Are you sure you want to BLOCK user: ${username}? They will not be able to log in.`)) return; button.disabled = true; button.textContent = '...'; try { const response = await fetch('/api/admin/block-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username }) }); const result = await response.json(); if (response.ok && result.status === 'success') { showAdminMessage(adminUserMessage, `User ${username} blocked.`); fetchAllUsers(); } else { throw new Error(result.message || 'Block failed.'); } } catch (error) { console.error(`Error blocking ${username}:`, error); showAdminMessage(adminUserMessage, `Error: ${error.message}`, true); button.disabled = false; button.textContent = 'Block'; } }
    async function handleUnblockUser(username, button) { if (!confirm(`Are you sure you want to UNBLOCK user: ${username}?`)) return; button.disabled = true; button.textContent = '...'; try { const response = await fetch('/api/admin/unblock-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username }) }); const result = await response.json(); if (response.ok && result.status === 'success') { showAdminMessage(adminUserMessage, `User ${username} unblocked.`); fetchAllUsers(); } else { throw new Error(result.message || 'Unblock failed.'); } } catch (error) { console.error(`Error unblocking ${username}:`, error); showAdminMessage(adminUserMessage, `Error: ${error.message}`, true); button.disabled = false; button.textContent = 'Unblock'; } }

    // History
    async function fetchHistory() { showLoading(loadingHistoryIndicator, true); if(historyTableBody) historyTableBody.innerHTML = ''; if(adminHistoryMessage) adminHistoryMessage.textContent = ''; try { const response = await fetch('/api/admin/request-history'); if (!response.ok) { if (response.status === 403) throw new Error('Forbidden'); throw new Error(`HTTP ${response.status}`); } const items = await response.json(); displayHistory(items); } catch (error) { console.error("Error fetching history:", error); showAdminMessage(adminHistoryMessage, `Error: ${error.message}`, true); } finally { showLoading(loadingHistoryIndicator, false); } }
    function displayHistory(items) { if (!historyTableBody) return; if (items.length === 0) { historyTableBody.innerHTML = '<tr><td colspan="9" style="text-align: center;">No processed request history found.</td></tr>'; return; } historyTableBody.innerHTML = ''; items.forEach(item => { const row = historyTableBody.insertRow(); row.insertCell().textContent = item.id; row.insertCell().textContent = item.type; row.insertCell().textContent = item.username; row.insertCell().textContent = item.details; const amountToShow = item.amount ? parseFloat(item.amount).toFixed(2) : '-'; row.insertCell().textContent = amountToShow; const statusCell = row.insertCell(); statusCell.textContent = item.status; statusCell.classList.add(`status-${item.status}`); row.insertCell().textContent = new Date(item.requested_at).toLocaleString(); row.insertCell().textContent = item.processed_at ? new Date(item.processed_at).toLocaleString() : '-'; row.insertCell().textContent = item.processed_by || '-'; }); }


    // --- Initial Load & Refresh Button Listeners ---
    function refreshAllAdminData() { fetchPendingDeposits(); fetchPendingWithdrawals(); fetchAllUsers(); fetchHistory(); }
    if (refreshDepositsButton) refreshDepositsButton.addEventListener('click', fetchPendingDeposits);
    if (refreshWithdrawalsButton) refreshWithdrawalsButton.addEventListener('click', fetchPendingWithdrawals);
    if (refreshUsersButton) refreshUsersButton.addEventListener('click', fetchAllUsers);
    if (refreshHistoryButton) refreshHistoryButton.addEventListener('click', fetchHistory);

    // Initial Load - Default to first tab ('PendingDeposits')
    switchView('viewPendingDeposits');

}); // End DOMContentLoaded