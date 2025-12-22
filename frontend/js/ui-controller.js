/**
 * ui-controller.js
 *
 * Controls all UI interactions and updates
 * Manages form submissions, button clicks, and dynamic content
 */

class UIController {
    constructor() {
        this.pickupSelect = document.getElementById('pickup-select');
        this.destinationSelect = document.getElementById('destination-select');
        this.rideForm = document.getElementById('ride-request-form');
        this.rideResultSection = document.getElementById('ride-result-section');
        this.rideResultContent = document.getElementById('ride-result-content');
        this.driverList = document.getElementById('driver-list');
        this.loadingOverlay = document.getElementById('loading-overlay');
        this.errorToast = document.getElementById('error-toast');
        this.successToast = document.getElementById('success-toast');

        // Stats
        this.availableDriversStat = document.getElementById('available-drivers');
        this.totalNodesStat = document.getElementById('total-nodes');
        this.totalEdgesStat = document.getElementById('total-edges');

        // Log containers
        this.dijkstraLogs = document.getElementById('dijkstra-logs');
        this.heapLogs = document.getElementById('heap-logs');
        this.matchingLogs = document.getElementById('matching-logs');

        this.setupEventListeners();

        this.updateLogs({
            dijkstra: ['Waiting for ride request...'],
            heap: ['Waiting for ride request...'],
            matching: ['Waiting for ride request...']
        });

    }

    /**
     * Setup all event listeners
     */
    setupEventListeners() {
        // Tab switching
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchTab(btn.dataset.tab);
            });
        });
    }

    /**
     * Populate location dropdowns
     */
    populateLocations(nodes) {
        // Clear existing options
        this.pickupSelect.innerHTML = '<option value="">Select pickup location...</option>';
        this.destinationSelect.innerHTML = '<option value="">Select destination...</option>';

        // Add node options
        nodes.forEach(node => {
            const pickupOption = document.createElement('option');
            pickupOption.value = node.id;
            pickupOption.textContent = `${node.name} (Node ${node.id})`;
            this.pickupSelect.appendChild(pickupOption);

            const destOption = document.createElement('option');
            destOption.value = node.id;
            destOption.textContent = `${node.name} (Node ${node.id})`;
            this.destinationSelect.appendChild(destOption);
        });
    }

    /**
     * Update header statistics
     */
    updateStats(availableDrivers, totalNodes, totalEdges) {
        this.availableDriversStat.textContent = availableDrivers;
        this.totalNodesStat.textContent = totalNodes;
        this.totalEdgesStat.textContent = totalEdges;
    }

    /**
     * Display driver list
     */
    displayDrivers(drivers) {
        this.driverList.innerHTML = '';

        if (drivers.length === 0) {
            this.driverList.innerHTML = '<p>No drivers available</p>';
            return;
        }

        drivers.forEach(driver => {
            const driverCard = document.createElement('div');
            driverCard.className = 'driver-card';

            driverCard.innerHTML = `
                <div class="driver-avatar">🚗</div>
                <div class="driver-info">
                    <div class="driver-name">${driver.name}</div>
                    <div class="driver-details">
                        ${driver.vehicleType} • ⭐ ${driver.rating} • ${driver.completedRides} rides
                    </div>
                </div>
                <div class="driver-status ${driver.isAvailable ? 'status-available' : 'status-busy'}">
                    ${driver.isAvailable ? 'Available' : 'Busy'}
                </div>
            `;

            this.driverList.appendChild(driverCard);
        });
    }

    /**
     * Display ride result
     */
    displayRideResult(result) {
        this.rideResultSection.style.display = 'block';

        const driver = result.assignedDriver;
        const driverToPickup = result.driverToPickup;
        const pickupToDest = result.pickupToDestination;

        this.rideResultContent.innerHTML = `
            <div class="result-card">
                <div class="result-title">🚗 Assigned Driver</div>
                <div style="margin-top: 0.5rem;">
                    <strong>${driver.name}</strong><br>
                    ${driver.vehicleType} • ⭐ ${driver.rating}
                </div>
            </div>

            <div class="result-card">
                <div class="result-title">📍 Driver to Pickup</div>
                <div class="result-detail">
                    <span>Distance:</span>
                    <strong>${driverToPickup.distance.toFixed(2)} km</strong>
                </div>
                <div class="result-detail">
                    <span>ETA:</span>
                    <strong>${driverToPickup.eta.toFixed(1)} min</strong>
                </div>
                <div class="result-detail">
                    <span>Path:</span>
                    <strong>${driverToPickup.path.join(' → ')}</strong>
                </div>
            </div>

            <div class="result-card">
                <div class="result-title">🎯 Pickup to Destination</div>
                <div class="result-detail">
                    <span>Distance:</span>
                    <strong>${pickupToDest.distance.toFixed(2)} km</strong>
                </div>
                <div class="result-detail">
                    <span>ETA:</span>
                    <strong>${pickupToDest.eta.toFixed(1)} min</strong>
                </div>
                <div class="result-detail">
                    <span>Path:</span>
                    <strong>${pickupToDest.path.join(' → ')}</strong>
                </div>
            </div>

            <div class="result-card" style="border-left-color: #5cb85c;">
                <div class="result-title">✅ Total Journey</div>
                <div class="result-detail">
                    <span>Total Distance:</span>
                    <strong>${result.totalDistance.toFixed(2)} km</strong>
                </div>
                <div class="result-detail">
                    <span>Total ETA:</span>
                    <strong>${result.totalETA.toFixed(1)} min</strong>
                </div>
            </div>
        `;

        // Update logs
        this.updateLogs(result.logs);

        // Scroll to result
        this.rideResultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /**
     * Update algorithm logs
     */
    updateLogs(logs) {
        // Dijkstra logs
        this.dijkstraLogs.innerHTML = '';
        if (logs.dijkstra && logs.dijkstra.length > 0) {
            logs.dijkstra.forEach(log => {
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry';
                logEntry.textContent = log;
                this.dijkstraLogs.appendChild(logEntry);
            });
        } else {
            this.dijkstraLogs.innerHTML = '<p>No Dijkstra logs available</p>';
        }

        // Heap logs
        this.heapLogs.innerHTML = '';
        if (logs.heap && logs.heap.length > 0) {
            logs.heap.forEach(log => {
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry';
                logEntry.textContent = log;
                this.heapLogs.appendChild(logEntry);
            });
        } else {
            this.heapLogs.innerHTML = '<p>No heap logs available</p>';
        }

        // Matching logs
        this.matchingLogs.innerHTML = '';
        if (logs.matching && logs.matching.length > 0) {
            logs.matching.forEach(log => {
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry';
                logEntry.textContent = log;
                this.matchingLogs.appendChild(logEntry);
            });
        } else {
            this.matchingLogs.innerHTML = '<p>No matching logs available</p>';
        }
    }

    /**
     * Switch between log tabs
     */
    switchTab(tabName) {
        // Update tab buttons
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            if (btn.dataset.tab === tabName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Update tab content
        const logContainers = document.querySelectorAll('.log-container');
        logContainers.forEach(container => {
            if (container.id === `${tabName}-logs`) {
                container.classList.add('active');
            } else {
                container.classList.remove('active');
            }
        });
    }

    /**
     * Show loading overlay
     */
    showLoading() {
        this.loadingOverlay.classList.add('active');
    }

    /**
     * Hide loading overlay
     */
    hideLoading() {
        this.loadingOverlay.classList.remove('active');
    }

    /**
     * Show error toast
     */
    showError(message) {
        this.errorToast.textContent = message;
        this.errorToast.classList.add('active');

        setTimeout(() => {
            this.errorToast.classList.remove('active');
        }, 5000);
    }

    /**
     * Show success toast
     */
    showSuccess(message) {
        this.successToast.textContent = message;
        this.successToast.classList.add('active');

        setTimeout(() => {
            this.successToast.classList.remove('active');
        }, 3000);
    }

    /**
     * Clear ride result
     */
    clearRideResult() {
        this.rideResultSection.style.display = 'none';
        this.rideResultContent.innerHTML = '';
        this.dijkstraLogs.innerHTML = '';
        this.heapLogs.innerHTML = '';
        this.matchingLogs.innerHTML = '';
    }

    /**
     * Disable form
     */
    disableForm() {
        this.pickupSelect.disabled = true;
        this.destinationSelect.disabled = true;
        const submitBtn = this.rideForm.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
        }
    }

    /**
     * Enable form
     */
    enableForm() {
        this.pickupSelect.disabled = false;
        this.destinationSelect.disabled = false;
        const submitBtn = this.rideForm.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = false;
        }
    }
}
