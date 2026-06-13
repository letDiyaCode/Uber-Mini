/**
 * ride_matcher.h
 *
 * Main Ride Matching System
 * Integrates Graph, Dijkstra, MinHeap, DriverManager, and Queue
 * Implements greedy matching algorithm and sliding window for demand analysis
 *
 * Core DSA Concepts:
 *   - Graph: City map representation
 *   - Dijkstra: Shortest path calculation
 *   - MinHeap: Priority queue for nearest driver
 *   - HashMap: Driver database
 *   - Queue: Ride request queue
 *   - Sliding Window: Demand load analysis
 *   - Greedy: Match nearest available driver
 */

#ifndef RIDE_MATCHER_H
#define RIDE_MATCHER_H

#include "graph.h"
#include "dijkstra.h"
#include "driver_manager.h"
#include <queue>
#include <deque>
#include <string>
#include <vector>
#include <chrono>

namespace RideSharing {

// Ride request structure
struct RideRequest {
    std::string requestId;
    int pickupLocation;
    int destinationLocation;
    std::string passengerId;
    std::chrono::system_clock::time_point timestamp;

    RideRequest(const std::string& reqId, int pickup, int destination,
                const std::string& passId)
        : requestId(reqId), pickupLocation(pickup),
          destinationLocation(destination), passengerId(passId),
          timestamp(std::chrono::system_clock::now()) {}
};

// Complete ride matching result
struct RideMatchResult {
    bool success;
    std::string errorMessage;

    // Driver information
    Driver assignedDriver;
    double driverToPickupDistance;
    std::vector<int> driverToPickupPath;
    double driverToPickupETA;

    // Route information
    std::vector<int> pickupToDestinationPath;
    double pickupToDestinationDistance;
    double pickupToDestinationETA;

    // Total journey
    double totalDistance;
    double totalETA;

    // Logs for visualization
    std::vector<std::string> dijkstraLogs;
    std::vector<std::string> heapLogs;
    std::vector<std::string> matchingLogs;

    RideMatchResult() : success(false), driverToPickupDistance(0.0),
                       driverToPickupETA(0.0), pickupToDestinationDistance(0.0),
                       pickupToDestinationETA(0.0), totalDistance(0.0), totalETA(0.0) {}

    std::string toJSON() const;
};

// Sliding window demand statistics
struct DemandStats {
    int totalRequests;
    int successfulMatches;
    int failedMatches;
    double avgWaitTime;
    std::vector<int> hotspots; // Locations with high demand

    DemandStats() : totalRequests(0), successfulMatches(0),
                    failedMatches(0), avgWaitTime(0.0) {}

    std::string toJSON() const;
};

// Simple ride match structure for Node.js
struct RideMatch {
    bool success;
    std::string message;
    Driver driver;
    double distanceToPickup;
    double distanceToDestination;
    double totalDistance;
    int estimatedTime;
    std::vector<int> pathToPickup;
    std::vector<int> pathToDestination;

    RideMatch() : success(false), distanceToPickup(0.0), distanceToDestination(0.0),
                  totalDistance(0.0), estimatedTime(0) {}
};

// Pure routing result (no side effects on driver state)
struct PathInfo {
    bool found;
    double distance;   // kilometers
    double eta;        // minutes
    std::vector<int> path;

    PathInfo() : found(false), distance(0.0), eta(0.0) {}
};

class RideMatcher {
private:
    Graph* graph;
    DriverManager driverManager;
    std::queue<RideRequest> rideRequestQueue;
    std::deque<RideRequest> recentRequests; // For sliding window analysis

    const int SLIDING_WINDOW_SIZE = 20; // Number of recent requests to track
    std::vector<std::string> systemLogs;

    void logOperation(const std::string& operation);

    // Find nearest available driver using greedy approach
    NearestDriverResult findNearestDriver(int pickupLocation);

    // Update sliding window with new request
    void updateSlidingWindow(const RideRequest& request);

public:
    RideMatcher(Graph* g);

    // Node.js-friendly methods
    void addDriver(const Driver& driver);
    Driver getDriver(const std::string& driverId) const;
    std::vector<Driver> getAllDrivers() const;
    RideMatch findRide(const RideRequest& request);
    void updateDriverLocation(const std::string& driverId, int newLocation);
    void setDriverAvailability(const std::string& driverId, bool isAvailable);

    // Pure shortest-path query between two nodes (no side effects)
    PathInfo computePath(int source, int destination);

    // Add ride request to queue
    void addRideRequest(const RideRequest& request);

    // Process next ride request from queue
    RideMatchResult processNextRequest();

    // Process specific ride request (bypass queue)
    RideMatchResult processRequest(const RideRequest& request);

    // Get current queue size
    int getQueueSize() const { return rideRequestQueue.size(); }

    // Analyze demand using sliding window
    DemandStats analyzeDemand() const;

    // Get system logs
    std::vector<std::string> getLogs() const { return systemLogs; }

    // Clear logs
    void clearLogs() { systemLogs.clear(); }
};

} // namespace RideSharing

#endif // RIDE_MATCHER_H
