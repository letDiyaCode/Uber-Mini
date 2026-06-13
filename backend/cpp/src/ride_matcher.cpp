#include "include/ride_matcher.h"
#include <sstream>
#include <iomanip>
#include <algorithm>
#include <unordered_map>

namespace RideSharing {

std::string RideMatchResult::toJSON() const {
    std::ostringstream oss;
    oss << std::fixed << std::setprecision(2);

    oss << "{\"success\":" << (success ? "true" : "false");

    if (!success) {
        oss << ",\"errorMessage\":\"" << errorMessage << "\"}";
        return oss.str();
    }

    oss << ",\"assignedDriver\":" << assignedDriver.toJSON()
        << ",\"driverToPickupDistance\":" << driverToPickupDistance
        << ",\"driverToPickupETA\":" << driverToPickupETA
        << ",\"driverToPickupPath\":[";

    for (size_t i = 0; i < driverToPickupPath.size(); ++i) {
        if (i > 0) oss << ",";
        oss << driverToPickupPath[i];
    }

    oss << "],\"pickupToDestinationPath\":[";

    for (size_t i = 0; i < pickupToDestinationPath.size(); ++i) {
        if (i > 0) oss << ",";
        oss << pickupToDestinationPath[i];
    }

    oss << "],\"pickupToDestinationDistance\":" << pickupToDestinationDistance
        << ",\"pickupToDestinationETA\":" << pickupToDestinationETA
        << ",\"totalDistance\":" << totalDistance
        << ",\"totalETA\":" << totalETA
        << ",\"dijkstraLogs\":[";

    for (size_t i = 0; i < dijkstraLogs.size(); ++i) {
        if (i > 0) oss << ",";
        oss << "\"" << dijkstraLogs[i] << "\"";
    }

    oss << "],\"heapLogs\":[";

    for (size_t i = 0; i < heapLogs.size(); ++i) {
        if (i > 0) oss << ",";
        oss << "\"" << heapLogs[i] << "\"";
    }

    oss << "],\"matchingLogs\":[";

    for (size_t i = 0; i < matchingLogs.size(); ++i) {
        if (i > 0) oss << ",";
        oss << "\"" << matchingLogs[i] << "\"";
    }

    oss << "]}";
    return oss.str();
}

std::string DemandStats::toJSON() const {
    std::ostringstream oss;
    oss << "{\"totalRequests\":" << totalRequests
        << ",\"successfulMatches\":" << successfulMatches
        << ",\"failedMatches\":" << failedMatches
        << ",\"avgWaitTime\":" << std::fixed << std::setprecision(2) << avgWaitTime
        << ",\"hotspots\":[";

    for (size_t i = 0; i < hotspots.size(); ++i) {
        if (i > 0) oss << ",";
        oss << hotspots[i];
    }

    oss << "]}";
    return oss.str();
}

RideMatcher::RideMatcher(Graph* g)
    : graph(g), driverManager() {}

void RideMatcher::logOperation(const std::string& operation) {
    systemLogs.push_back(operation);
}

void RideMatcher::addRideRequest(const RideRequest& request) {
    rideRequestQueue.push(request);
    updateSlidingWindow(request);

    std::ostringstream log;
    log << "Added ride request " << request.requestId
        << " (pickup: " << request.pickupLocation
        << ", destination: " << request.destinationLocation << ")";
    logOperation(log.str());
}

NearestDriverResult RideMatcher::findNearestDriver(int pickupLocation) {
    NearestDriverResult result;
    result.found = false;

    std::vector<Driver> availableDrivers = driverManager.getAvailableDrivers();

    if (availableDrivers.empty()) {
        logOperation("No available drivers found");
        return result;
    }

    std::ostringstream log;
    log << "Searching for nearest driver among " << availableDrivers.size()
        << " available drivers using Greedy approach";
    logOperation(log.str());

    // Greedy approach: find driver with minimum distance to pickup
    double minDistance = std::numeric_limits<double>::infinity();
    Driver* nearestDriver = nullptr;
    std::vector<int> bestPath;

    Dijkstra dijkstra(*graph);

    for (Driver& driver : availableDrivers) {
        // Calculate distance from driver to pickup
        PathResult path = dijkstra.findShortestPath(driver.currentLocation, pickupLocation);

        if (path.found && path.totalDistance < minDistance) {
            minDistance = path.totalDistance;
            nearestDriver = &driver;
            bestPath = path.path;

            log.str("");
            log << "  Driver " << driver.id << " at location " << driver.currentLocation
                << " has distance " << std::fixed << std::setprecision(2)
                << minDistance << " km to pickup";
            logOperation(log.str());
        }
    }

    if (nearestDriver != nullptr) {
        result.found = true;
        result.driver = *nearestDriver;
        result.distance = minDistance;
        result.pathToPassenger = bestPath;

        log.str("");
        log << "Selected nearest driver: " << result.driver.id
            << " (distance: " << std::fixed << std::setprecision(2)
            << result.distance << " km)";
        logOperation(log.str());
    } else {
        logOperation("Could not find reachable driver");
    }

    return result;
}

RideMatchResult RideMatcher::processRequest(const RideRequest& request) {
    RideMatchResult result;
    systemLogs.clear();

    std::ostringstream log;
    log << "Processing ride request " << request.requestId;
    logOperation(log.str());

    // Validate pickup and destination
    if (!graph->nodeExists(request.pickupLocation)) {
        result.success = false;
        result.errorMessage = "Invalid pickup location";
        logOperation("Error: Invalid pickup location");
        return result;
    }

    if (!graph->nodeExists(request.destinationLocation)) {
        result.success = false;
        result.errorMessage = "Invalid destination location";
        logOperation("Error: Invalid destination location");
        return result;
    }

    if (request.pickupLocation == request.destinationLocation) {
        result.success = false;
        result.errorMessage = "Pickup and destination cannot be the same";
        logOperation("Error: Pickup and destination are the same");
        return result;
    }

    // Find nearest driver
    NearestDriverResult nearestDriver = findNearestDriver(request.pickupLocation);

    if (!nearestDriver.found) {
        result.success = false;
        result.errorMessage = "No available drivers found";
        logOperation("Error: No available drivers");
        return result;
    }

    // Calculate route from pickup to destination
    Dijkstra dijkstra(*graph);
    PathResult pickupToDestPath = dijkstra.findShortestPath(
        request.pickupLocation, request.destinationLocation);

    if (!pickupToDestPath.found) {
        result.success = false;
        result.errorMessage = "No route found from pickup to destination";
        logOperation("Error: No route from pickup to destination");
        return result;
    }

    // Populate result
    result.success = true;
    result.assignedDriver = nearestDriver.driver;
    result.driverToPickupDistance = nearestDriver.distance;
    result.driverToPickupPath = nearestDriver.pathToPassenger;
    result.driverToPickupETA = Dijkstra::calculateETA(nearestDriver.distance);

    result.pickupToDestinationPath = pickupToDestPath.path;
    result.pickupToDestinationDistance = pickupToDestPath.totalDistance;
    result.pickupToDestinationETA = pickupToDestPath.estimatedTime;

    result.totalDistance = result.driverToPickupDistance + result.pickupToDestinationDistance;
    result.totalETA = result.driverToPickupETA + result.pickupToDestinationETA;

    // Copy logs
    result.matchingLogs = systemLogs;
    result.dijkstraLogs = dijkstra.getLogs();

    // Mark driver as busy
    driverManager.updateDriverAvailability(result.assignedDriver.id, false);

    log.str("");
    log << "Ride matched successfully. Total distance: "
        << std::fixed << std::setprecision(2) << result.totalDistance
        << " km, Total ETA: " << std::setprecision(1) << result.totalETA << " min";
    logOperation(log.str());

    return result;
}

RideMatchResult RideMatcher::processNextRequest() {
    RideMatchResult result;

    if (rideRequestQueue.empty()) {
        result.success = false;
        result.errorMessage = "No pending ride requests";
        return result;
    }

    RideRequest request = rideRequestQueue.front();
    rideRequestQueue.pop();

    return processRequest(request);
}

void RideMatcher::updateSlidingWindow(const RideRequest& request) {
    recentRequests.push_back(request);

    // Maintain sliding window size
    while (recentRequests.size() > SLIDING_WINDOW_SIZE) {
        recentRequests.pop_front();
    }
}

DemandStats RideMatcher::analyzeDemand() const {
    DemandStats stats;
    stats.totalRequests = recentRequests.size();

    if (recentRequests.empty()) {
        return stats;
    }

    // Count frequency of pickup locations (hotspots)
    std::unordered_map<int, int> locationFrequency;

    for (const auto& request : recentRequests) {
        locationFrequency[request.pickupLocation]++;
    }

    // Find top 3 hotspots
    std::vector<std::pair<int, int>> sortedLocations(
        locationFrequency.begin(), locationFrequency.end());

    std::sort(sortedLocations.begin(), sortedLocations.end(),
              [](const std::pair<int, int>& a, const std::pair<int, int>& b) {
                  return a.second > b.second;
              });

    for (size_t i = 0; i < std::min(size_t(3), sortedLocations.size()); ++i) {
        stats.hotspots.push_back(sortedLocations[i].first);
    }

    return stats;
}

// Node.js-friendly methods
void RideMatcher::addDriver(const Driver& driver) {
    driverManager.addDriver(driver);
}

Driver RideMatcher::getDriver(const std::string& driverId) const {
    Driver* driver = const_cast<DriverManager&>(driverManager).getDriver(driverId);
    if (driver) {
        return *driver;
    }
    return Driver();  // Return empty driver if not found
}

std::vector<Driver> RideMatcher::getAllDrivers() const {
    return driverManager.getAllDrivers();
}

void RideMatcher::updateDriverLocation(const std::string& driverId, int newLocation) {
    driverManager.updateDriverLocation(driverId, newLocation);
}

void RideMatcher::setDriverAvailability(const std::string& driverId, bool isAvailable) {
    driverManager.updateDriverAvailability(driverId, isAvailable);
}

PathInfo RideMatcher::computePath(int source, int destination) {
    PathInfo info;

    if (!graph->nodeExists(source) || !graph->nodeExists(destination)) {
        return info;
    }

    Dijkstra dijkstra(*graph);
    PathResult result = dijkstra.findShortestPath(source, destination);

    info.found = result.found;
    info.distance = result.totalDistance;
    info.eta = result.estimatedTime;
    info.path = result.path;
    return info;
}

RideMatch RideMatcher::findRide(const RideRequest& request) {
    RideMatch match;

    // Find nearest available driver
    NearestDriverResult nearestDriver = findNearestDriver(request.pickupLocation);

    if (!nearestDriver.found) {
        match.success = false;
        match.message = "No available drivers found";
        return match;
    }

    // Calculate route from driver to pickup
    Dijkstra dijkstra(*graph);
    PathResult driverToPickup = dijkstra.findShortestPath(
        nearestDriver.driver.currentLocation,
        request.pickupLocation
    );

    // Calculate route from pickup to destination
    PathResult pickupToDestination = dijkstra.findShortestPath(
        request.pickupLocation,
        request.destinationLocation
    );

    if (!driverToPickup.found || !pickupToDestination.found) {
        match.success = false;
        match.message = "No valid path found";
        return match;
    }

    // Fill match result
    match.success = true;
    match.message = "Ride matched successfully";
    match.driver = nearestDriver.driver;
    match.distanceToPickup = driverToPickup.totalDistance;
    match.distanceToDestination = pickupToDestination.totalDistance;
    match.totalDistance = driverToPickup.totalDistance + pickupToDestination.totalDistance;
    match.estimatedTime = static_cast<int>((match.totalDistance / 40.0) * 60); // 40 km/h avg speed
    match.pathToPickup = driverToPickup.path;
    match.pathToDestination = pickupToDestination.path;

    // Update driver availability
    driverManager.updateDriverAvailability(nearestDriver.driver.id, false);

    return match;
}

} // namespace RideSharing
