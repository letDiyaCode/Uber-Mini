class App {
    constructor() {
        this.mapRenderer = new MapRenderer('city-map');
        this.uiController = new UIController();
        this.graphData = null;

        this.rides = new Map();
        this.lastStatus = new Map();
        this.estimateTimer = null;
        this._resumed = false;
        this.passengerId = this._passengerId();

        this.viewBook = document.getElementById('view-book');
        this.viewTrack = document.getElementById('view-track');

        this.init();
    }

    _passengerId() {
        let id = null;
        try { id = localStorage.getItem('umini_pid'); } catch (e) {}
        if (!id) {
            id = 'rider-' + Math.random().toString(36).slice(2, 10);
            try { localStorage.setItem('umini_pid', id); } catch (e) {}
        }
        return id;
    }

    async resumeRides() {
        if (this._resumed) return;
        this._resumed = true;
        try {
            const res = await apiClient.getMyRides(this.passengerId);
            const list = res.data || [];
            list.forEach((r) => {
                this.rides.set(r.id, r);
                this.lastStatus.set(r.id, r.status);
            });
            if (list.length) {
                this.refreshRides();
                this.showView('track');
            }
        } catch (e) { /* nothing to resume */ }
    }

    showView(name) {
        const track = name === 'track';
        this.viewBook.classList.toggle('active', !track);
        this.viewTrack.classList.toggle('active', track);
        if (track) {
            // Canvas was hidden; recompute size and reserve room for the ride card.
            requestAnimationFrame(() => {
                const overlay = document.querySelector('.track-overlay');
                const absolute = overlay && getComputedStyle(overlay).position === 'absolute';
                this.mapRenderer.rightInset = absolute ? overlay.offsetWidth + 28 : 0;
                this.mapRenderer.resize();
            });
        }
    }

    async init() {
        try {
            const tiers = await apiClient.getVehicleTiers();
            this.uiController.renderVehicleTiers(tiers.data, () => this.refreshEstimate());
        } catch (e) {
            console.error('Failed to load vehicle tiers', e);
        }

        this.setupLiveConnection();
        this.setupEventListeners();
    }

    setupLiveConnection() {
        live.on('status', ({ connected }) => this.uiController.setConnection(connected));

        live.on('init', (snapshot) => {
            this.graphData = snapshot.graph;
            this.mapRenderer.loadGraph(this.graphData);
            this.uiController.populateLocations(this.graphData.nodes);
            this.mapRenderer.loadDrivers(snapshot.drivers);
            this.uiController.displayDrivers(snapshot.drivers);
            this.uiController.updateStats(snapshot.stats);
            this.uiController.addActivity('Connected to live system');
            this.resumeRides();
        });

        live.on('drivers', (drivers) => {
            this.mapRenderer.loadDrivers(drivers);
            this.uiController.displayDrivers(drivers);
        });

        live.on('stats', (stats) => this.uiController.updateStats(stats));

        live.on('ride', (ride) => {
            if (!this.rides.has(ride.id) && ride.passengerId !== this.passengerId) return;
            this.rides.set(ride.id, ride);
            this.refreshRides();
            this.handleRideEvent(ride);
        });

        live.connect();
    }

    setupEventListeners() {
        this.uiController.rideForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleRideRequest();
        });

        // Per-ride cancel
        this.uiController.rideStatusContent.addEventListener('click', async (e) => {
            const btn = e.target.closest('.cancel-ride-btn');
            if (!btn) return;
            try {
                await apiClient.cancelRide(btn.dataset.rideId);
            } catch (err) {
                this.uiController.showError(err.message);
            }
        });

        document.getElementById('zoom-in-btn').addEventListener('click', () => this.mapRenderer.zoomIn());
        document.getElementById('zoom-out-btn').addEventListener('click', () => this.mapRenderer.zoomOut());
        document.getElementById('reset-view-btn').addEventListener('click', () => this.mapRenderer.resetView());
        document.getElementById('toggle-labels-btn').addEventListener('click', () => this.mapRenderer.toggleLabels());

        this.uiController.pickupSelect.addEventListener('change', (e) => {
            const id = parseInt(e.target.value, 10);
            this.mapRenderer.setPickupSelection(isNaN(id) ? null : id);
            this.refreshEstimate();
        });
        this.uiController.destinationSelect.addEventListener('change', (e) => {
            const id = parseInt(e.target.value, 10);
            this.mapRenderer.setDestinationSelection(isNaN(id) ? null : id);
            this.refreshEstimate();
        });

        const swapBtn = document.getElementById('swap-btn');
        if (swapBtn) {
            swapBtn.addEventListener('click', () => {
                const p = this.uiController.pickupSelect.value;
                const d = this.uiController.destinationSelect.value;
                this.uiController.pickupSelect.value = d;
                this.uiController.destinationSelect.value = p;
                const pid = parseInt(d, 10);
                const did = parseInt(p, 10);
                this.mapRenderer.setPickupSelection(isNaN(pid) ? null : pid);
                this.mapRenderer.setDestinationSelection(isNaN(did) ? null : did);
                this.refreshEstimate();
            });
        }

        const bookAnother = document.getElementById('book-another');
        if (bookAnother) {
            bookAnother.addEventListener('click', () => this.showView('book'));
        }
    }

    refreshRides() {
        const arr = [...this.rides.values()];
        this.uiController.displayRides(arr);
        this.mapRenderer.setActiveRides(arr);
    }

    refreshEstimate() {
        const pickup = parseInt(this.uiController.pickupSelect.value, 10);
        const destination = parseInt(this.uiController.destinationSelect.value, 10);
        if (isNaN(pickup) || isNaN(destination) || pickup === destination) {
            this.uiController.showFareEstimate(null);
            return;
        }
        clearTimeout(this.estimateTimer);
        this.estimateTimer = setTimeout(async () => {
            try {
                const res = await apiClient.estimate(pickup, destination, this.uiController.selectedVehicle);
                this.uiController.showFareEstimate(res.data);
            } catch (err) {
                this.uiController.showFareEstimate(null);
            }
        }, 150);
    }

    async handleRideRequest() {
        const pickup = parseInt(this.uiController.pickupSelect.value, 10);
        const destination = parseInt(this.uiController.destinationSelect.value, 10);

        if (isNaN(pickup) || isNaN(destination)) {
            this.uiController.showError('Please select both pickup and destination');
            return;
        }
        if (pickup === destination) {
            this.uiController.showError('Pickup and destination cannot be the same');
            return;
        }

        this.uiController.disableForm();
        try {
            const res = await apiClient.requestRide(pickup, destination, this.uiController.selectedVehicle, this.passengerId);
            const ride = res.data;
            this.rides.set(ride.id, ride);
            this.refreshRides();
            this.handleRideEvent(ride);
            this.uiController.addActivity(`Ride requested: ${ride.pickupName} → ${ride.destinationName}`);
            this.showView('track');
        } catch (err) {
            this.uiController.showError(err.message);
        } finally {
            this.uiController.enableForm();
        }
    }

    handleRideEvent(ride) {
        if (this.lastStatus.get(ride.id) === ride.status) return;
        this.lastStatus.set(ride.id, ride.status);

        const who = ride.driver ? ride.driver.name : 'a driver';
        switch (ride.status) {
            case 'OFFERED':
                this.uiController.addActivity(`Offered to ${who}`);
                break;
            case 'ARRIVING':
                this.uiController.addActivity(`${who} is on the way (${ride.pickupEtaMin} min)`);
                break;
            case 'ARRIVED':
                this.uiController.addActivity(`${who} has arrived for ${ride.pickupName}`);
                break;
            case 'IN_PROGRESS':
                this.uiController.addActivity(`Trip started: ${ride.pickupName} → ${ride.destinationName}`);
                break;
            case 'COMPLETED':
                this.uiController.showSuccess(`Trip completed — ${ride.fareFinal.currency}${ride.fareFinal.total}`);
                this.uiController.addActivity(`Trip completed — ${ride.fareFinal.currency}${ride.fareFinal.total}`);
                this.resetSelectionIfMatches(ride);
                this.scheduleRemoval(ride.id);
                break;
            case 'CANCELLED':
                this.uiController.showError('Ride cancelled');
                this.uiController.addActivity('Ride cancelled');
                this.resetSelectionIfMatches(ride);
                this.scheduleRemoval(ride.id);
                break;
            case 'NO_DRIVERS':
                this.uiController.showError(`No ${ride.vehicleType} drivers available nearby`);
                this.uiController.addActivity(`No ${ride.vehicleType} drivers available`);
                this.resetSelectionIfMatches(ride);
                this.scheduleRemoval(ride.id);
                break;
        }
    }

    scheduleRemoval(rideId) {
        // Keep the final card visible briefly, then remove this ride.
        setTimeout(() => {
            this.rides.delete(rideId);
            this.lastStatus.delete(rideId);
            this.refreshRides();
            if (this.rides.size === 0) this.showView('book');
        }, 6000);
    }

    resetSelectionIfMatches(ride) {
        const p = parseInt(this.uiController.pickupSelect.value, 10);
        const d = parseInt(this.uiController.destinationSelect.value, 10);
        if (p === ride.pickup && d === ride.destination) {
            this.uiController.pickupSelect.value = '';
            this.uiController.destinationSelect.value = '';
            this.uiController.showFareEstimate(null);
            this.mapRenderer.clearSelections();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();

    setInterval(() => {
        if (window.app && window.app.mapRenderer) {
            window.app.mapRenderer.render();
        }
    }, 50);
});

window.addEventListener('resize', () => {
    if (window.app && window.app.mapRenderer) {
        window.app.mapRenderer.render();
    }
});
