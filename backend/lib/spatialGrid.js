const { haversineKm } = require('./geo');

class SpatialGrid {
    constructor(cellSizeDeg = 0.01) {
        this.cellSize = cellSizeDeg;
        this.cells = new Map();
    }

    _key(row, col) {
        return `${row}:${col}`;
    }

    _cellOf(lat, lon) {
        return {
            row: Math.floor(lat / this.cellSize),
            col: Math.floor(lon / this.cellSize),
        };
    }

    clear() {
        this.cells.clear();
    }

    insert(id, lat, lon) {
        const { row, col } = this._cellOf(lat, lon);
        const key = this._key(row, col);
        if (!this.cells.has(key)) {
            this.cells.set(key, []);
        }
        this.cells.get(key).push({ id, lat, lon });
    }

    /**
     * Return up to k nearest points to (lat, lon), sorted by distance.
     */
    nearest(lat, lon, k = 5) {
        const origin = this._cellOf(lat, lon);
        const found = [];
        const maxRings = 64;

        let ring = 0;
        let extraRingDone = false;
        while (ring <= maxRings) {
            for (let dr = -ring; dr <= ring; dr++) {
                for (let dc = -ring; dc <= ring; dc++) {
                    if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
                    const key = this._key(origin.row + dr, origin.col + dc);
                    const bucket = this.cells.get(key);
                    if (!bucket) continue;
                    for (const pt of bucket) {
                        found.push({
                            id: pt.id,
                            lat: pt.lat,
                            lon: pt.lon,
                            distanceKm: haversineKm(lat, lon, pt.lat, pt.lon),
                        });
                    }
                }
            }

            if (found.length >= k) {
                if (extraRingDone) break;
                extraRingDone = true;
            }
            ring++;
        }

        found.sort((a, b) => a.distanceKm - b.distanceKm);
        return found.slice(0, k);
    }
}

module.exports = SpatialGrid;
