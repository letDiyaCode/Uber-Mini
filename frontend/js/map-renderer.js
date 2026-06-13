/**
 * map-renderer.js
 *
 * Renders the city map with nodes, edges, drivers, and routes
 * Shows weighted edges, driver names, and real-time selection highlighting
 */

// Distinct icon per vehicle tier (shared with the side driver list).
const VEHICLE_ICONS = {
    Compact: '🚗',
    Sedan: '🚕',
    SUV: '🚙',
    Luxury: '🏎️',
};
const DRIVER_STATUS_LABELS = {
    available: 'Available',
    offered: 'Offered',
    enroute_pickup: 'To Pickup',
    arrived: 'Arrived',
    on_trip: 'On Trip',
    offline: 'Offline',
};
// Rides in these states no longer draw routes/markers on the map.
const TERMINAL_RIDE_STATES = ['COMPLETED', 'CANCELLED', 'NO_DRIVERS'];

class MapRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        // Map data
        this.graph = null;
        this.drivers = [];
        // Form selection (pre-request preview)
        this.selectionPickup = null;
        this.selectionDestination = null;
        // Live rides currently shown on the map
        this.activeRides = [];
        this.activeDriverIds = new Set();

        // Rendering state
        this.scale = 1.0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.showLabels = true;
        this.showWeights = true; // Show edge weights

        // Animation
        this.animationFrame = 0;
        this.isAnimating = false;

        // Dragging
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;

        // Hover tooltip
        this.tooltip = document.getElementById('map-tooltip');
        this.driverHitboxes = []; // { driver, x, y, r } computed each draw

        this.initCanvas();
        this.setupEventListeners();
    }

    /**
     * Initialize canvas size
     */
    initCanvas() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;

        window.addEventListener('resize', () => {
            this.canvas.width = container.clientWidth;
            this.canvas.height = container.clientHeight;
            this.render();
        });
    }

    /**
     * Setup mouse event listeners for pan functionality
     */
    setupEventListeners() {
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                const dx = e.clientX - this.lastMouseX;
                const dy = e.clientY - this.lastMouseY;

                this.offsetX += dx;
                this.offsetY += dy;

                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;

                this.hideTooltip();
                this.render();
            } else {
                this.handleHover(e);
            }
        });

        this.canvas.addEventListener('mouseup', () => {
            this.isDragging = false;
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.isDragging = false;
            this.hideTooltip();
        });

        // Mouse wheel for zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomSpeed = 0.1;
            const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;

            this.scale = Math.max(0.2, Math.min(3.0, this.scale + delta));
            this.render();
        });
    }

    /**
     * Hit-test the cursor against driver markers and show a tooltip.
     */
    handleHover(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        let hit = null;
        for (const hb of this.driverHitboxes) {
            const dx = mx - hb.x;
            const dy = my - hb.y;
            if (dx * dx + dy * dy <= hb.r * hb.r) {
                hit = hb.driver;
                break;
            }
        }

        if (hit) {
            this.canvas.style.cursor = 'pointer';
            this.showTooltip(hit, e.clientX - rect.left, e.clientY - rect.top);
        } else {
            this.canvas.style.cursor = this.isDragging ? 'grabbing' : 'grab';
            this.hideTooltip();
        }
    }

    showTooltip(driver, x, y) {
        if (!this.tooltip) return;
        const icon = VEHICLE_ICONS[driver.vehicleType] || '🚗';
        const statusLabel = DRIVER_STATUS_LABELS[driver.status] || driver.status;
        const statusClass = driver.status === 'available' ? 'available'
            : driver.status === 'offline' ? 'offline' : 'busy';
        const node = this.graph && this.graph.nodes
            ? this.graph.nodes.find((n) => n.id === driver.currentLocation) : null;

        this.tooltip.innerHTML = `
            <div class="tt-head">${icon} ${driver.name}</div>
            <div class="tt-row"><span>Vehicle</span><strong>${driver.vehicleType}</strong></div>
            <div class="tt-row"><span>Status</span><strong class="tt-status ${statusClass}">${statusLabel}</strong></div>
            <div class="tt-row"><span>Rating</span><strong>⭐ ${driver.rating}</strong></div>
            <div class="tt-row"><span>Trips</span><strong>${driver.completedRides}</strong></div>
            <div class="tt-row"><span>Near</span><strong>${node ? node.name : 'node ' + driver.currentLocation}</strong></div>
        `;
        this.tooltip.style.display = 'block';

        // Position within the map container, flipping near edges.
        const tw = this.tooltip.offsetWidth;
        const th = this.tooltip.offsetHeight;
        let left = x + 14;
        let top = y + 14;
        if (left + tw > this.canvas.width) left = x - tw - 14;
        if (top + th > this.canvas.height) top = y - th - 14;
        this.tooltip.style.left = `${Math.max(4, left)}px`;
        this.tooltip.style.top = `${Math.max(4, top)}px`;
    }

    hideTooltip() {
        if (this.tooltip) this.tooltip.style.display = 'none';
    }

    /**
     * Load graph data
     */
    loadGraph(graphData) {
        this.graph = graphData;
        this.centerView();
        this.render();
    }

    /**
     * Load drivers
     */
    loadDrivers(drivers) {
        this.drivers = drivers;
        this.render();
    }

    /**
     * Set pickup selection (called when user selects from dropdown)
     */
    setPickupSelection(nodeId) {
        this.selectionPickup = nodeId;
        this.render();
    }

    /**
     * Set destination selection (called when user selects from dropdown)
     */
    setDestinationSelection(nodeId) {
        this.selectionDestination = nodeId;
        this.render();
    }

    /**
     * Clear selections
     */
    clearSelections() {
        this.selectionPickup = null;
        this.selectionDestination = null;
        this.render();
    }

    /**
     * Center view on graph
     */
    centerView() {
        if (!this.graph || !this.graph.nodes || this.graph.nodes.length === 0) {
            return;
        }

        // Calculate bounds
        let minLat = Infinity, maxLat = -Infinity;
        let minLon = Infinity, maxLon = -Infinity;

        for (const node of this.graph.nodes) {
            minLat = Math.min(minLat, node.latitude);
            maxLat = Math.max(maxLat, node.latitude);
            minLon = Math.min(minLon, node.longitude);
            maxLon = Math.max(maxLon, node.longitude);
        }

        // Calculate center and scale
        const centerLat = (minLat + maxLat) / 2;
        const centerLon = (minLon + maxLon) / 2;

        const latRange = maxLat - minLat || 0.1;
        const lonRange = maxLon - minLon || 0.1;

        const scaleX = this.canvas.width / (lonRange * 10000);
        const scaleY = this.canvas.height / (latRange * 10000);

        this.scale = Math.min(scaleX, scaleY) * 0.8;

        // Center offset
        this.offsetX = this.canvas.width / 2;
        this.offsetY = this.canvas.height / 2;

        // Store center for coordinate conversion
        this.centerLat = centerLat;
        this.centerLon = centerLon;
    }

    /**
     * Convert lat/lon to canvas coordinates
     */
    latLonToCanvas(lat, lon) {
        const x = (lon - this.centerLon) * 10000 * this.scale + this.offsetX;
        const y = -(lat - this.centerLat) * 10000 * this.scale + this.offsetY;
        return { x, y };
    }

    /**
     * Zoom in
     */
    zoomIn() {
        this.scale = Math.min(3.0, this.scale + 0.2);
        this.render();
    }

    /**
     * Zoom out
     */
    zoomOut() {
        this.scale = Math.max(0.2, this.scale - 0.2);
        this.render();
    }

    /**
     * Reset view
     */
    resetView() {
        this.centerView();
        this.render();
    }

    /**
     * Toggle labels
     */
    toggleLabels() {
        this.showLabels = !this.showLabels;
        this.render();
    }

    // Render the active rides; paths are drawn statically and the moving driver
    // marker provides the live motion.
    setActiveRides(rides) {
        this.activeRides = Array.isArray(rides) ? rides : [];
        this.activeDriverIds = new Set(
            this.activeRides
                .filter((r) => r.driverId && !TERMINAL_RIDE_STATES.includes(r.status))
                .map((r) => r.driverId)
        );
        this.render();
    }

    /**
     * Main render function
     */
    render() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (!this.graph) return;

        // Draw edges (with weights)
        this.drawEdges();

        // Draw route paths (if any)
        this.drawRoutePaths();

        // Draw nodes
        this.drawNodes();

        // Draw drivers (with names)
        this.drawDrivers();

        // Draw selected pickup and destination (REAL-TIME)
        this.drawSelectedLocations();
    }

    /**
     * Draw all edges with weights
     */
    drawEdges() {
        if (!this.graph.edges) return;

        this.ctx.strokeStyle = '#d0d0d0';
        this.ctx.lineWidth = 2;

        for (const edge of this.graph.edges) {
            const sourceNode = this.graph.nodes.find(n => n.id === edge.source);
            const destNode = this.graph.nodes.find(n => n.id === edge.destination);

            if (!sourceNode || !destNode) continue;

            const start = this.latLonToCanvas(sourceNode.latitude, sourceNode.longitude);
            const end = this.latLonToCanvas(destNode.latitude, destNode.longitude);

            // Draw edge line
            this.ctx.beginPath();
            this.ctx.moveTo(start.x, start.y);
            this.ctx.lineTo(end.x, end.y);
            this.ctx.stroke();

            // Draw weight label (if zoomed in enough)
            if (this.showWeights && this.scale > 0.6) {
                const midX = (start.x + end.x) / 2;
                const midY = (start.y + end.y) / 2;

                // Background for weight label
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                const weightText = edge.weight.toFixed(1) + ' km';
                const textWidth = this.ctx.measureText(weightText).width;
                this.ctx.fillRect(midX - textWidth / 2 - 3, midY - 8, textWidth + 6, 16);

                // Weight text
                this.ctx.fillStyle = '#555';
                this.ctx.font = 'bold 11px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(weightText, midX, midY);
            }
        }
    }

    // Draw each ride's route, trimmed so only the part ahead of the driver shows.
    drawRoutePaths() {
        for (const ride of this.activeRides) {
            const driver = ride.driverId
                ? this.drivers.find((d) => d.id === ride.driverId) : null;
            const from = driver && typeof driver.lat === 'number'
                ? { lat: driver.lat, lon: driver.lon } : null;

            if (ride.status === 'OFFERED' || ride.status === 'ACCEPTED' || ride.status === 'ARRIVING') {
                // Driver heading to pickup (green), trimmed ahead of the driver.
                this.drawRemainingPath(ride.pickupPath, from, '#5cb85c', 4);
            } else if (ride.status === 'ARRIVED') {
                // Upcoming trip, not yet started — show full route (blue).
                this.drawRemainingPath(ride.tripPath, null, '#0066ff', 5);
            } else if (ride.status === 'IN_PROGRESS') {
                // Trip in progress (blue), trimmed ahead of the driver.
                this.drawRemainingPath(ride.tripPath, from, '#0066ff', 5);
            }
        }
    }

    // Remaining polyline from `fromPos` (projected onto the nearest segment) to the end.
    _remainingFrom(coords, fromPos) {
        let bestSeg = 0;
        let bestDist = Infinity;
        let bestPoint = coords[0];
        for (let i = 0; i < coords.length - 1; i++) {
            const ax = coords[i].lon, ay = coords[i].lat;
            const bx = coords[i + 1].lon, by = coords[i + 1].lat;
            const dx = bx - ax, dy = by - ay;
            const len2 = dx * dx + dy * dy;
            let t = len2 === 0 ? 0 : ((fromPos.lon - ax) * dx + (fromPos.lat - ay) * dy) / len2;
            t = Math.max(0, Math.min(1, t));
            const projLon = ax + t * dx;
            const projLat = ay + t * dy;
            const ddx = fromPos.lon - projLon;
            const ddy = fromPos.lat - projLat;
            const dist = ddx * ddx + ddy * ddy;
            if (dist < bestDist) {
                bestDist = dist;
                bestSeg = i;
                bestPoint = { lat: projLat, lon: projLon };
            }
        }
        const remaining = [bestPoint];
        for (let i = bestSeg + 1; i < coords.length; i++) remaining.push(coords[i]);
        return remaining;
    }

    // Draw a path by node ids; if `fromPos` is given, only the part to the end is drawn.
    drawRemainingPath(pathIds, fromPos, color, lineWidth) {
        if (!pathIds || pathIds.length < 2) return;

        const coords = pathIds
            .map((id) => {
                const n = this.graph.nodes.find((x) => x.id === id);
                return n ? { lat: n.latitude, lon: n.longitude } : null;
            })
            .filter(Boolean);
        if (coords.length < 2) return;

        const pts = fromPos ? this._remainingFrom(coords, fromPos) : coords;
        if (pts.length < 2) return;

        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = lineWidth;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 10;

        this.ctx.beginPath();
        pts.forEach((p, i) => {
            const c = this.latLonToCanvas(p.lat, p.lon);
            if (i === 0) this.ctx.moveTo(c.x, c.y);
            else this.ctx.lineTo(c.x, c.y);
        });
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
    }

    /**
     * Draw all nodes
     */
    drawNodes() {
        if (!this.graph.nodes) return;

        // Collect endpoint nodes (drawn separately as P/D markers).
        const endpoints = new Set();
        if (this.selectionPickup !== null) endpoints.add(this.selectionPickup);
        if (this.selectionDestination !== null) endpoints.add(this.selectionDestination);
        for (const ride of this.activeRides) {
            if (TERMINAL_RIDE_STATES.includes(ride.status)) continue;
            endpoints.add(ride.pickup);
            endpoints.add(ride.destination);
        }

        for (const node of this.graph.nodes) {
            const pos = this.latLonToCanvas(node.latitude, node.longitude);

            // Skip endpoints (drawn separately)
            if (endpoints.has(node.id)) continue;

            // Draw node circle
            this.ctx.fillStyle = '#6c757d';
            this.ctx.beginPath();
            this.ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
            this.ctx.fill();

            // Draw node border
            this.ctx.strokeStyle = '#495057';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();

            // Draw label
            if (this.showLabels && this.scale > 0.5) {
                this.ctx.fillStyle = '#212529';
                this.ctx.font = '12px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(node.name, pos.x, pos.y - 12);
            }
        }
    }

    /**
     * Draw drivers with per-vehicle icons, colors and hover hitboxes.
     */
    drawDrivers() {
        this.driverHitboxes = [];

        for (const driver of this.drivers) {
            // Prefer live lat/lon (smooth movement); fall back to node position.
            let pos;
            if (typeof driver.lat === 'number' && typeof driver.lon === 'number') {
                pos = this.latLonToCanvas(driver.lat, driver.lon);
            } else {
                const node = this.graph.nodes.find(n => n.id === driver.currentLocation);
                if (!node) continue;
                pos = this.latLonToCanvas(node.latitude, node.longitude);
            }

            const isAssigned = this.activeDriverIds.has(driver.id);
            const isOffline = driver.status === 'offline';
            const pulse = Math.sin(Date.now() * 0.003) * 0.2 + 1;

            let color;
            if (isAssigned) color = '#FFD700';
            else if (isOffline) color = '#b0b0b0';
            else if (driver.status === 'available') color = '#5cb85c';
            else color = '#f0ad4e'; // busy / on a ride

            // Dim offline drivers.
            this.ctx.globalAlpha = isOffline ? 0.5 : 1.0;

            const radius = isAssigned ? 15 : 12;

            // Marker disc.
            this.ctx.fillStyle = color;
            this.ctx.shadowColor = color;
            this.ctx.shadowBlur = (isOffline ? 0 : 12) * pulse;
            this.ctx.beginPath();
            this.ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.shadowBlur = 0;

            // White ring around the marker.
            this.ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();

            // Per-vehicle icon.
            const icon = VEHICLE_ICONS[driver.vehicleType] || '🚗';
            this.ctx.font = isAssigned ? '18px Arial' : '15px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(icon, pos.x, pos.y);

            // Name label (when zoomed in).
            if (this.scale > 0.5) {
                const nameText = driver.name;
                this.ctx.font = isAssigned ? 'bold 12px Arial' : '11px Arial';
                const textWidth = this.ctx.measureText(nameText).width;
                this.ctx.fillStyle = isAssigned ? 'rgba(255,215,0,0.95)'
                    : isOffline ? 'rgba(120,120,120,0.9)'
                    : driver.status === 'available' ? 'rgba(92,184,92,0.95)' : 'rgba(240,173,78,0.95)';
                this.ctx.fillRect(pos.x - textWidth / 2 - 4, pos.y + radius + 4, textWidth + 8, 16);
                this.ctx.fillStyle = 'white';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(nameText, pos.x, pos.y + radius + 12);
            }

            this.ctx.globalAlpha = 1.0;

            // Record hitbox for hover tooltip (slightly larger than the disc).
            this.driverHitboxes.push({ driver, x: pos.x, y: pos.y, r: radius + 6 });
        }
    }

    /**
     * Draw an endpoint marker (pickup = blue "P", destination = red "D").
     */
    _drawEndpoint(nodeId, isPickup) {
        if (nodeId === null || nodeId === undefined) return;
        const node = this.graph.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        const pos = this.latLonToCanvas(node.latitude, node.longitude);
        const color = isPickup ? '#0066ff' : '#ff3366';
        const label = isPickup ? 'P' : 'D';
        const pulse = Math.sin(Date.now() * 0.005) * 3 + 12;

        this.ctx.fillStyle = color;
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 20;
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, pulse, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.shadowBlur = 0;

        this.ctx.fillStyle = '#ffffff';
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = color;
        this.ctx.font = 'bold 14px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(label, pos.x, pos.y);

        if (this.showLabels) {
            this.ctx.fillStyle = color;
            this.ctx.font = 'bold 14px Arial';
            this.ctx.fillText(node.name, pos.x, pos.y - 22);
        }
    }

    // Draw pickup/destination markers for active rides and the form selection.
    drawSelectedLocations() {
        const drawn = new Set();
        const mark = (nodeId, isPickup) => {
            if (nodeId === null || nodeId === undefined) return;
            const key = `${nodeId}-${isPickup ? 'P' : 'D'}`;
            if (drawn.has(key)) return;
            drawn.add(key);
            this._drawEndpoint(nodeId, isPickup);
        };

        for (const ride of this.activeRides) {
            if (TERMINAL_RIDE_STATES.includes(ride.status)) continue;
            mark(ride.pickup, true);
            mark(ride.destination, false);
        }
        mark(this.selectionPickup, true);
        mark(this.selectionDestination, false);
    }
}

