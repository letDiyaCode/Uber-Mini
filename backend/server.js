const express = require('express');
const http = require('http');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { Server } = require('socket.io');

const nativeAddon = require('../build/Release/uber_mini_native.node');
const { RideService } = require('./lib/rideService');
const pricing = require('./lib/pricing');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../frontend')));

let rideService = null;

function initializeSystem() {
    console.log('Initializing Uber Mini (C++ engine + realistic simulation)...');
    const cityData = nativeAddon.generateCityGraph(50);
    const graph = cityData.graph;
    const matcher = new nativeAddon.RideMatcher(graph);
    cityData.drivers.forEach((d) => matcher.addDriver(d));

    if (rideService) rideService.stop();
    rideService = new RideService({ graph, matcher }, null);
    rideService.start();

    const stats = rideService.getStats();
    console.log(`  graph nodes: ${stats.graphNodes}`);
    console.log(`  drivers: ${stats.totalDrivers} (${stats.availableDrivers} available)`);
}

initializeSystem();

function parseNode(value) {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? null : n;
}

function validNode(n) {
    return n !== null && n >= 0 && n < rideService.graph.getNumVertices();
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        backend: 'C++ Native Addon + RideService',
        timestamp: new Date().toISOString(),
        ...rideService.getStats(),
    });
});

app.get('/api/graph', (req, res) => {
    res.json({ success: true, data: rideService.getGraphData() });
});

app.get('/api/vehicle-tiers', (req, res) => {
    res.json({ success: true, data: pricing.VEHICLE_TIERS });
});

app.get('/api/drivers', (req, res) => {
    res.json({ success: true, data: rideService.listDrivers() });
});

app.get('/api/drivers/:driverId', (req, res) => {
    const driver = rideService.fleet.get(req.params.driverId);
    if (!driver) {
        return res.status(404).json({ success: false, error: 'Driver not found' });
    }
    res.json({ success: true, data: rideService._driverView(driver) });
});

app.put('/api/drivers/:driverId/online', (req, res) => {
    const { online } = req.body;
    if (typeof online !== 'boolean') {
        return res.status(400).json({ success: false, error: 'online (boolean) is required' });
    }
    const result = rideService.setDriverOnline(req.params.driverId, online);
    res.status(result.success ? 200 : 400).json(result);
});

app.post('/api/rides/estimate', (req, res) => {
    const pickup = parseNode(req.body.pickupLocation ?? req.body.pickup);
    const destination = parseNode(req.body.destinationLocation ?? req.body.destination);
    const vehicleType = req.body.vehicleType || 'Sedan';

    if (!validNode(pickup) || !validNode(destination)) {
        return res.status(400).json({ success: false, error: 'Valid pickup and destination are required' });
    }
    const result = rideService.estimate(pickup, destination, vehicleType);
    res.status(result.success ? 200 : 400).json(result);
});

app.post('/api/rides', (req, res) => {
    const pickup = parseNode(req.body.pickupLocation ?? req.body.pickup);
    const destination = parseNode(req.body.destinationLocation ?? req.body.destination);
    const vehicleType = req.body.vehicleType || 'Sedan';
    const passengerId = req.body.passengerId || 'GUEST';

    if (!validNode(pickup) || !validNode(destination)) {
        return res.status(400).json({ success: false, error: 'Valid pickup and destination are required' });
    }
    const result = rideService.requestRide({ passengerId, pickup, destination, vehicleType });
    res.status(result.success ? 200 : 400).json(result);
});

app.get('/api/rides', (req, res) => {
    const pid = req.query.passengerId;
    const data = pid ? rideService.getActiveRidesForPassenger(pid) : [];
    res.json({ success: true, data });
});

app.get('/api/rides/:rideId', (req, res) => {
    const ride = rideService.getRide(req.params.rideId);
    if (!ride) return res.status(404).json({ success: false, error: 'Ride not found' });
    res.json({ success: true, data: rideService._rideView(ride) });
});

app.post('/api/rides/:rideId/cancel', (req, res) => {
    const result = rideService.cancelRide(req.params.rideId, req.body.by || 'rider');
    res.status(result.success ? 200 : 400).json(result);
});

app.post('/api/rides/:rideId/accept', (req, res) => {
    const { driverId } = req.body;
    if (!driverId) return res.status(400).json({ success: false, error: 'driverId is required' });
    const result = rideService.acceptOffer(req.params.rideId, driverId);
    res.status(result.success ? 200 : 400).json(result);
});

app.post('/api/rides/:rideId/decline', (req, res) => {
    const { driverId } = req.body;
    if (!driverId) return res.status(400).json({ success: false, error: 'driverId is required' });
    const result = rideService.declineOffer(req.params.rideId, driverId);
    res.status(result.success ? 200 : 400).json(result);
});

app.post('/api/system/reset', (req, res) => {
    initializeSystem();
    rideService.setIo(io);
    io.emit('state:init', rideService.getSnapshot());
    res.json({ success: true, message: 'System reset' });
});

app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ success: false, error: 'Internal server error', message: err.message });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
rideService.setIo(io);

io.on('connection', (socket) => {
    socket.emit('state:init', rideService.getSnapshot());
    socket.data.claimed = new Set();

    socket.on('ride:request', (payload, ack) => {
        const pickup = parseNode(payload.pickup);
        const destination = parseNode(payload.destination);
        if (!validNode(pickup) || !validNode(destination)) {
            if (ack) ack({ success: false, error: 'Invalid pickup/destination' });
            return;
        }
        const result = rideService.requestRide({
            passengerId: payload.passengerId || 'GUEST',
            pickup,
            destination,
            vehicleType: payload.vehicleType || 'Sedan',
        });
        if (ack) ack(result);
    });

    socket.on('ride:cancel', (payload, ack) => {
        const result = rideService.cancelRide(payload.rideId, 'rider');
        if (ack) ack(result);
    });

    // Driver UI claims a driver identity to receive/accept ride offers.
    socket.on('driver:claim', (payload, ack) => {
        const result = rideService.claimDriver(payload.driverId);
        if (result.success) socket.data.claimed.add(payload.driverId);
        if (ack) ack(result);
    });

    socket.on('driver:release', (payload, ack) => {
        rideService.releaseDriver(payload.driverId);
        socket.data.claimed.delete(payload.driverId);
        if (ack) ack({ success: true });
    });

    socket.on('disconnect', () => {
        // Release any drivers this client was controlling.
        for (const driverId of socket.data.claimed) {
            rideService.releaseDriver(driverId);
        }
    });
});

server.listen(PORT, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚗 Uber Mini running on http://localhost:${PORT}`);
    console.log(`🔌 WebSocket live updates enabled`);
    console.log(`${'='.repeat(60)}\n`);
});

module.exports = app;
