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

    // Deposits (No changes here)
    async function fetchPendingDeposits() { showLoading(loadingDepositIndicator, true); if (depositTableBody) depositTableBody.innerHTML = ''; if (adminDepositMessage) adminDepositMessage.classList.remove('show'); try { const response = await fetch('/api/admin/pending-deposits'); if (!response.ok) { if (response.status === 403) throw new Error('Forbidden'); throw new Error(`HTTP ${response.status}`); } const requests = await response.json(); displayDepositRequests(requests); } catch (error) { console.error("Error fetching pending deposits:", error); showAdminMessage(adminDepositMessage, `Error fetching deposits: ${error.message}`, true); } finally { showLoading(loadingDepositIndicator, false); } }
    function displayDepositRequests(requests) { if (!depositTableBody) return; if (requests.length === 0) { depositTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No pending deposit requests.</td></tr>'; return; } depositTableBody.innerHTML = ''; requests.forEach(req => { const row = depositTableBody.insertRow(); row.insertCell().textContent = req.id; row.insertCell().textContent = req.username; row.insertCell().textContent = req.transaction_id; row.insertCell().textContent = new Date(req.requested_at).toLocaleString(); const statusCell = row.insertCell(); statusCell.textContent = req.status; statusCell.classList.add(`status-${req.status}`); const actionCell = row.insertCell(); if (req.status === 'pending') { const approveBtn = document.createElement('button'); approveBtn.textContent = 'Approve'; approveBtn.classList.add('admin-action', 'approve'); approveBtn.onclick = () => handleDepositApprove(req.id, approveBtn); actionCell.appendChild(approveBtn); const rejectBtn = document.createElement('button'); rejectBtn.textContent = 'Reject'; rejectBtn.classList.add('admin-action', 'reject'); rejectBtn.onclick = () => handleDepositReject(req.id, rejectBtn); actionCell.appendChild(rejectBtn); } else { actionCell.textContent = '-'; } }); }
    async function handleDepositApprove(requestId, button) { const amountString = prompt(`Approve Deposit ID: ${requestId}\nEnter EXACT amount verified:`); if (amountString === null) return; const verifiedAmount = parseFloat(amountString); if (isNaN(verifiedAmount) || verifiedAmount <= 0) { alert("Invalid amount."); return; } button.disabled = true; button.textContent = '...'; try { const response = await fetch('/api/admin/approve-deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId, verifiedAmount: verifiedAmount }) }); const result = await response.json(); if (response.ok && result.status === 'success') { showAdminMessage(adminDepositMessage, `Request ${requestId} approved.`); fetchPendingDeposits(); fetchHistory(); } else { throw new Error(result.message || 'Approval failed.'); } } catch (error) { console.error(`Error approving deposit ${requestId}:`, error); showAdminMessage(adminDepositMessage, `Error approving deposit: ${error.message}`, true); button.disabled = false; button.textContent = 'Approve'; } }
    async function handleDepositReject(requestId, button) { if (!confirm(`Reject Deposit ID: ${requestId}?`)) return; button.disabled = true; button.textContent = '...'; try { const response = await fetch('/api/admin/reject-deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId }) }); const result = await response.json(); if (response.ok && result.status === 'success') { showAdminMessage(adminDepositMessage, `Request ${requestId} rejected.`); fetchPendingDeposits(); fetchHistory(); } else { throw new Error(result.message || 'Rejection failed.'); } } catch (error) { console.error(`Error rejecting deposit ${requestId}:`, error); showAdminMessage(adminDepositMessage, `Error rejecting deposit: ${error.message}`, true); button.disabled = false; button.textContent = 'Reject'; } }

    // Withdrawals (No changes here)
    async function fetchPendingWithdrawals() { showLoading(loadingWithdrawalIndicator, true); if(withdrawalTableBody) withdrawalTableBody.innerHTML = ''; if(adminWithdrawalMessage) adminWithdrawalMessage.classList.remove('show'); try { const response = await fetch('/api/admin/pending-withdrawals'); if (!response.ok) { if (response.status === 403) throw new Error('Forbidden'); throw new Error(`HTTP ${response.status}`); } const requests = await response.json(); displayWithdrawals(requests); } catch (error) { console.error("Error fetching pending withdrawals:", error); showAdminMessage(adminWithdrawalMessage, `Error fetching withdrawals: ${error.message}`, true); } finally { showLoading(loadingWithdrawalIndicator, false); } }
    function displayWithdrawals(requests) { if(!withdrawalTableBody) return; if (requests.length === 0) { withdrawalTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No pending withdrawal requests.</td></tr>'; return; } withdrawalTableBody.innerHTML = ''; requests.forEach(req => { const row = withdrawalTableBody.insertRow(); row.insertCell().textContent = req.id; row.insertCell().textContent = req.username; row.insertCell().textContent = parseFloat(req.amount).toFixed(2); row.insertCell().textContent = req.upi_id; row.insertCell().textContent = new Date(req.requested_at).toLocaleString(); const statusCell = row.insertCell(); statusCell.textContent = req.status; statusCell.classList.add(`status-${req.status}`); const actionCell = row.insertCell(); if (req.status === 'pending') { const approveBtn = document.createElement('button'); approveBtn.textContent = 'Approve (Paid)'; approveBtn.classList.add('admin-action', 'approve'); approveBtn.onclick = () => handleWithdrawalApprove(req.id, approveBtn); actionCell.appendChild(approveBtn); const rejectBtn = document.createElement('button'); rejectBtn.textContent = 'Reject'; rejectBtn.classList.add('admin-action', 'reject'); rejectBtn.onclick = () => handleWithdrawalReject(req.id, rejectBtn); actionCell.appendChild(rejectBtn); } else { actionCell.textContent = '-'; } }); }
    async function handleWithdrawalApprove(requestId, button) { if (!confirm(`Approve Withdrawal ID: ${requestId}?\n\nCONFIRM you have ALREADY SENT the funds externally.`)) return; button.disabled = true; button.textContent = '...'; try { const response = await fetch('/api/admin/approve-withdrawal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId }) }); const result = await response.json(); if (response.ok && result.status === 'success') { showAdminMessage(adminWithdrawalMessage, `Withdrawal ${requestId} approved.`); fetchPendingWithdrawals(); fetchHistory(); } else { throw new Error(result.message || 'Approval failed.'); } } catch (error) { console.error(`Error approving withdrawal ${requestId}:`, error); showAdminMessage(adminWithdrawalMessage, `Error approving withdrawal: ${error.message}`, true); button.disabled = false; button.textContent = 'Approve (Paid)'; } }
    async function handleWithdrawalReject(requestId, button) { if (!confirm(`Reject Withdrawal ID: ${requestId}?`)) return; button.disabled = true; button.textContent = '...'; try { const response = await fetch('/api/admin/reject-withdrawal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId }) }); const result = await response.json(); if (response.ok && result.status === 'success') { showAdminMessage(adminWithdrawalMessage, `Withdrawal ${requestId} rejected.`); fetchPendingWithdrawals(); fetchHistory(); } else { throw new Error(result.message || 'Rejection failed.'); } } catch (error) { console.error(`Error rejecting withdrawal ${requestId}:`, error); showAdminMessage(adminWithdrawalMessage, `Error rejecting withdrawal: ${error.message}`, true); button.disabled = false; button.textContent = 'Reject'; } }

    // Users Log (MODIFIED)
    async function fetchAllUsers() {
        showLoading(loadingUsersIndicator, true);
        if(usersTableBody) usersTableBody.innerHTML = '';
        if(adminUserMessage) adminUserMessage.classList.remove('show'); // Hide previous messages
        try {
            const response = await fetch('/api/admin/users');
            if (!response.ok) {
                if (response.status === 403) throw new Error('Forbidden');
                throw new Error(`HTTP ${response.status}`);
            }
            const users = await response.json();
            displayUsers(users);
        } catch (error) {
            console.error("Error fetching users:", error);
            showAdminMessage(adminUserMessage, `Error fetching users: ${error.message}`, true);
        } finally {
            showLoading(loadingUsersIndicator, false);
        }
    }

    // MODIFIED displayUsers function
    function displayUsers(users) {
        if(!usersTableBody) return;
        if (users.length === 0) {
            // Adjusted colspan for the new column
            usersTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No users found.</td></tr>';
            return;
        }
        usersTableBody.innerHTML = ''; // Clear previous entries

        users.forEach(user => {
            const row = usersTableBody.insertRow();

            row.insertCell().textContent = user.username;
            // --- New Cell for Email ---
            // IMPORTANT: Assumes your backend '/api/admin/users' now returns 'email'
            row.insertCell().textContent = user.email || 'N/A'; // Display 'N/A' if email is missing
            // --- End New Cell ---
            row.insertCell().textContent = parseFloat(user.balance).toFixed(2);
            const statusCell = row.insertCell();
            statusCell.textContent = user.status;
            statusCell.classList.add(`status-${user.status}`);
            row.insertCell().textContent = new Date(user.created_at).toLocaleString();

            const actionCell = row.insertCell();
            actionCell.style.textAlign = 'center'; // Center align buttons

            // Block/Unblock Buttons (Existing Logic)
            if (user.status === 'active') {
                const blockButton = document.createElement('button');
                blockButton.textContent = 'Block';
                blockButton.classList.add('admin-action', 'block');
                // Prefer user.id if available, else use username
                blockButton.onclick = () => handleBlockUser(user.id || user.username, blockButton);
                actionCell.appendChild(blockButton);
            } else if (user.status === 'blocked') {
                const unblockButton = document.createElement('button');
                unblockButton.textContent = 'Unblock';
                unblockButton.classList.add('admin-action', 'unblock');
                 // Prefer user.id if available, else use username
                unblockButton.onclick = () => handleUnblockUser(user.id || user.username, unblockButton);
                actionCell.appendChild(unblockButton);
            }

            // --- New Remove Button ---
            const removeButton = document.createElement('button');
            removeButton.textContent = 'Remove';
            removeButton.classList.add('admin-action', 'remove'); // Use the new 'remove' class for styling
             // Prefer user.id if available, else use username
            removeButton.onclick = () => handleRemoveUser(user.id || user.username, user.username, removeButton); // Pass both id/username and display username
            actionCell.appendChild(removeButton);
            // --- End New Remove Button ---
        });
    }

    // MODIFIED handleBlockUser and handleUnblockUser to use identifier (id or username)
    async function handleBlockUser(userIdentifier, button) {
        // Use username for confirmation message, identifier for API call
        const username = button.closest('tr').cells[0].textContent; // Get username from table for prompt
        if (!confirm(`Are you sure you want to BLOCK user: ${username}? They will not be able to log in.`)) return;
        button.disabled = true; button.textContent = '...';
        try {
            const response = await fetch('/api/admin/block-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Send the identifier (could be id or username)
                body: JSON.stringify({ userIdentifier: userIdentifier })
            });
            const result = await response.json();
            if (response.ok && result.status === 'success') {
                showAdminMessage(adminUserMessage, `User ${username} blocked.`);
                fetchAllUsers(); // Refresh list
            } else {
                throw new Error(result.message || 'Block failed.');
            }
        } catch (error) {
            console.error(`Error blocking ${username}:`, error);
            showAdminMessage(adminUserMessage, `Error blocking user: ${error.message}`, true);
            button.disabled = false; button.textContent = 'Block';
        }
    }

    async function handleUnblockUser(userIdentifier, button) {
        const username = button.closest('tr').cells[0].textContent; // Get username from table for prompt
        if (!confirm(`Are you sure you want to UNBLOCK user: ${username}?`)) return;
        button.disabled = true; button.textContent = '...';
        try {
            const response = await fetch('/api/admin/unblock-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                 // Send the identifier (could be id or username)
                body: JSON.stringify({ userIdentifier: userIdentifier })
            });
            const result = await response.json();
            if (response.ok && result.status === 'success') {
                showAdminMessage(adminUserMessage, `User ${username} unblocked.`);
                fetchAllUsers(); // Refresh list
            } else {
                throw new Error(result.message || 'Unblock failed.');
            }
        } catch (error) {
            console.error(`Error unblocking ${username}:`, error);
            showAdminMessage(adminUserMessage, `Error unblocking user: ${error.message}`, true);
            button.disabled = false; button.textContent = 'Unblock';
        }
    }

    // --- NEW Function: Handle Remove User ---
    async function handleRemoveUser(userIdentifier, username, button) {
        // **Important:** User removal is PERMANENT. Use a strong confirmation.
        const confirmation = prompt(`!!! PERMANENT ACTION !!!\nTo permanently remove user "${username}", type their username below:\n\n${username}`);

        if (confirmation !== username) {
             if (confirmation !== null) { // Only show alert if they typed something wrong, not if they cancelled
                 alert("Username mismatch. User removal cancelled.");
             }
             return; // Cancel if prompt is cancelled or doesn't match
        }

        // Second confirmation (optional, but recommended for destructive actions)
        if (!confirm(`FINAL CONFIRMATION:\nPermanently remove user "${username}" (${userIdentifier})?\nTHIS CANNOT BE UNDONE.`)) {
            return;
        }


        button.disabled = true;
        button.textContent = '...';

        try {
            // Send DELETE request to the new backend endpoint
            // NOTE: Ensure your backend API /api/admin/remove-user expects a DELETE
            //       request and can handle 'userIdentifier' (which might be id or username).
            const response = await fetch('/api/admin/remove-user', {
                method: 'DELETE', // Or 'POST' if your backend prefers
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userIdentifier: userIdentifier }) // Send identifier
            });

            // Check response status explicitly as DELETE might return 204 No Content on success
            if (response.ok) { // Status 200-299 is OK
                 // Try parsing JSON only if there's content, otherwise assume success on 204
                 let message = `User ${username} removed successfully.`;
                 if (response.status !== 204) {
                    try {
                       const result = await response.json();
                       message = result.message || message; // Use backend message if available
                    } catch(jsonError) {
                        console.warn("Could not parse JSON response from DELETE, but status was OK:", response.status)
                    }
                 }

                showAdminMessage(adminUserMessage, message);
                fetchAllUsers(); // Refresh the user list
                fetchHistory(); // Refresh history in case removal logs something
            } else {
                 // Try to get error message from response body
                 let errorMessage = `Remove failed with status: ${response.status}`;
                 try {
                     const errorResult = await response.json();
                     errorMessage = errorResult.message || errorMessage;
                 } catch(e) { /* Ignore if body isn't JSON */ }
                throw new Error(errorMessage);
            }
        } catch (error) {
            console.error(`Error removing user ${username}:`, error);
            showAdminMessage(adminUserMessage, `Error removing user: ${error.message}`, true);
            button.disabled = false; // Re-enable button on failure
            button.textContent = 'Remove';
        }
    }
    // --- End NEW Function ---


    // History (No changes here)
    async function fetchHistory() { showLoading(loadingHistoryIndicator, true); if(historyTableBody) historyTableBody.innerHTML = ''; if(adminHistoryMessage) adminHistoryMessage.classList.remove('show'); try { const response = await fetch('/api/admin/request-history'); if (!response.ok) { if (response.status === 403) throw new Error('Forbidden'); throw new Error(`HTTP ${response.status}`); } const items = await response.json(); displayHistory(items); } catch (error) { console.error("Error fetching history:", error); showAdminMessage(adminHistoryMessage, `Error fetching history: ${error.message}`, true); } finally { showLoading(loadingHistoryIndicator, false); } }
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