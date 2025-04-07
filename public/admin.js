// public/admin.js - Logic for the Admin Page

document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('requestsTableBody');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const adminMessage = document.getElementById('adminMessage');
    const refreshButton = document.getElementById('refreshRequests');

    if (!tableBody || !loadingIndicator || !adminMessage || !refreshButton) {
        console.error("Admin page HTML elements not found!");
        return;
    }

    // --- Functions ---

    function showLoading(show) {
        loadingIndicator.style.display = show ? 'block' : 'none';
    }

    function showAdminMessage(message, isError = false) {
        adminMessage.textContent = message;
        adminMessage.style.color = isError ? 'red' : 'green';
        setTimeout(() => { adminMessage.textContent = ''; }, 5000); // Hide after 5 seconds
    }

    async function fetchPendingRequests() {
        showLoading(true);
        tableBody.innerHTML = ''; // Clear table
        adminMessage.textContent = ''; // Clear previous messages
        try {
            const response = await fetch('/api/admin/pending-deposits'); // Call server API
            if (!response.ok) {
                if (response.status === 403) {
                     throw new Error('Forbidden - Are you logged in as admin?');
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const requests = await response.json();
            displayRequests(requests);
        } catch (error) {
            console.error("Error fetching pending requests:", error);
            showAdminMessage(`Error loading requests: ${error.message}`, true);
        } finally {
            showLoading(false);
        }
    }

    function displayRequests(requests) {
        if (requests.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No pending requests found.</td></tr>';
            return;
        }

        requests.forEach(req => {
            const row = tableBody.insertRow();
            row.insertCell().textContent = req.id;
            row.insertCell().textContent = req.username;
            row.insertCell().textContent = req.transaction_id;
            row.insertCell().textContent = new Date(req.requested_at).toLocaleString();
            const statusCell = row.insertCell();
            statusCell.textContent = req.status;
            statusCell.classList.add(`status-${req.status}`); // Add class for styling

            // Actions Cell
            const actionCell = row.insertCell();
            if (req.status === 'pending') {
                const approveButton = document.createElement('button');
                approveButton.textContent = 'Approve';
                approveButton.classList.add('admin-action', 'approve');
                approveButton.onclick = () => handleApprove(req.id, approveButton); // Pass button to disable
                actionCell.appendChild(approveButton);

                const rejectButton = document.createElement('button');
                rejectButton.textContent = 'Reject';
                rejectButton.classList.add('admin-action', 'reject');
                 rejectButton.onclick = () => handleReject(req.id, rejectButton); // Pass button to disable
                actionCell.appendChild(rejectButton);
            } else {
                actionCell.textContent = '-'; // No actions if not pending
            }
        });
    }

    async function handleApprove(requestId, button) {
        // Ask admin for the verified amount
        const amountString = prompt(`You are approving Request ID: ${requestId}\nPlease enter the EXACT amount you verified was received:`);
        if (amountString === null) return; // User cancelled prompt

        const verifiedAmount = parseFloat(amountString);
        if (isNaN(verifiedAmount) || verifiedAmount <= 0) {
            alert("Invalid amount entered. Please enter a positive number.");
            return;
        }

        button.disabled = true; // Disable button during processing
        button.textContent = 'Processing...';

        try {
            const response = await fetch('/api/admin/approve-deposit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId: requestId, verifiedAmount: verifiedAmount })
            });
            const result = await response.json();

            if (response.ok && result.status === 'success') {
                showAdminMessage(`Request ${requestId} approved successfully. Balance updated.`);
                fetchPendingRequests(); // Refresh the list
            } else {
                throw new Error(result.message || 'Approval failed.');
            }
        } catch (error) {
            console.error(`Error approving request ${requestId}:`, error);
            showAdminMessage(`Error approving request ${requestId}: ${error.message}`, true);
            button.disabled = false; // Re-enable button on error
             button.textContent = 'Approve';
        }
    }

     async function handleReject(requestId, button) {
        if (!confirm(`Are you sure you want to reject Request ID: ${requestId}? This cannot be undone.`)) {
            return;
        }

        button.disabled = true; // Disable button during processing
        button.textContent = 'Processing...';

         try {
             const response = await fetch('/api/admin/reject-deposit', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ requestId: requestId })
             });
             const result = await response.json();

             if (response.ok && result.status === 'success') {
                 showAdminMessage(`Request ${requestId} rejected successfully.`);
                 fetchPendingRequests(); // Refresh the list
             } else {
                 throw new Error(result.message || 'Rejection failed.');
             }
         } catch (error) {
             console.error(`Error rejecting request ${requestId}:`, error);
             showAdminMessage(`Error rejecting request ${requestId}: ${error.message}`, true);
             button.disabled = false; // Re-enable button on error
              button.textContent = 'Reject';
         }
     }


    // --- Initial Load & Refresh ---
    fetchPendingRequests(); // Load data when page loads
    refreshButton.addEventListener('click', fetchPendingRequests); // Refresh on button click

});