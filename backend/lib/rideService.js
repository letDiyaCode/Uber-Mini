const { v4: uuidv4 } = require('uuid');
const SpatialGrid = require('./spatialGrid');
const { haversineKm, lerpLatLon } = require('./geo');
const pricing = require('./pricing');

const RideState = {
    REQUESTED: 'REQUESTED',
    OFFERED: 'OFFERED',
    ACCEPTED: 'ACCEPTED',
    ARRIVING: 'ARRIVING',
    ARRIVED: 'ARRIVED',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    NO_DRIVERS: 'NO_DRIVERS',
};

// Driver live statuses.
const DriverStatus = {
    OFFLINE: 'offline',
    AVAILABLE: 'available',
    OFFERED: 'offered',
    ENROUTE_PICKUP: 'enroute_pickup',
    ARRIVED: 'arrived',
    ON_TRIP: 'on_trip',
};

// Tunable simulation/config knobs.
const CONFIG = {
    tickMs: 400,
    simTimeFactor: 30,        // sim-seconds per real-second (accelerates demo)
    driveSpeedKmh: 40,        // average travel speed used for movement
    offerDecisionMs: 1500,    // how long a driver "thinks" before accept/decline
    acceptProbability: 0.9,   // chance a driver accepts an offer
    arrivedDwellMs: 1500,     // pause at pickup before trip starts
    maxCandidates: 5,         // drivers to route-evaluate per request
    prefilterK: 20,           // nearest-by-air drivers to route (>= fleet size → exact nearest)
    demandWindowMs: 5 * 60 * 1000,
    manualOfferTimeoutMs: 25000, // auto-decline if a human driver doesn't respond
};

class RideService {
    constructor(native, io) {
        this.native = native;     // { graph, matcher }
        this.io = io;             // socket.io server (may be null until set)
        this.graph = native.graph;
        this.matcher = native.matcher;

        this.nodeCoords = new Map();   // nodeId -> { lat, lon, name }
        this.fleet = new Map();        // driverId -> live driver state
        this.rides = new Map();        // rideId -> ride
        this.recentRequests = [];      // { ts, node } for demand/surge
        this.grid = new SpatialGrid(0.01);
        this.claimedDrivers = new Set(); // drivers controlled by a human (driver UI)

        this._buildNodeCoords();
        this._buildFleet();
        this._tickHandle = null;
    }

    setIo(io) {
        this.io = io;
    }

    _buildNodeCoords() {
        const nodes = this.graph.getAllNodes();
        for (const n of nodes) {
            this.nodeCoords.set(n.id, { lat: n.latitude, lon: n.longitude, name: n.name });
        }
    }

    _buildFleet() {
        const drivers = this.matcher.getAllDrivers();
        for (const d of drivers) {
            const coord = this.nodeCoords.get(d.currentLocation) || { lat: 0, lon: 0 };
            this.fleet.set(d.id, {
                id: d.id,
                name: d.name,
                vehicleType: d.vehicleType,
                rating: d.rating,
                completedRides: d.completedRides,
                node: d.currentLocation,
                lat: coord.lat,
                lon: coord.lon,
                status: d.isAvailable ? DriverStatus.AVAILABLE : DriverStatus.OFFLINE,
                rideId: null,
                movement: null,
                sessionTrips: 0,
                sessionEarnings: 0,
            });
        }
    }

    getNodes() {
        const out = [];
        for (const [id, c] of this.nodeCoords) {
            out.push({ id, name: c.name, latitude: c.lat, longitude: c.lon });
        }
        out.sort((a, b) => a.id - b.id);
        return out;
    }

    getGraphData() {
        const numVertices = this.graph.getNumVertices();
        const edges = [];
        for (let i = 0; i < numVertices; i++) {
            const adj = this.graph.getAdjacentNodes(i);
            adj.forEach((e) => {
                if (i < e.destination) {
                    edges.push({
                        source: i,
                        destination: e.destination,
                        weight: e.weight,
                        roadName: e.roadName,
                    });
                }
            });
        }
        return { numVertices, nodes: this.getNodes(), edges };
    }

    listDrivers() {
        return Array.from(this.fleet.values()).map((d) => this._driverView(d));
    }

    _driverView(d) {
        return {
            id: d.id,
            name: d.name,
            vehicleType: d.vehicleType,
            rating: d.rating,
            completedRides: d.completedRides,
            currentLocation: d.node,
            lat: d.lat,
            lon: d.lon,
            status: d.status,
            isAvailable: d.status === DriverStatus.AVAILABLE,
            rideId: d.rideId,
            sessionTrips: d.sessionTrips,
            sessionEarnings: d.sessionEarnings,
        };
    }

    getRide(rideId) {
        return this.rides.get(rideId) || null;
    }

    getActiveRidesForPassenger(passengerId) {
        return Array.from(this.rides.values())
            .filter((r) => r.passengerId === passengerId && this._isActive(r))
            .map((r) => this._rideView(r));
    }

    getStats() {
        const drivers = Array.from(this.fleet.values());
        return {
            totalDrivers: drivers.length,
            availableDrivers: drivers.filter((d) => d.status === DriverStatus.AVAILABLE).length,
            onlineDrivers: drivers.filter((d) => d.status !== DriverStatus.OFFLINE).length,
            activeRides: Array.from(this.rides.values()).filter((r) => this._isActive(r)).length,
            graphNodes: this.graph.getNumVertices(),
            surge: this._currentSurge(),
        };
    }

    getSnapshot() {
        return {
            graph: this.getGraphData(),
            drivers: this.listDrivers(),
            stats: this.getStats(),
        };
    }

    _pruneDemand() {
        const cutoff = Date.now() - CONFIG.demandWindowMs;
        this.recentRequests = this.recentRequests.filter((r) => r.ts >= cutoff);
    }

    _availableCount() {
        let n = 0;
        for (const d of this.fleet.values()) {
            if (d.status === DriverStatus.AVAILABLE) n++;
        }
        return n;
    }

    _hotspotBoost(node) {
        const count = this.recentRequests.filter((r) => r.node === node).length;
        return count >= 2 ? 0.3 : 0;
    }

    _currentSurge(pickupNode = null) {
        // Surge pricing disabled — fares are flat (1.0x).
        return 1.0;
    }

    estimate(pickup, destination, vehicleType = 'Sedan') {
        if (pickup === destination) {
            return { success: false, error: 'Pickup and destination cannot be the same' };
        }
        const route = this.matcher.computePath(pickup, destination);
        if (!route.found) {
            return { success: false, error: 'No route found between those locations' };
        }
        const surge = this._currentSurge(pickup);
        const fare = pricing.estimateFare(route.distance, route.eta, vehicleType, surge);
        return {
            success: true,
            data: {
                distanceKm: Number(route.distance.toFixed(2)),
                durationMin: Number(route.eta.toFixed(1)),
                path: route.path,
                surge,
                fare,
            },
        };
    }

    requestRide({ passengerId, pickup, destination, vehicleType = 'Sedan' }) {
        if (pickup === destination) {
            return { success: false, error: 'Pickup and destination cannot be the same' };
        }
        const tripRoute = this.matcher.computePath(pickup, destination);
        if (!tripRoute.found) {
            return { success: false, error: 'No route found between those locations' };
        }

        this.recentRequests.push({ ts: Date.now(), node: pickup });
        const surge = this._currentSurge(pickup);

        const ride = {
            id: uuidv4(),
            passengerId: passengerId || 'GUEST',
            pickup,
            destination,
            pickupName: this.nodeCoords.get(pickup)?.name,
            destinationName: this.nodeCoords.get(destination)?.name,
            vehicleType,
            status: RideState.REQUESTED,
            createdAt: Date.now(),
            surge,
            tripDistanceKm: Number(tripRoute.distance.toFixed(2)),
            tripDurationMin: Number(tripRoute.eta.toFixed(1)),
            tripPath: tripRoute.path,
            fareEstimate: pricing.estimateFare(tripRoute.distance, tripRoute.eta, vehicleType, surge),
            driverId: null,
            driver: null,
            pickupPath: [],
            pickupDistanceKm: 0,
            pickupEtaMin: 0,
            fareFinal: null,
            candidates: [],
            candidateIndex: 0,
            timeline: [],
        };
        this._pushTimeline(ride, 'Ride requested');
        this.rides.set(ride.id, ride);

        this._matchRide(ride);
        this._emitRide(ride);
        this._emitDrivers();
        return { success: true, data: this._rideView(ride) };
    }

    _matchRide(ride) {
        const pickupCoord = this.nodeCoords.get(ride.pickup);

        // Spatial prefilter: all available drivers, nearest first by air distance.
        this.grid.clear();
        for (const d of this.fleet.values()) {
            if (d.status === DriverStatus.AVAILABLE) {
                this.grid.insert(d.id, d.lat, d.lon);
            }
        }
        const near = this.grid.nearest(pickupCoord.lat, pickupCoord.lon, CONFIG.prefilterK);

        // Route each candidate via the C++ engine for an accurate pickup ETA.
        const routed = [];
        for (const cand of near) {
            const d = this.fleet.get(cand.id);
            const route = this.matcher.computePath(d.node, ride.pickup);
            if (route.found) {
                routed.push({
                    driverId: d.id,
                    vehicleType: d.vehicleType,
                    distanceKm: Number(route.distance.toFixed(2)),
                    etaMin: Number(route.eta.toFixed(1)),
                    path: route.path,
                });
            }
        }

        // Offer to the requested vehicle type first (nearest → next), then fall
        // back to other vehicle types if none of them accept.
        const sameType = routed
            .filter((c) => c.vehicleType === ride.vehicleType)
            .sort((a, b) => a.etaMin - b.etaMin);
        const otherType = routed
            .filter((c) => c.vehicleType !== ride.vehicleType)
            .sort((a, b) => a.etaMin - b.etaMin);

        ride.candidates = [...sameType.slice(0, 6), ...otherType.slice(0, 4)];
        ride.candidateIndex = 0;

        if (ride.candidates.length === 0) {
            ride.status = RideState.NO_DRIVERS;
            this._pushTimeline(ride, 'No drivers available nearby');
            return;
        }
        this._offerNext(ride);
    }

    _offerNext(ride) {
        if (ride.candidateIndex >= ride.candidates.length) {
            ride.status = RideState.NO_DRIVERS;
            ride.driverId = null;
            ride.driver = null;
            this._pushTimeline(ride, 'All nearby drivers declined');
            this._emitRide(ride);
            return;
        }

        const cand = ride.candidates[ride.candidateIndex];
        const driver = this.fleet.get(cand.driverId);

        // Skip drivers that became unavailable since matching.
        if (!driver || driver.status !== DriverStatus.AVAILABLE) {
            ride.candidateIndex++;
            return this._offerNext(ride);
        }

        ride.status = RideState.OFFERED;
        ride.driverId = driver.id;
        ride.pickupPath = cand.path;
        ride.pickupDistanceKm = cand.distanceKm;
        ride.pickupEtaMin = cand.etaMin;
        driver.status = DriverStatus.OFFERED;
        driver.rideId = ride.id;

        // Note when we've fallen back to a different vehicle type.
        if (driver.vehicleType !== ride.vehicleType) {
            this._pushTimeline(ride, `No ${ride.vehicleType} available — offering ${driver.vehicleType}`);
        }

        this._pushTimeline(ride, `Offered to ${driver.name} (${cand.etaMin} min away)`);
        this._emitRide(ride);
        this._emitDrivers();

        if (this.claimedDrivers.has(driver.id)) {
            // Human-controlled driver: wait for manual accept/decline, with a
            // safety timeout so the rider isn't left hanging.
            ride._offerTimer = setTimeout(() => {
                this.declineOffer(ride.id, driver.id);
            }, CONFIG.manualOfferTimeoutMs);
        } else {
            // Simulated driver decides on its own.
            ride._offerTimer = setTimeout(() => {
                const accepts = Math.random() < CONFIG.acceptProbability;
                if (accepts) {
                    this.acceptOffer(ride.id, driver.id);
                } else {
                    this.declineOffer(ride.id, driver.id);
                }
            }, CONFIG.offerDecisionMs);
        }
    }

    acceptOffer(rideId, driverId) {
        const ride = this.rides.get(rideId);
        if (!ride || ride.status !== RideState.OFFERED || ride.driverId !== driverId) {
            return { success: false, error: 'Offer is no longer valid' };
        }
        if (ride._offerTimer) {
            clearTimeout(ride._offerTimer);
            ride._offerTimer = null;
        }
        const driver = this.fleet.get(driverId);

        ride.status = RideState.ACCEPTED;
        ride.driver = this._driverView(driver);
        ride.fareEstimate = pricing.estimateFare(
            ride.tripDistanceKm, ride.tripDurationMin, driver.vehicleType, ride.surge
        );
        this.matcher.setDriverAvailability(driverId, false);
        this._pushTimeline(ride, `${driver.name} accepted the ride`);

        ride.status = RideState.ARRIVING;
        driver.status = DriverStatus.ENROUTE_PICKUP;
        this._startMovement(driver, ride.pickupPath, () => this._onArrivedPickup(ride));
        this._pushTimeline(ride, `${driver.name} is on the way`);

        this._emitRide(ride);
        this._emitDrivers();
        return { success: true, data: this._rideView(ride) };
    }

    declineOffer(rideId, driverId) {
        const ride = this.rides.get(rideId);
        if (!ride || ride.status !== RideState.OFFERED || ride.driverId !== driverId) {
            return { success: false, error: 'Offer is no longer valid' };
        }
        if (ride._offerTimer) {
            clearTimeout(ride._offerTimer);
            ride._offerTimer = null;
        }
        const driver = this.fleet.get(driverId);
        if (driver && driver.status === DriverStatus.OFFERED) {
            driver.status = DriverStatus.AVAILABLE;
            driver.rideId = null;
        }
        this._pushTimeline(ride, `${driver ? driver.name : 'Driver'} declined; trying next driver`);
        ride.candidateIndex++;
        this._offerNext(ride);
        this._emitDrivers();
        return { success: true, data: this._rideView(ride) };
    }

    _onArrivedPickup(ride) {
        const driver = this.fleet.get(ride.driverId);
        ride.status = RideState.ARRIVED;
        driver.status = DriverStatus.ARRIVED;
        driver.node = ride.pickup;
        this._pushTimeline(ride, `${driver.name} arrived at pickup`);
        this._emitRide(ride);
        this._emitDrivers();

        setTimeout(() => this._startTrip(ride), CONFIG.arrivedDwellMs);
    }

    _startTrip(ride) {
        if (ride.status !== RideState.ARRIVED) return; // may have been cancelled
        const driver = this.fleet.get(ride.driverId);
        ride.status = RideState.IN_PROGRESS;
        ride.startedAt = Date.now();
        driver.status = DriverStatus.ON_TRIP;
        this._startMovement(driver, ride.tripPath, () => this._completeRide(ride));
        this._pushTimeline(ride, 'Trip started');
        this._emitRide(ride);
        this._emitDrivers();
    }

    _completeRide(ride) {
        const driver = this.fleet.get(ride.driverId);
        ride.status = RideState.COMPLETED;
        ride.completedAt = Date.now();

        ride.fareFinal = pricing.estimateFare(
            ride.tripDistanceKm,
            ride.tripDurationMin,
            driver.vehicleType,
            ride.surge
        );

        // Driver ends at destination and frees up.
        driver.node = ride.destination;
        const destCoord = this.nodeCoords.get(ride.destination);
        driver.lat = destCoord.lat;
        driver.lon = destCoord.lon;
        driver.completedRides += 1;
        driver.sessionTrips += 1;
        driver.sessionEarnings += ride.fareFinal.total;
        driver.status = DriverStatus.AVAILABLE;
        driver.rideId = null;
        driver.movement = null;
        this.matcher.setDriverAvailability(driver.id, true);
        this.matcher.updateDriverLocation(driver.id, ride.destination);

        this._pushTimeline(ride, `Trip completed — fare ${ride.fareFinal.currency}${ride.fareFinal.total}`);
        this._emitRide(ride);
        this._emitDrivers();
    }

    cancelRide(rideId, by = 'rider') {
        const ride = this.rides.get(rideId);
        if (!ride) return { success: false, error: 'Ride not found' };
        if (ride.status === RideState.COMPLETED || ride.status === RideState.CANCELLED) {
            return { success: false, error: `Ride already ${ride.status.toLowerCase()}` };
        }
        if (ride._offerTimer) {
            clearTimeout(ride._offerTimer);
            ride._offerTimer = null;
        }
        if (ride.driverId) {
            const driver = this.fleet.get(ride.driverId);
            if (driver) {
                // Pull over at the nearest node so the driver is routable again.
                this._snapToNearestNode(driver);
                driver.status = DriverStatus.AVAILABLE;
                driver.rideId = null;
                this.matcher.setDriverAvailability(driver.id, true);
            }
        }
        ride.status = RideState.CANCELLED;
        ride.cancelledBy = by;
        this._pushTimeline(ride, `Ride cancelled by ${by}`);
        this._emitRide(ride);
        this._emitDrivers();
        return { success: true, data: this._rideView(ride) };
    }

    setDriverOnline(driverId, online) {
        const driver = this.fleet.get(driverId);
        if (!driver) return { success: false, error: 'Driver not found' };
        if (online) {
            if (driver.status === DriverStatus.OFFLINE) {
                driver.status = DriverStatus.AVAILABLE;
                this.matcher.setDriverAvailability(driverId, true);
            }
        } else if (driver.status === DriverStatus.AVAILABLE) {
            driver.status = DriverStatus.OFFLINE;
            this.matcher.setDriverAvailability(driverId, false);
        } else {
            return { success: false, error: 'Driver is busy and cannot go offline' };
        }
        this._emitDrivers();
        return { success: true, data: this._driverView(driver) };
    }

    claimDriver(driverId) {
        const driver = this.fleet.get(driverId);
        if (!driver) return { success: false, error: 'Driver not found' };
        this.claimedDrivers.add(driverId);
        return { success: true, data: this._driverView(driver) };
    }

    releaseDriver(driverId) {
        this.claimedDrivers.delete(driverId);
        for (const ride of this.rides.values()) {
            if (ride.status === RideState.OFFERED && ride.driverId === driverId) {
                this.declineOffer(ride.id, driverId);
            }
        }
        return { success: true };
    }

    _startMovement(driver, path, onComplete) {
        if (!path || path.length < 2) {
            if (onComplete) onComplete();
            return;
        }
        const coords = path.map((id) => {
            const c = this.nodeCoords.get(id);
            return { lat: c.lat, lon: c.lon };
        });
        const segLengths = [];
        let total = 0;
        for (let i = 0; i < coords.length - 1; i++) {
            const len = haversineKm(coords[i].lat, coords[i].lon, coords[i + 1].lat, coords[i + 1].lon);
            segLengths.push(len);
            total += len;
        }
        driver.movement = {
            coords,
            segLengths,
            totalKm: total,
            traveled: 0,
            speedKmh: CONFIG.driveSpeedKmh,
            onComplete,
            path,
        };
    }

    // Stop a driver mid-route and snap it to the nearest node so it stays routable.
    _snapToNearestNode(driver) {
        const m = driver.movement;
        if (!m) return;

        let acc = 0;
        let idx = m.segLengths.length;
        for (let i = 0; i < m.segLengths.length; i++) {
            if (acc + m.segLengths[i] >= m.traveled) {
                idx = i;
                break;
            }
            acc += m.segLengths[i];
        }

        const a = Math.min(idx, m.path.length - 1);
        const b = Math.min(idx + 1, m.path.length - 1);
        const da = haversineKm(driver.lat, driver.lon, m.coords[a].lat, m.coords[a].lon);
        const db = haversineKm(driver.lat, driver.lon, m.coords[b].lat, m.coords[b].lon);
        const nodeId = da <= db ? m.path[a] : m.path[b];

        const c = this.nodeCoords.get(nodeId);
        driver.node = nodeId;
        driver.lat = c.lat;
        driver.lon = c.lon;
        driver.movement = null;
        this.matcher.updateDriverLocation(driver.id, nodeId);
    }

    _advanceDriver(driver, dtHours) {
        const m = driver.movement;
        if (!m) return false;
        m.traveled += m.speedKmh * dtHours;

        if (m.traveled >= m.totalKm) {
            const last = m.coords[m.coords.length - 1];
            driver.lat = last.lat;
            driver.lon = last.lon;
            const cb = m.onComplete;
            driver.movement = null;
            if (cb) cb();
            return true;
        }

        // Find current segment.
        let acc = 0;
        for (let i = 0; i < m.segLengths.length; i++) {
            if (acc + m.segLengths[i] >= m.traveled) {
                const within = m.segLengths[i] === 0 ? 0 : (m.traveled - acc) / m.segLengths[i];
                const pos = lerpLatLon(m.coords[i], m.coords[i + 1], within);
                driver.lat = pos.lat;
                driver.lon = pos.lon;
                return true;
            }
            acc += m.segLengths[i];
        }
        return true;
    }

    start() {
        if (this._tickHandle) return;
        const dtHours = (CONFIG.tickMs / 1000) * CONFIG.simTimeFactor / 3600;
        this._tickHandle = setInterval(() => {
            let moved = false;
            for (const driver of this.fleet.values()) {
                if (driver.movement) {
                    this._advanceDriver(driver, dtHours);
                    moved = true;
                }
            }
            if (moved) this._emitDrivers();
        }, CONFIG.tickMs);
    }

    stop() {
        if (this._tickHandle) {
            clearInterval(this._tickHandle);
            this._tickHandle = null;
        }
    }

    _isActive(ride) {
        return [
            RideState.REQUESTED,
            RideState.OFFERED,
            RideState.ACCEPTED,
            RideState.ARRIVING,
            RideState.ARRIVED,
            RideState.IN_PROGRESS,
        ].includes(ride.status);
    }

    _pushTimeline(ride, message) {
        ride.timeline.push({ ts: Date.now(), status: ride.status, message });
    }

    _rideView(ride) {
        // Strip internal fields (timers) before sending out.
        const { _offerTimer, candidates, candidateIndex, ...view } = ride;
        // Always reflect the live driver state (position/status) if assigned.
        if (ride.driverId && this.fleet.has(ride.driverId)) {
            view.driver = this._driverView(this.fleet.get(ride.driverId));
        }
        return view;
    }

    _emitRide(ride) {
        if (this.io) this.io.emit('ride:update', this._rideView(ride));
    }

    _emitDrivers() {
        if (this.io) {
            this.io.emit('drivers:update', this.listDrivers());
            this.io.emit('stats:update', this.getStats());
        }
    }
}

module.exports = { RideService, RideState, DriverStatus, CONFIG };
