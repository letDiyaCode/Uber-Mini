const CURRENCY = '₹';
const BOOKING_FEE = 10;

const VEHICLE_TIERS = {
    Compact: { baseFare: 25, perKm: 8,  perMin: 1.0, minFare: 45 },
    Sedan:   { baseFare: 35, perKm: 11, perMin: 1.2, minFare: 60 },
    SUV:     { baseFare: 50, perKm: 15, perMin: 1.5, minFare: 90 },
    Luxury:  { baseFare: 80, perKm: 22, perMin: 2.0, minFare: 150 },
};

const SURGE_MIN = 1.0;
const SURGE_MAX = 3.0;

function round2(n) {
    return Math.round(n * 100) / 100;
}

function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}

function tierFor(vehicleType) {
    return VEHICLE_TIERS[vehicleType] || VEHICLE_TIERS.Sedan;
}

/**
 * Estimate the fare for a trip.
 */
function estimateFare(distanceKm, durationMin, vehicleType, surge = 1.0) {
    const tier = tierFor(vehicleType);
    const subtotal = tier.baseFare + tier.perKm * distanceKm + tier.perMin * durationMin;
    const surged = subtotal * surge;
    const total = Math.max(surged, tier.minFare) + BOOKING_FEE;

    return {
        currency: CURRENCY,
        vehicleType,
        distanceKm: round2(distanceKm),
        durationMin: round2(durationMin),
        baseFare: tier.baseFare,
        perKm: tier.perKm,
        perMin: tier.perMin,
        bookingFee: BOOKING_FEE,
        surge: round2(surge),
        subtotal: round2(surged),
        total: round2(total),
    };
}

/**
 * Compute a dynamic surge multiplier from demand and supply.
 */
function computeSurge({ activeDemand, availableSupply, hotspotBoost = 0 }) {
    if (availableSupply <= 0) {
        return SURGE_MAX;
    }
    const ratio = activeDemand / availableSupply;
    let surge = 1.0 + 0.6 * Math.max(0, ratio - 1) + hotspotBoost;
    surge = clamp(surge, SURGE_MIN, SURGE_MAX);
    return Math.round(surge * 10) / 10;
}

module.exports = {
    estimateFare,
    computeSurge,
    tierFor,
    VEHICLE_TIERS,
    CURRENCY,
    SURGE_MIN,
    SURGE_MAX,
};
