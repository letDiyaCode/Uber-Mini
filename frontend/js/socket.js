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
        // io() is provided by /socket.io/socket.io.js served by the backend.
        this.socket = io();

        this.socket.on('connect', () => this._emit('status', { connected: true }));
        this.socket.on('disconnect', () => this._emit('status', { connected: false }));

        this.socket.on('state:init', (snapshot) => this._emit('init', snapshot));
        this.socket.on('drivers:update', (drivers) => this._emit('drivers', drivers));
        this.socket.on('ride:update', (ride) => this._emit('ride', ride));
        this.socket.on('stats:update', (stats) => this._emit('stats', stats));
    }
}

const live = new LiveConnection();
