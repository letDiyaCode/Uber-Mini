class LiveConnection {
    constructor() {
        this.socket = null;
        this.handlers = {
            init: [],
            drivers: [],
            ride: [],
            stats: [],
            status: [],
        };
    }

    on(event, fn) {
        if (this.handlers[event]) this.handlers[event].push(fn);
        return this;
    }

    _emit(event, payload) {
        (this.handlers[event] || []).forEach((fn) => fn(payload));
    }

    connect() {
        this.socket = io();

        this.socket.on('connect', () => this._emit('status', { connected: true }));
        this.socket.on('disconnect', () => this._emit('status', { connected: false }));

        this.socket.on('state:init', (snapshot) => this._emit('init', snapshot));
        this.socket.on('drivers:update', (drivers) => this._emit('drivers', drivers));
        this.socket.on('ride:update', (ride) => this._emit('ride', ride));
        this.socket.on('stats:update', (stats) => this._emit('stats', stats));
    }

    claim(driverId, cb) {
        if (this.socket) this.socket.emit('driver:claim', { driverId }, cb);
    }

    release(driverId) {
        if (this.socket) this.socket.emit('driver:release', { driverId });
    }
}

const live = new LiveConnection();
