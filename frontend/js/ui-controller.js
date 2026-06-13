const RIDE_STATUS_LABEL = {
    REQUESTED: 'Finding a driver…',
    OFFERED: 'Waiting for driver to accept…',
    ACCEPTED: 'Driver accepted',
    ARRIVING: 'Driver on the way',
    ARRIVED: 'Driver has arrived',
    IN_PROGRESS: 'On trip',
    COMPLETED: 'Trip completed',
    CANCELLED: 'Ride cancelled',
    NO_DRIVERS: 'No drivers available',
};

class UIController {
    constructor() {
        this.pickupSelect = document.getElementById('pickup-select');
        this.destinationSelect = document.getElementById('destination-select');
        this.rideForm = document.getElementById('ride-request-form');
        this.vehicleOptions = document.getElementById('vehicle-options');
        this.fareEstimate = document.getElementById('fare-estimate');
        this.rideStatusSection = document.getElementById('ride-status-section');
        this.rideStatusContent = document.getElementById('ride-status-content');
        this.driverList = document.getElementById('driver-list');
        this.activityLog = document.getElementById('activity-log');
        this.errorToast = document.getElementById('error-toast');
        this.successToast = document.getElementById('success-toast');
        this.connectionBadge = document.getElementById('connection-badge');

        this.availableDriversStat = document.getElementById('available-drivers');
        this.activeRidesStat = document.getElementById('active-rides');
        this.totalNodesStat = document.getElementById('total-nodes');
        this.surgeStat = document.getElementById('surge-value');

        this.selectedVehicle = 'Sedan';
        this.logEntries = [];
    }

    populateLocations(nodes) {
        this.pickupSelect.innerHTML = '<option value="">Select pickup location...</option>';
        this.destinationSelect.innerHTML = '<option value="">Select destination...</option>';
        nodes.forEach((node) => {
            const o1 = document.createElement('option');
            o1.value = node.id;
            o1.textContent = `${node.name} (#${node.id})`;
            this.pickupSelect.appendChild(o1);
            const o2 = o1.cloneNode(true);
            this.destinationSelect.appendChild(o2);
        });
    }

    renderVehicleTiers(tiers, onSelect) {
        this.vehicleOptions.innerHTML = '';
        Object.entries(tiers).forEach(([name, t]) => {
            const icon = (typeof VEHICLE_ICONS !== 'undefined' && VEHICLE_ICONS[name]) || '🚗';
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'vehicle-card' + (name === this.selectedVehicle ? ' selected' : '');
            card.dataset.vehicle = name;
            card.innerHTML = `
                <div class="vehicle-icon">${icon}</div>
                <div class="vehicle-name">${name}</div>
                <div class="vehicle-rate">₹${t.perKm}/km</div>
            `;
            card.addEventListener('click', () => {
                this.selectedVehicle = name;
                this.vehicleOptions.querySelectorAll('.vehicle-card').forEach((c) =>
                    c.classList.toggle('selected', c.dataset.vehicle === name));
                if (onSelect) onSelect(name);
            });
            this.vehicleOptions.appendChild(card);
        });
    }

    showFareEstimate(est) {
        if (!est) {
            this.fareEstimate.style.display = 'none';
            return;
        }
        const f = est.fare;
        const surgeTag = est.surge > 1
            ? `<span class="surge-tag">${est.surge}× surge</span>` : '';
        this.fareEstimate.style.display = 'block';
        this.fareEstimate.innerHTML = `
            <div class="fare-row fare-total">
                <span>Estimated Fare ${surgeTag}</span>
                <strong>${f.currency}${f.total}</strong>
            </div>
            <div class="fare-row"><span>Distance</span><span>${est.distanceKm} km</span></div>
            <div class="fare-row"><span>Duration</span><span>${est.durationMin} min</span></div>
            <div class="fare-row fare-muted"><span>Base ${f.currency}${f.baseFare} + ${f.currency}${f.perKm}/km + ${f.currency}${f.perMin}/min + ${f.currency}${f.bookingFee} fee</span></div>
        `;
    }

    updateStats(stats) {
        if (!stats) return;
        if (stats.availableDrivers !== undefined) this.availableDriversStat.textContent = stats.availableDrivers;
        if (stats.activeRides !== undefined) this.activeRidesStat.textContent = stats.activeRides;
        if (stats.graphNodes !== undefined) this.totalNodesStat.textContent = stats.graphNodes;
        if (stats.surge !== undefined) {
            this.surgeStat.textContent = `${Number(stats.surge).toFixed(1)}x`;
            this.surgeStat.style.color = stats.surge > 1 ? '#f0ad4e' : '#5cb85c';
        }
    }

    displayDrivers(drivers) {
        this.driverList.innerHTML = '';
        if (!drivers || drivers.length === 0) {
            this.driverList.innerHTML = '<p>No drivers</p>';
            return;
        }
        const order = { available: 0, offered: 1, enroute_pickup: 2, arrived: 3, on_trip: 4, offline: 5 };
        [...drivers].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)).forEach((driver) => {
            const card = document.createElement('div');
            card.className = 'driver-card';
            const statusClass = driver.status === 'available' ? 'status-available'
                : driver.status === 'offline' ? 'status-offline' : 'status-busy';
            const icon = (typeof VEHICLE_ICONS !== 'undefined' && VEHICLE_ICONS[driver.vehicleType]) || '🚗';
            card.innerHTML = `
                <div class="driver-avatar">${icon}</div>
                <div class="driver-info">
                    <div class="driver-name">${driver.name}</div>
                    <div class="driver-details">${driver.vehicleType} • ⭐ ${driver.rating} • ${driver.completedRides} rides</div>
                </div>
                <div class="driver-status ${statusClass}">${this._driverStatusLabel(driver.status)}</div>
            `;
            this.driverList.appendChild(card);
        });
    }

    _driverStatusLabel(status) {
        return {
            available: 'Available', offered: 'Offered', enroute_pickup: 'To Pickup',
            arrived: 'Arrived', on_trip: 'On Trip', offline: 'Offline',
        }[status] || status;
    }

    displayRides(rides) {
        const active = rides || [];
        if (active.length === 0) {
            this.rideStatusSection.style.display = 'none';
            this.rideStatusContent.innerHTML = '';
            return;
        }
        this.rideStatusSection.style.display = 'block';
        // Newest ride first.
        this.rideStatusContent.innerHTML = [...active]
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .map((r) => this._rideCardHtml(r))
            .join('');
    }

    _rideCardHtml(ride) {
        const terminal = ['COMPLETED', 'CANCELLED', 'NO_DRIVERS'].includes(ride.status);
        const driver = ride.driver;
        const fare = ride.fareFinal || ride.fareEstimate;
        const icon = (typeof VEHICLE_ICONS !== 'undefined' && driver && VEHICLE_ICONS[driver.vehicleType]) || '🚗';
        const surgeTag = ride.surge > 1 ? `<span class="surge-tag">${ride.surge}× surge</span>` : '';

        const driverBlock = driver ? `
            <div class="result-card">
                <div class="result-title">${icon} ${driver.name}</div>
                <div class="result-detail"><span>Vehicle</span><strong>${driver.vehicleType} • ⭐ ${driver.rating}</strong></div>
                ${ride.pickupEtaMin ? `<div class="result-detail"><span>Pickup ETA</span><strong>${ride.pickupEtaMin} min</strong></div>` : ''}
            </div>` : '';

        const cancelBtn = terminal ? '' :
            `<button class="btn btn-danger cancel-ride-btn" data-ride-id="${ride.id}" style="margin-top:0.5rem;">Cancel Ride</button>`;

        return `
            <div class="ride-card-block">
                <div class="ride-card-route">${ride.pickupName} → ${ride.destinationName}</div>
                <div class="status-badge status-${ride.status.toLowerCase()}">${RIDE_STATUS_LABEL[ride.status] || ride.status}</div>
                ${driverBlock}
                <div class="result-card">
                    <div class="result-detail"><span>Distance</span><strong>${ride.tripDistanceKm} km</strong></div>
                    <div class="result-detail"><span>Duration</span><strong>${ride.tripDurationMin} min</strong></div>
                </div>
                <div class="result-card" style="border-left-color:#f0ad4e;">
                    <div class="result-detail fare-total"><span>${ride.fareFinal ? 'Final Fare' : 'Fare'} ${surgeTag}</span><strong>${fare.currency}${fare.total}</strong></div>
                </div>
                ${this._renderTimeline(ride.timeline)}
                ${cancelBtn}
            </div>
        `;
    }

    _renderTimeline(timeline) {
        if (!timeline || timeline.length === 0) return '';
        const items = timeline.slice(-6).map((t) => {
            const time = new Date(t.ts).toLocaleTimeString();
            return `<div class="timeline-item"><span class="timeline-dot"></span>${t.message} <span class="timeline-time">${time}</span></div>`;
        }).join('');
        return `<div class="timeline">${items}</div>`;
    }

    addActivity(message) {
        const time = new Date().toLocaleTimeString();
        this.logEntries.unshift({ time, message });
        this.logEntries = this.logEntries.slice(0, 40);
        this.activityLog.innerHTML = this.logEntries.map((e) =>
            `<div class="log-entry">${e.message} <span class="timeline-time">${e.time}</span></div>`).join('');
    }

    setConnection(connected) {
        this.connectionBadge.textContent = connected ? '● live' : '● disconnected';
        this.connectionBadge.className = 'connection-badge ' + (connected ? 'online' : 'offline');
    }

    disableForm() {
        this.rideForm.querySelector('button[type="submit"]').disabled = true;
    }
    enableForm() {
        this.rideForm.querySelector('button[type="submit"]').disabled = false;
    }

    showError(message) {
        this.errorToast.textContent = message;
        this.errorToast.classList.add('active');
        setTimeout(() => this.errorToast.classList.remove('active'), 4000);
    }
    showSuccess(message) {
        this.successToast.textContent = message;
        this.successToast.classList.add('active');
        setTimeout(() => this.successToast.classList.remove('active'), 2500);
    }
}
