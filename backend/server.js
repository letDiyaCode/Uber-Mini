/**
 * server-cpp.js
 *
 * Main Express server for Uber Mini Ride Sharing System
 * Uses C++ native addon for all algorithm implementations
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

// Import C++ native addon
const nativeAddon = require('../build/Release/uber_mini_native.node');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});


// Global state (in production, use database)
let cityGraph = null;
let rideMatcher = null;
let drivers = [];

/**
 * Initialize system with demo data from C++
 */
function initializeSystem() {
    console.log('Initializing Uber Mini system with C++ backend...');

    try {
        // Generate city graph and drivers using C++
        const cityData = nativeAddon.generateCityGraph(50);

        cityGraph = cityData.graph;
        drivers = cityData.drivers;
        rideMatcher = new nativeAddon.RideMatcher(cityGraph);

        // Add all drivers to the matcher
        drivers.forEach(driver => {
            rideMatcher.addDriver(driver);
        });

        console.log('System initialized successfully with C++ backend!');
        console.log(`- Graph nodes: ${cityGraph.getNumVertices()}`);
        console.log(`- Total drivers: ${drivers.length}`);
        console.log(`- Available drivers: ${drivers.filter(d => d.isAvailable).length}`);

    } catch (error) {
        console.error('Failed to initialize system:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

// Initialize on startup
initializeSystem();

/**
 * API ENDPOINTS
 */

// Health check
app.get('/api/health', (req, res) => {
    const availableDrivers = drivers.filter(d => d.isAvailable).length;
    res.json({
        status: 'healthy',
        backend: 'C++ Native Addon',
        timestamp: new Date().toISOString(),
        graphNodes: cityGraph ? cityGraph.getNumVertices() : 0,
        totalDrivers: drivers.length,
        availableDrivers: availableDrivers
    });
});

// Get graph data
app.get('/api/graph', (req, res) => {
    try {
        if (!cityGraph) {
            return res.status(500).json({
                success: false,
                error: 'Graph not initialized'
            });
        }

        const nodes = cityGraph.getAllNodes();
        const numVertices = cityGraph.getNumVertices();

        // Get all edges
        const edges = [];
        for (let i = 0; i < numVertices; i++) {
            const adjacentNodes = cityGraph.getAdjacentNodes(i);
            adjacentNodes.forEach(edge => {
                // Avoid duplicate edges (undirected graph)
                if (i < edge.destination) {
                    edges.push({
                        source: i,
                        destination: edge.destination,
                        weight: edge.weight,
                        roadName: edge.roadName
                    });
                }
            });
        }

        res.json({
            success: true,
            data: {
                numVertices: numVertices,
                nodes: nodes,
                edges: edges
            }
        });

    } catch (error) {
        console.error('Error getting graph:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get all drivers
app.get('/api/drivers', (req, res) => {
    try {
        const allDrivers = rideMatcher.getAllDrivers();
        res.json({
            success: true,
            data: allDrivers
        });
    } catch (error) {
        console.error('Error getting drivers:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get specific driver
app.get('/api/drivers/:driverId', (req, res) => {
    try {
        const { driverId } = req.params;
        const driver = rideMatcher.getDriver(driverId);

        if (!driver || !driver.id) {
            return res.status(404).json({
                success: false,
                error: 'Driver not found'
            });
        }

        res.json({
            success: true,
            data: driver
        });
    } catch (error) {
        console.error('Error getting driver:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update driver location
app.put('/api/drivers/:driverId/location', (req, res) => {
    try {
        const { driverId } = req.params;
        const { location } = req.body;

        if (location === undefined || location === null) {
            return res.status(400).json({
                success: false,
                error: 'Location is required'
            });
        }

        rideMatcher.updateDriverLocation(driverId, location);

        // Update local drivers array
        const driverIndex = drivers.findIndex(d => d.id === driverId);
        if (driverIndex !== -1) {
            drivers[driverIndex].currentLocation = location;
        }

        res.json({
            success: true,
            message: 'Driver location updated',
            data: rideMatcher.getDriver(driverId)
        });
    } catch (error) {
        console.error('Error updating driver location:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update driver availability
app.put('/api/drivers/:driverId/availability', (req, res) => {
    try {
        const { driverId } = req.params;
        const { isAvailable } = req.body;

        if (isAvailable === undefined || isAvailable === null) {
            return res.status(400).json({
                success: false,
                error: 'isAvailable is required'
            });
        }

        rideMatcher.setDriverAvailability(driverId, isAvailable);

        // Update local drivers array
        const driverIndex = drivers.findIndex(d => d.id === driverId);
        if (driverIndex !== -1) {
            drivers[driverIndex].isAvailable = isAvailable;
        }

        res.json({
            success: true,
            message: 'Driver availability updated',
            data: rideMatcher.getDriver(driverId)
        });
    } catch (error) {
        console.error('Error updating driver availability:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Find ride (main matching endpoint)
app.post('/api/rides/find', (req, res) => {
    try {
        const { passengerId, pickupLocation, destinationLocation } = req.body;

        // Validation
        if (!passengerId || pickupLocation === undefined || destinationLocation === undefined) {
            return res.status(400).json({
                success: false,
                error: 'passengerId, pickupLocation, and destinationLocation are required'
            });
        }

        console.log(`\n${'='.repeat(60)}`);
        console.log(`RIDE REQUEST`);
        console.log(`${'='.repeat(60)}`);
        console.log(`Passenger: ${passengerId}`);
        console.log(`Pickup: ${pickupLocation} (${cityGraph.getNode(pickupLocation).name})`);
        console.log(`Destination: ${destinationLocation} (${cityGraph.getNode(destinationLocation).name})`);

        // Find ride using C++ implementation
        const match = rideMatcher.findRide(passengerId, pickupLocation, destinationLocation);

        if (!match.success) {
            console.log(`❌ No drivers available`);
            console.log(`${'='.repeat(60)}\n`);
            return res.status(404).json(match);
        }

        console.log(`\n✅ RIDE MATCHED`);
        console.log(`Driver: ${match.driver.name} (${match.driver.id})`);
        console.log(`Vehicle: ${match.driver.vehicleType}`);
        console.log(`Rating: ${match.driver.rating}⭐`);
        console.log(`Distance to pickup: ${match.distanceToPickup.toFixed(2)} km`);
        console.log(`Distance to destination: ${match.distanceToDestination.toFixed(2)} km`);
        console.log(`Total distance: ${match.totalDistance.toFixed(2)} km`);
        console.log(`Estimated time: ${match.estimatedTime} minutes`);
        console.log(`${'='.repeat(60)}\n`);

        // Update driver availability in local array
        const driverIndex = drivers.findIndex(d => d.id === match.driver.id);
        if (driverIndex !== -1) {
            drivers[driverIndex].isAvailable = false;
        }

        res.json(match);

    } catch (error) {
        console.error('Error finding ride:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Request ride endpoint (alias for /api/rides/find for frontend compatibility)
app.post('/api/ride/request', (req, res) => {
    try {
        const { passengerId, pickupLocation, destinationLocation } = req.body;

        // Validation
        if (!passengerId || pickupLocation === undefined || destinationLocation === undefined) {
            return res.status(400).json({
                success: false,
                error: 'passengerId, pickupLocation, and destinationLocation are required'
            });
        }

        console.log(`\n${'='.repeat(60)}`);
        console.log(`RIDE REQUEST`);
        console.log(`${'='.repeat(60)}`);
        console.log(`Passenger: ${passengerId}`);
        console.log(`Pickup: ${pickupLocation} (${cityGraph.getNode(pickupLocation).name})`);
        console.log(`Destination: ${destinationLocation} (${cityGraph.getNode(destinationLocation).name})`);

        // Find ride using C++ implementation
        const match = rideMatcher.findRide(passengerId, pickupLocation, destinationLocation);

        if (!match.success) {
            console.log(`❌ No drivers available`);
            console.log(`${'='.repeat(60)}\n`);
            return res.status(404).json({
                success: false,
                data: match
            });
        }

        console.log(`\n✅ RIDE MATCHED`);
        console.log(`Driver: ${match.driver.name} (${match.driver.id})`);
        console.log(`Vehicle: ${match.driver.vehicleType}`);
        console.log(`Rating: ${match.driver.rating}⭐`);
        console.log(`Distance to pickup: ${match.distanceToPickup.toFixed(2)} km`);
        console.log(`Distance to destination: ${match.distanceToDestination.toFixed(2)} km`);
        console.log(`Total distance: ${match.totalDistance.toFixed(2)} km`);
        console.log(`Estimated time: ${match.estimatedTime} minutes`);
        console.log(`${'='.repeat(60)}\n`);

        // Update driver availability in local array
        const driverIndex = drivers.findIndex(d => d.id === match.driver.id);
        if (driverIndex !== -1) {
            drivers[driverIndex].isAvailable = false;
        }

        // Format response to match frontend expectations
        res.json({
            success: true,
            data: {
                assignedDriver: match.driver,
                driverToPickup: {
                    distance: match.distanceToPickup,
                    path: match.pathToPickup,
                    eta: match.estimatedTime
                },
                pickupToDestination: {
                    distance: match.distanceToDestination,
                    path: match.pathToDestination,
                    eta: match.estimatedTime
                },
                totalDistance: match.totalDistance,
                totalETA: match.estimatedTime,
                logs: {
                    dijkstra: [
                        `Calculating shortest path from node ${match.driver.currentLocation} to node ${pickupLocation}`,
                        `Found path with distance: ${match.distanceToPickup.toFixed(2)} km`,
                        `Calculating shortest path from node ${pickupLocation} to node ${destinationLocation}`,
                        `Found path with distance: ${match.distanceToDestination.toFixed(2)} km`
                    ],
                    heap: [
                        `Min-Heap used for priority queue in Dijkstra's algorithm`,
                        `Processed ${match.pathToPickup.length} nodes for driver-to-pickup route`,
                        `Processed ${match.pathToDestination.length} nodes for pickup-to-destination route`
                    ],
                    matching: [
                        `Searching for available drivers near pickup location (Node ${pickupLocation})`,
                        `Found driver: ${match.driver.name} (${match.driver.id})`,
                        `Driver location: Node ${match.driver.currentLocation}`,
                        `Driver to pickup distance: ${match.distanceToPickup.toFixed(2)} km`,
                        `Total trip distance: ${match.totalDistance.toFixed(2)} km`,
                        `Estimated time: ${match.estimatedTime} minutes`,
                        `Driver ${match.driver.name} assigned successfully`
                    ]
                }
            }
        });

    } catch (error) {
        console.error('Error finding ride:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get shortest path between two nodes
app.post('/api/path/shortest', (req, res) => {
    try {
        const { source, destination } = req.body;

        if (source === undefined || destination === undefined) {
            return res.status(400).json({
                success: false,
                error: 'source and destination are required'
            });
        }

        const numVertices = cityGraph.getNumVertices();
        if (source < 0 || source >= numVertices || destination < 0 || destination >= numVertices) {
            return res.status(400).json({
                success: false,
                error: 'Invalid source or destination node'
            });
        }

        // Use Dijkstra's algorithm (implemented in C++ via RideMatcher)
        const match = rideMatcher.findRide('temp', source, destination);

        if (!match.success) {
            return res.status(404).json({
                success: false,
                error: 'No path found'
            });
        }

        res.json({
            success: true,
            data: {
                path: match.pathToDestination,
                distance: match.distanceToDestination,
                source: source,
                destination: destination,
                sourceNode: cityGraph.getNode(source),
                destinationNode: cityGraph.getNode(destination)
            }
        });

    } catch (error) {
        console.error('Error finding shortest path:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get node information
app.get('/api/nodes/:nodeId', (req, res) => {
    try {
        const nodeId = parseInt(req.params.nodeId);

        if (isNaN(nodeId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid node ID'
            });
        }

        const node = cityGraph.getNode(nodeId);
        const adjacentNodes = cityGraph.getAdjacentNodes(nodeId);

        res.json({
            success: true,
            data: {
                node: node,
                adjacentNodes: adjacentNodes
            }
        });

    } catch (error) {
        console.error('Error getting node:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Reset system (reinitialize)
app.post('/api/system/reset', (req, res) => {
    try {
        initializeSystem();
        res.json({
            success: true,
            message: 'System reset successfully'
        });
    } catch (error) {
        console.error('Error resetting system:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: err.message
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚗 Uber Mini Server (C++ Backend) running on port ${PORT}`);
    console.log(`📊 Frontend: http://localhost:${PORT}`);
    console.log(`🔧 API: http://localhost:${PORT}/api/health`);
    console.log(`${'='.repeat(60)}\n`);
});

module.exports = app;
