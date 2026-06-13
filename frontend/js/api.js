const API_BASE_URL = `${window.location.origin}/api`;

class ApiClient {
    async _request(method, endpoint, body) {
        const opts = { method, headers: { 'Content-Type': 'application/json' } };
        if (body !== undefined) opts.body = JSON.stringify(body);
        const response = await fetch(`${API_BASE_URL}${endpoint}`, opts);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Request failed');
        }
        return data;
    }

    get(endpoint) { return this._request('GET', endpoint); }
    post(endpoint, body) { return this._request('POST', endpoint, body); }
    put(endpoint, body) { return this._request('PUT', endpoint, body); }

    getHealth() { return this.get('/health'); }
    getGraph() { return this.get('/graph'); }
    getDrivers() { return this.get('/drivers'); }
    getVehicleTiers() { return this.get('/vehicle-tiers'); }

    estimate(pickup, destination, vehicleType) {
        return this.post('/rides/estimate', { pickup, destination, vehicleType });
    }

    requestRide(pickup, destination, vehicleType, passengerId = 'GUEST') {
        return this.post('/rides', { pickup, destination, vehicleType, passengerId });
    }

    getRide(rideId) { return this.get(`/rides/${rideId}`); }
    cancelRide(rideId) { return this.post(`/rides/${rideId}/cancel`, { by: 'rider' }); }
    acceptOffer(rideId, driverId) { return this.post(`/rides/${rideId}/accept`, { driverId }); }
    declineOffer(rideId, driverId) { return this.post(`/rides/${rideId}/decline`, { driverId }); }

    setDriverOnline(driverId, online) {
        return this.put(`/drivers/${driverId}/online`, { online });
    }

    resetSystem() { return this.post('/system/reset', {}); }
}

const apiClient = new ApiClient();
