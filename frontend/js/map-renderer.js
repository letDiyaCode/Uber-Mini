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
        this.targetScale = 1.0;
        this._zoomRAF = null;
        this._zoomAnchor = null;
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

        // Reserve space on the right (e.g., for an overlay card) when centering.
        this.rightInset = 0;

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

    /** Recompute canvas size from its container and recenter (after show/layout change). */
    resize() {
        const container = this.canvas.parentElement;
        if (!container) return;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        this.centerView();
        this.render();
    }

    /**
     * Setup mouse event listeners for pan functionality
     */
    setupEventListeners() {
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this._dragged = false;
            this._cancelZoom();
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

        // Mouse wheel for smooth zoom toward the cursor
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const delta = Math.max(-50, Math.min(50, e.deltaY));
            const factor = Math.exp(-delta * 0.005);
            this.zoomTo(this.targetScale * factor, e.clientX - rect.left, e.clientY - rect.top);
        }, { passive: false });
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

        // Centre within the area not covered by an overlay on the right.
        const availW = Math.max(100, this.canvas.width - this.rightInset);

        const scaleX = availW / (lonRange * 10000);
        const scaleY = this.canvas.height / (latRange * 10000);

        this.scale = Math.min(scaleX, scaleY) * 0.8;
        this.targetScale = this.scale;

        // Center offset
        this.offsetX = availW / 2;
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
     * Smoothly zoom toward a target scale, anchored at screen point (sx, sy).
     */
    zoomTo(newScale, sx, sy) {
        const clamped = Math.max(0.2, Math.min(3.5, newScale));
        if (sx === undefined) sx = this.canvas.width / 2;
        if (sy === undefined) sy = this.canvas.height / 2;

        // World point currently under the anchor (kept fixed during the zoom).
        const lon = (sx - this.offsetX) / (10000 * this.scale) + this.centerLon;
        const lat = this.centerLat - (sy - this.offsetY) / (10000 * this.scale);
        this._zoomAnchor = { sx, sy, lon, lat };
        this.targetScale = clamped;
        this._animateZoom();
    }

    _cancelZoom() {
        if (this._zoomRAF) {
            cancelAnimationFrame(this._zoomRAF);
            this._zoomRAF = null;
        }
        this.targetScale = this.scale;
    }

    _animateZoom() {
        if (this._zoomRAF) return;
        const step = () => {
            const ds = this.targetScale - this.scale;
            // Ease the scale; snap when close enough.
            if (Math.abs(ds) < 0.002) {
                this.scale = this.targetScale;
            } else {
                this.scale += ds * 0.12;
            }

            // Re-anchor so the chosen point stays under the cursor/center.
            if (this._zoomAnchor) {
                const a = this._zoomAnchor;
                this.offsetX = a.sx - (a.lon - this.centerLon) * 10000 * this.scale;
                this.offsetY = a.sy + (a.lat - this.centerLat) * 10000 * this.scale;
            }
            this.render();

            if (this.scale !== this.targetScale) {
                this._zoomRAF = requestAnimationFrame(step);
            } else {
                this._zoomRAF = null;
                this._zoomAnchor = null;
            }
        };
        this._zoomRAF = requestAnimationFrame(step);
    }

    zoomIn() {
        this.zoomTo(this.targetScale * 1.15);
    }

    zoomOut() {
        this.zoomTo(this.targetScale / 1.15);
    }

    resetView() {
        this._cancelZoom();
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

    // Render the active rides; the moving driver marker provides the live motion.
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

        this.ctx.strokeStyle = 'rgba(30, 41, 90, 0.13)';
        this.ctx.lineWidth = 1.5;

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
                this.ctx.fillStyle = '#5b6480';
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
                this.drawRemainingPath(ride.pickupPath, from, '#3f8d75', 4);
            } else if (ride.status === 'ARRIVED') {
                // Upcoming trip, not yet started — show full route (sky).
                this.drawRemainingPath(ride.tripPath, null, '#38bdf8', 5);
            } else if (ride.status === 'IN_PROGRESS') {
                // Trip in progress (sky), trimmed ahead of the driver.
                this.drawRemainingPath(ride.tripPath, from, '#38bdf8', 5);
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
            this.ctx.fillStyle = '#9aa3c4';
            this.ctx.beginPath();
            this.ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
            this.ctx.fill();

            // Draw node border
            this.ctx.strokeStyle = 'rgba(30, 40, 80, 0.3)';
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();

            // Draw label
            if (this.showLabels && this.scale > 0.5) {
                this.ctx.fillStyle = '#3b4263';
                this.ctx.font = '11px Inter, Arial';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(node.name, pos.x, pos.y - 11);
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
            if (isAssigned) color = '#ffd23f';
            else if (isOffline) color = '#6b6880';
            else if (driver.status === 'available') color = '#3f8d75';
            else color = '#fbbf24'; // busy / on a ride

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

            // Record hitbox for hover tooltip (the visible circle incl. its ring).
            this.driverHitboxes.push({ driver, x: pos.x, y: pos.y, r: radius + 3 });
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
        const color = isPickup ? '#38bdf8' : '#fb7185';
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

