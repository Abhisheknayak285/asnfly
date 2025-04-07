// public/admin.js - Logic for the Admin Page Interface

document.addEventListener('DOMContentLoaded', () => {
    console.log("Admin script loaded.");

    // --- Get DOM Elements ---
    const depositTableBody = document.getElementById('depositRequestsTableBody');
    const loadingDepositIndicator = document.getElementById('loadingDepositIndicator');
    const adminDepositMessage = document.getElementById('adminDepositMessage');
    const refreshDepositsButton = document.getElementById('refreshDeposits');

    const withdrawalTableBody = document.getElementById('withdrawalRequestsTableBody');
    const loadingWithdrawalIndicator = document.getElementById('loadingWithdrawalIndicator');
    const adminWithdrawalMessage = document.getElementById('adminWithdrawalMessage');
    const refreshWithdrawalsButton = document.getElementById('refreshWithdrawals');

    const historyTableBody = document.getElementById('historyTableBody');
    const loadingHistoryIndicator = document.getElementById('loadingHistoryIndicator');
    const adminHistoryMessage = document.getElementById('adminHistoryMessage');
    const refreshHistoryButton = document.getElementById('refreshHistory');

    // Check if all elements exist
    if (!depositTableBody || !loadingDepositIndicator || !adminDepositMessage || !refreshDepositsButton ||
        !withdrawalTableBody || !loadingWithdrawalIndicator || !adminWithdrawalMessage || !refreshWithdrawalsButton ||
        !historyTableBody || !loadingHistoryIndicator || !adminHistoryMessage || !refreshHistoryButton) {
        console.error("Admin page HTML elements not found! Check IDs.");
        alert("Error: Admin page elements missing. Check console.");
        return;
    }

    // --- Helper Functions ---
    function showLoading(indicatorElement, show) {
        if (indicatorElement) indicatorElement.style.display = show ? 'block' : 'none';
    }

    function showAdminMessage(messageElement, message, isError = false, duration = 5000) {
         if(!messageElement) return;
         messageElement.textContent = message;
         messageElement.className = 'admin-message'; // Reset classes
         messageElement.classList.add(isError ? 'error' : 'success', 'show');
         // Clear previous timeout if any
         if (messageElement.timeoutId) { clearTimeout(messageElement.timeoutId); }
         messageElement.timeoutId = setTimeout(() => { if(messageElement) messageElement.classList.remove('show'); }, duration);
    }

    // --- Deposit Request Functions ---
    async function fetchPendingDeposits() {
        showLoading(loadingDepositIndicator, true);
        if (depositTableBody) depositTableBody.innerHTML = '';
        if (adminDepositMessage) adminDepositMessage.textContent = '';
        try {
            const response = await fetch('/api/admin/pending-deposits');
            if (!response.ok) {
                if (response.status === 403) throw new Error('Forbidden - Not logged in as admin?');
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            const requests = await response.json();
            displayDepositRequests(requests);
        } catch (error) { console.error("Error fetching pending deposits:", error); showAdminMessage(adminDepositMessage, `Error loading deposits: ${error.message}`, true); }
        finally { showLoading(loadingDepositIndicator, false); }
    }

    function displayDepositRequests(requests) {
        if (!depositTableBody) return;
        if (requests.length === 0) { depositTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No pending deposit requests.</td></tr>'; return; }
        depositTableBody.innerHTML = ''; // Clear previous entries
        requests.forEach(req => {
            const row = depositTableBody.insertRow();
            row.insertCell().textContent = req.id;
            row.insertCell().textContent = req.username;
            row.insertCell().textContent = req.transaction_id;
            row.insertCell().textContent = new Date(req.requested_at).toLocaleString();
            const statusCell = row.insertCell(); statusCell.textContent = req.status; statusCell.classList.add(`status-${req.status}`);
            const actionCell = row.insertCell();
            if (req.status === 'pending') {
                const approveButton = document.createElement('button'); approveButton.textContent = 'Approve'; approveButton.classList.add('admin-action', 'approve'); approveButton.onclick = () => handleDepositApprove(req.id, approveButton); actionCell.appendChild(approveButton);
                const rejectButton = document.createElement('button'); rejectButton.textContent = 'Reject'; rejectButton.classList.add('admin-action', 'reject'); rejectButton.onclick = () => handleDepositReject(req.id, rejectButton); actionCell.appendChild(rejectButton);
            } else { actionCell.textContent = '-'; }
        });
    }

    async function handleDepositApprove(requestId, button) {
        const amountString = prompt(`Approve Deposit ID: ${requestId}\nEnter EXACT amount verified:`);
        if (amountString === null) return; // User cancelled
        const verifiedAmount = parseFloat(amountString);
        if (isNaN(verifiedAmount) || verifiedAmount <= 0) { alert("Invalid amount."); return; }
        button.disabled = true; button.textContent = '...';
        try {
            const response = await fetch('/api/admin/approve-deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId, verifiedAmount: verifiedAmount }) });
            const result = await response.json();
            if (response.ok && result.status === 'success') { showAdminMessage(adminDepositMessage, `Request ${requestId} approved.`); fetchPendingDeposits(); fetchHistory(); } // Refresh lists
            else { throw new Error(result.message || 'Approval failed.'); }
        } catch (error) { console.error(`Error approving deposit ${requestId}:`, error); showAdminMessage(adminDepositMessage, `Error: ${error.message}`, true); button.disabled = false; button.textContent = 'Approve'; }
    }

    async function handleDepositReject(requestId, button) {
        if (!confirm(`Reject Deposit ID: ${requestId}?`)) return;
        button.disabled = true; button.textContent = '...';
         try {
             const response = await fetch('/api/admin/reject-deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId }) });
             const result = await response.json();
             if (response.ok && result.status === 'success') { showAdminMessage(adminDepositMessage, `Request ${requestId} rejected.`); fetchPendingDeposits(); fetchHistory(); } // Refresh lists
             else { throw new Error(result.message || 'Rejection failed.'); }
         } catch (error) { console.error(`Error rejecting deposit ${requestId}:`, error); showAdminMessage(adminDepositMessage, `Error: ${error.message}`, true); button.disabled = false; button.textContent = 'Reject'; }
     }

    // --- Withdrawal Request Functions ---
    async function fetchPendingWithdrawals() {
        showLoading(loadingWithdrawalIndicator, true);
        if(withdrawalTableBody) withdrawalTableBody.innerHTML = '';
        if(adminWithdrawalMessage) adminWithdrawalMessage.textContent = '';
        try {
            const response = await fetch('/api/admin/pending-withdrawals');
            if (!response.ok) { if (response.status === 403) throw new Error('Forbidden - Not logged in as admin?'); throw new Error(`HTTP error! Status: ${response.status}`); }
            const requests = await response.json();
            displayWithdrawals(requests);
        } catch (error) { console.error("Error fetching pending withdrawals:", error); showAdminMessage(adminWithdrawalMessage, `Error loading withdrawals: ${error.message}`, true); }
        finally { showLoading(loadingWithdrawalIndicator, false); }
    }

    function displayWithdrawals(requests) {
        if(!withdrawalTableBody) return;
        if (requests.length === 0) { withdrawalTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No pending withdrawal requests.</td></tr>'; return; }
        withdrawalTableBody.innerHTML = ''; // Clear previous entries
        requests.forEach(req => {
            const row = withdrawalTableBody.insertRow();
            row.insertCell().textContent = req.id;
            row.insertCell().textContent = req.username;
            row.insertCell().textContent = parseFloat(req.amount).toFixed(2);
            row.insertCell().textContent = req.upi_id;
            row.insertCell().textContent = new Date(req.requested_at).toLocaleString();
            const statusCell = row.insertCell(); statusCell.textContent = req.status; statusCell.classList.add(`status-${req.status}`);
            const actionCell = row.insertCell();
            if (req.status === 'pending') {
                const approveButton = document.createElement('button'); approveButton.textContent = 'Approve (Paid)'; approveButton.classList.add('admin-action', 'approve'); approveButton.onclick = () => handleWithdrawalApprove(req.id, approveButton); actionCell.appendChild(approveButton);
                const rejectButton = document.createElement('button'); rejectButton.textContent = 'Reject'; rejectButton.classList.add('admin-action', 'reject'); rejectButton.onclick = () => handleWithdrawalReject(req.id, rejectButton); actionCell.appendChild(rejectButton);
            } else { actionCell.textContent = '-'; }
        });
    }

    async function handleWithdrawalApprove(requestId, button) {
        if (!confirm(`Approve Withdrawal ID: ${requestId}?\n\nCONFIRM you have ALREADY SENT the funds externally.`)) return;
        button.disabled = true; button.textContent = '...';
        try {
            const response = await fetch('/api/admin/approve-withdrawal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId }) });
            const result = await response.json();
            if (response.ok && result.status === 'success') { showAdminMessage(adminWithdrawalMessage, `Withdrawal ${requestId} approved.`); fetchPendingWithdrawals(); fetchHistory(); } // Refresh lists
            else { throw new Error(result.message || 'Approval failed.'); }
        } catch (error) { console.error(`Error approving withdrawal ${requestId}:`, error); showAdminMessage(adminWithdrawalMessage, `Error: ${error.message}`, true); button.disabled = false; button.textContent = 'Approve (Paid)'; }
    }

    async function handleWithdrawalReject(requestId, button) {
        if (!confirm(`Reject Withdrawal ID: ${requestId}?`)) return;
        button.disabled = true; button.textContent = '...';
         try {
             const response = await fetch('/api/admin/reject-withdrawal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId }) });
             const result = await response.json();
             if (response.ok && result.status === 'success') { showAdminMessage(adminWithdrawalMessage, `Withdrawal ${requestId} rejected.`); fetchPendingWithdrawals(); fetchHistory(); } // Refresh lists
             else { throw new Error(result.message || 'Rejection failed.'); }
         } catch (error) { console.error(`Error rejecting withdrawal ${requestId}:`, error); showAdminMessage(adminWithdrawalMessage, `Error: ${error.message}`, true); button.disabled = false; button.textContent = 'Reject'; }
     }

    // --- History Functions ---
    async function fetchHistory() {
        showLoading(loadingHistoryIndicator, true);
        if(historyTableBody) historyTableBody.innerHTML = '';
        if(adminHistoryMessage) adminHistoryMessage.textContent = '';
        try {
            const response = await fetch('/api/admin/request-history'); // Call history API
            if (!response.ok) { if (response.status === 403) throw new Error('Forbidden - Not logged in as admin?'); throw new Error(`HTTP error! Status: ${response.status}`); }
            const historyItems = await response.json();
            displayHistory(historyItems); // Display in history table
        } catch (error) { console.error("Error fetching request history:", error); showAdminMessage(adminHistoryMessage, `Error loading history: ${error.message}`, true); }
        finally { showLoading(loadingHistoryIndicator, false); }
    }

    function displayHistory(items) {
        if (!historyTableBody) return;
        if (items.length === 0) { historyTableBody.innerHTML = '<tr><td colspan="9" style="text-align: center;">No processed request history found.</td></tr>'; return; }
        historyTableBody.innerHTML = ''; // Clear previous entries
        items.forEach(item => {
            const row = historyTableBody.insertRow();
            row.insertCell().textContent = item.id;
            row.insertCell().textContent = item.type;
            row.insertCell().textContent = item.username;
            row.insertCell().textContent = item.details; // Txn ID or UPI ID
            const amountToShow = item.amount ? parseFloat(item.amount).toFixed(2) : '-'; // Approved/Requested amount
            row.insertCell().textContent = amountToShow;
            const statusCell = row.insertCell(); statusCell.textContent = item.status; statusCell.classList.add(`status-${item.status}`);
            row.insertCell().textContent = new Date(item.requested_at).toLocaleString();
            row.insertCell().textContent = item.processed_at ? new Date(item.processed_at).toLocaleString() : '-';
            row.insertCell().textContent = item.processed_by || '-';
        });
    }

    // --- Initial Load & Refresh Buttons ---
    function refreshAllData() {
        fetchPendingDeposits();
        fetchPendingWithdrawals();
        fetchHistory();
    }

    refreshAllData(); // Load all lists on page load

    if (refreshDepositsButton) refreshDepositsButton.addEventListener('click', fetchPendingDeposits);
    if (refreshWithdrawalsButton) refreshWithdrawalsButton.addEventListener('click', fetchPendingWithdrawals);
    if (refreshHistoryButton) refreshHistoryButton.addEventListener('click', fetchHistory);


}); // End DOMContentLoaded