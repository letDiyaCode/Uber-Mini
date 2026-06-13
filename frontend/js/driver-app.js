const RIDE_LABEL = {
    OFFERED: 'New request', ACCEPTED: 'Accepted', ARRIVING: 'Heading to pickup',
    ARRIVED: 'At pickup', IN_PROGRESS: 'On trip', COMPLETED: 'Completed',
    CANCELLED: 'Cancelled', NO_DRIVERS: 'No drivers',
};

class DriverApp {
    constructor() {
        this.map = new MapRenderer('city-map');
        this.driverId = null;
        this.online = false;
        this.drivers = [];
        this.offerRideId = null;
        this.currentRideId = null;
        this.earnings = 0;
        this.trips = 0;

        this.els = {
            select: document.getElementById('driver-select'),
            liveCard: document.getElementById('driver-card-live'),
            toggle: document.getElementById('online-toggle'),
            statusChip: document.getElementById('status-chip'),
            tripsValue: document.getElementById('trips-value'),
            earningsValue: document.getElementById('earnings-value'),
            offerSection: document.getElementById('offer-section'),
            offerContent: document.getElementById('offer-content'),
            acceptBtn: document.getElementById('accept-btn'),
            declineBtn: document.getElementById('decline-btn'),
            tripSection: document.getElementById('trip-section'),
            tripContent: document.getElementById('trip-content'),
            activity: document.getElementById('activity-log'),
            connBadge: document.getElementById('connection-badge'),
            errorToast: document.getElementById('error-toast'),
            successToast: document.getElementById('success-toast'),
        };
        this.logEntries = [];

        this.setupEvents();
        this.setupLive();
    }

    setupEvents() {
        this.els.select.addEventListener('change', (e) => {
            if (this.driverId) live.release(this.driverId);
            this.driverId = e.target.value || null;
            if (this.driverId) live.claim(this.driverId);
            this.renderLiveCard();
            this.updateEarnings();
            this.syncControls();
            this.syncCurrentRide();
        });

        this.els.toggle.addEventListener('click', () => {
            const d = this.me();
            if (!d) return;
            if (d.status === 'offline') {
                apiClient.setDriverOnline(this.driverId, true).catch(() => {});
                this.addActivity(`${d.name} is online`);
            } else if (d.status === 'available') {
                apiClient.setDriverOnline(this.driverId, false).catch(() => {});
                this.addActivity(`${d.name} is offline`);
            }
        });

        this.els.acceptBtn.addEventListener('click', async () => {
            if (!this.offerRideId) return;
            try { await apiClient.acceptOffer(this.offerRideId, this.driverId); }
            catch (err) { this.toast(err.message, false); }
            this.hideOffer();
        });

        this.els.declineBtn.addEventListener('click', async () => {
            if (!this.offerRideId) return;
            try { await apiClient.declineOffer(this.offerRideId, this.driverId); }
            catch (err) { this.toast(err.message, false); }
            this.hideOffer();
        });

        document.getElementById('zoom-in-btn').addEventListener('click', () => this.map.zoomIn());
        document.getElementById('zoom-out-btn').addEventListener('click', () => this.map.zoomOut());
        document.getElementById('reset-view-btn').addEventListener('click', () => this.map.resetView());
        document.getElementById('toggle-labels-btn').addEventListener('click', () => this.map.toggleLabels());
    }

    setupLive() {
        live.on('status', ({ connected }) => {
            this.els.connBadge.textContent = connected ? '● Live' : '● Reconnecting…';
            this.els.connBadge.className = 'connection-badge ' + (connected ? 'online' : 'offline');
        });

        live.on('init', (snap) => {
            this.map.loadGraph(snap.graph);
            this.map.loadDrivers(snap.drivers);
            this.drivers = snap.drivers;
            this.populateDrivers(snap.drivers);
            this.addActivity('Connected to dispatch');
        });

        live.on('drivers', (drivers) => {
            this.drivers = drivers;
            this.map.loadDrivers(drivers);
            this.updateDriverOptions(drivers);
            this.renderLiveCard();
            this.updateEarnings();
            this.syncControls();
            this.syncCurrentRide();
        });

        live.on('ride', (ride) => this.onRide(ride));

        live.connect();
    }

    populateDrivers(drivers) {
        const cur = this.els.select.value;
        this.els.select.innerHTML = '<option value="">Choose your driver profile…</option>';
        drivers.forEach((d) => {
            const o = document.createElement('option');
            o.value = d.id;
            this.els.select.appendChild(o);
        });
        if (cur) this.els.select.value = cur;
        this.updateDriverOptions(drivers);
    }

    updateDriverOptions(drivers) {
        // Skip while the dropdown is open to avoid native list flicker.
        if (document.activeElement === this.els.select) return;
        drivers.forEach((d) => {
            const opt = this.els.select.querySelector(`option[value="${d.id}"]`);
            if (!opt) return;
            const icon = VEHICLE_ICONS[d.vehicleType] || '🚗';
            const label = (DRIVER_STATUS_LABELS && DRIVER_STATUS_LABELS[d.status]) || d.status;
            const text = `${icon} ${d.name} · ${label}`;
            if (opt.textContent !== text) opt.textContent = text;
        });
    }

    me() {
        return this.drivers.find((d) => d.id === this.driverId) || null;
    }

    updateEarnings() {
        const d = this.me();
        const trips = d ? (d.sessionTrips || 0) : 0;
        const earn = d ? (d.sessionEarnings || 0) : 0;
        this.els.tripsValue.textContent = trips;
        this.els.earningsValue.textContent = `₹${Math.round(earn)}`;
    }

    // Show the selected driver's active ride/route, even if selected mid-trip.
    async syncCurrentRide() {
        const d = this.me();
        const rideId = d && d.rideId;

        if (!rideId) {
            if (this.currentRideId) {
                this.currentRideId = null;
                this.map.setActiveRides([]);
                this.els.tripSection.style.display = 'none';
            }
            return;
        }
        if (rideId === this.currentRideId) return; // already showing it

        this.currentRideId = rideId;
        try {
            const res = await apiClient.getRide(rideId);
            const ride = res.data;
            if (ride && ride.driverId === this.driverId) {
                this.showTrip(ride);
                this.map.setActiveRides([ride]);
            }
        } catch (e) {
            this.currentRideId = null;
        }
    }

    renderLiveCard() {
        const d = this.me();
        if (!d) { this.els.liveCard.innerHTML = ''; return; }
        const icon = VEHICLE_ICONS[d.vehicleType] || '🚗';
        const statusLabel = (DRIVER_STATUS_LABELS && DRIVER_STATUS_LABELS[d.status]) || d.status;
        this.els.liveCard.innerHTML = `
            <div class="driver-card" style="margin-bottom:12px;">
                <div class="driver-avatar">${icon}</div>
                <div class="driver-info">
                    <div class="driver-name">${d.name}</div>
                    <div class="driver-details">${d.vehicleType} • ⭐ ${d.rating} • ${d.completedRides} rides</div>
                </div>
                <div class="driver-status status-${d.status === 'available' ? 'available' : d.status === 'offline' ? 'offline' : 'busy'}">${statusLabel}</div>
            </div>`;
    }

    syncControls() {
        const btn = this.els.toggle;
        const span = btn.querySelector('span');
        const d = this.me();

        if (!d) {
            btn.disabled = true;
            span.textContent = 'Go online';
            btn.classList.add('btn-primary');
            btn.classList.remove('btn-danger');
            this.els.statusChip.textContent = 'Offline';
            this.online = false;
            return;
        }

        this.online = d.status !== 'offline';

        if (d.status === 'offline') {
            btn.disabled = false;
            span.textContent = 'Go online';
            btn.classList.add('btn-primary');
            btn.classList.remove('btn-danger');
            this.els.statusChip.textContent = 'Offline';
        } else if (d.status === 'available') {
            btn.disabled = false;
            span.textContent = 'Go offline';
            btn.classList.add('btn-danger');
            btn.classList.remove('btn-primary');
            this.els.statusChip.textContent = 'Online';
        } else {
            btn.disabled = true;
            span.textContent = 'On a trip…';
            btn.classList.add('btn-danger');
            btn.classList.remove('btn-primary');
            this.els.statusChip.textContent = (DRIVER_STATUS_LABELS && DRIVER_STATUS_LABELS[d.status]) || 'Busy';
        }
    }

    onRide(ride) {
        if (!this.driverId) return;
        const mine = ride.driverId === this.driverId;

        if (mine && ride.status === 'OFFERED' && this.online) {
            this.showOffer(ride);
        } else if (this.offerRideId === ride.id) {
            this.hideOffer();
        }

        if (mine && ['ACCEPTED', 'ARRIVING', 'ARRIVED', 'IN_PROGRESS'].includes(ride.status)) {
            this.currentRideId = ride.id;
            this.showTrip(ride);
            this.map.setActiveRides([ride]);
            this.hideOffer();
        }

        if (mine && ride.status === 'COMPLETED' && this.currentRideId === ride.id) {
            const earned = ride.fareFinal ? ride.fareFinal.total : 0;
            this.toast(`Trip complete · +₹${earned}`, true);
            this.addActivity(`Completed trip — earned ₹${earned}`);
            this.updateEarnings();
            this.map.setActiveRides([]);
            this.currentRideId = null;
            setTimeout(() => { this.els.tripSection.style.display = 'none'; }, 5000);
        }

        if (this.currentRideId === ride.id && ['CANCELLED', 'NO_DRIVERS'].includes(ride.status)) {
            this.addActivity('Trip cancelled');
            this.map.setActiveRides([]);
            this.currentRideId = null;
            this.els.tripSection.style.display = 'none';
        }
    }

    showOffer(ride) {
        this.offerRideId = ride.id;
        const fare = ride.fareEstimate;
        this.els.offerSection.style.display = 'block';
        this.els.offerContent.innerHTML = `
            <div class="ride-card-route">${ride.pickupName} <span class="arrow">→</span> ${ride.destinationName}</div>
            <div class="result-card">
                <div class="result-detail"><span>Pickup ETA</span><strong>${ride.pickupEtaMin} min</strong></div>
                <div class="result-detail"><span>Trip distance</span><strong>${ride.tripDistanceKm} km</strong></div>
                <div class="result-detail"><span>Trip time</span><strong>${ride.tripDurationMin} min</strong></div>
                <div class="result-detail fare-total"><span>You earn</span><strong>${fare.currency}${fare.total}</strong></div>
            </div>`;
        this.addActivity(`Request: ${ride.pickupName} → ${ride.destinationName}`);
    }

    hideOffer() {
        this.offerRideId = null;
        this.els.offerSection.style.display = 'none';
    }

    showTrip(ride) {
        this.els.tripSection.style.display = 'block';
        const fare = ride.fareFinal || ride.fareEstimate;
        this.els.tripContent.innerHTML = `
            <div class="status-badge status-${ride.status.toLowerCase()}">${RIDE_LABEL[ride.status] || ride.status}</div>
            ${this.stepper(ride.status)}
            <div class="ride-card-route">${ride.pickupName} <span class="arrow">→</span> ${ride.destinationName}</div>
            <div class="result-card">
                <div class="result-detail"><span>Rider</span><strong>${ride.passengerId}</strong></div>
                <div class="result-detail"><span>Distance</span><strong>${ride.tripDistanceKm} km</strong></div>
                <div class="result-detail fare-total"><span>Fare</span><strong>${fare.currency}${fare.total}</strong></div>
            </div>`;
    }

    stepper(status) {
        const steps = ['Accepted', 'Pickup', 'Trip', 'Done'];
        const idx = { ACCEPTED: 0, ARRIVING: 0, ARRIVED: 1, IN_PROGRESS: 2, COMPLETED: 3 }[status] ?? 0;
        const items = steps.map((s, i) => {
            const cls = i < idx ? 'done' : (i === idx ? 'active' : '');
            const mark = i < idx ? '✓' : (i + 1);
            return `<div class="step ${cls}"><div class="bullet">${mark}</div><div class="step-label">${s}</div></div>`;
        }).join('');
        return `<div class="stepper">${items}</div>`;
    }

    addActivity(message) {
        const time = new Date().toLocaleTimeString();
        this.logEntries.unshift({ time, message });
        this.logEntries = this.logEntries.slice(0, 40);
        this.els.activity.innerHTML = this.logEntries.map((e) =>
            `<div class="log-entry">${e.message} <span class="timeline-time">${e.time}</span></div>`).join('');
    }

    toast(message, ok) {
        const el = ok ? this.els.successToast : this.els.errorToast;
        el.textContent = message;
        el.classList.add('active');
        setTimeout(() => el.classList.remove('active'), 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.driverApp = new DriverApp();
    setInterval(() => { if (window.driverApp) window.driverApp.map.render(); }, 50);
});

window.addEventListener('resize', () => { if (window.driverApp) window.driverApp.map.render(); });
