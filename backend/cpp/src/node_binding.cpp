#include <napi.h>
#include "include/graph.h"
#include "include/dijkstra.h"
#include "include/min_heap.h"
#include "include/driver_manager.h"
#include "include/ride_matcher.h"
#include "include/city_graph_generator.h"
#include <sstream>

using namespace RideSharing;

// Graph wrapper class for Node.js
class GraphWrapper : public Napi::ObjectWrap<GraphWrapper> {
public:
    static Napi::FunctionReference* constructor;

    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "Graph", {
            InstanceMethod("addNode", &GraphWrapper::AddNode),
            InstanceMethod("addEdge", &GraphWrapper::AddEdge),
            InstanceMethod("getNode", &GraphWrapper::GetNode),
            InstanceMethod("getAdjacentNodes", &GraphWrapper::GetAdjacentNodes),
            InstanceMethod("getAllNodes", &GraphWrapper::GetAllNodes),
            InstanceMethod("getNumVertices", &GraphWrapper::GetNumVertices)
        });

        constructor = new Napi::FunctionReference();
        *constructor = Napi::Persistent(func);

        exports.Set("Graph", func);
        return exports;
    }

    GraphWrapper(const Napi::CallbackInfo& info) : Napi::ObjectWrap<GraphWrapper>(info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsNumber()) {
            Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
            return;
        }

        int numVertices = info[0].As<Napi::Number>().Int32Value();
        graph_ = new Graph(numVertices);
    }

    ~GraphWrapper() {
        delete graph_;
    }

private:
    Graph* graph_;

    Napi::Value AddNode(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 4) {
            Napi::TypeError::New(env, "Expected 4 arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        int id = info[0].As<Napi::Number>().Int32Value();
        std::string name = info[1].As<Napi::String>().Utf8Value();
        double latitude = info[2].As<Napi::Number>().DoubleValue();
        double longitude = info[3].As<Napi::Number>().DoubleValue();

        graph_->addNode(id, name, latitude, longitude);
        return env.Undefined();
    }

    Napi::Value AddEdge(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 3) {
            Napi::TypeError::New(env, "Expected at least 3 arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        int src = info[0].As<Napi::Number>().Int32Value();
        int dest = info[1].As<Napi::Number>().Int32Value();
        double weight = info[2].As<Napi::Number>().DoubleValue();
        std::string roadName = info.Length() > 3 ? info[3].As<Napi::String>().Utf8Value() : "";

        graph_->addEdge(src, dest, weight, roadName);
        return env.Undefined();
    }

    Napi::Value GetNode(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsNumber()) {
            Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
            return env.Null();
        }

        int id = info[0].As<Napi::Number>().Int32Value();
        Node node = graph_->getNode(id);

        Napi::Object obj = Napi::Object::New(env);
        obj.Set("id", Napi::Number::New(env, node.id));
        obj.Set("name", Napi::String::New(env, node.name));
        obj.Set("latitude", Napi::Number::New(env, node.latitude));
        obj.Set("longitude", Napi::Number::New(env, node.longitude));

        return obj;
    }

    Napi::Value GetAdjacentNodes(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsNumber()) {
            Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
            return env.Null();
        }

        int nodeId = info[0].As<Napi::Number>().Int32Value();
        std::vector<Edge> edges = graph_->getAdjacentNodes(nodeId);

        Napi::Array arr = Napi::Array::New(env, edges.size());
        for (size_t i = 0; i < edges.size(); i++) {
            Napi::Object obj = Napi::Object::New(env);
            obj.Set("destination", Napi::Number::New(env, edges[i].destination));
            obj.Set("weight", Napi::Number::New(env, edges[i].weight));
            obj.Set("roadName", Napi::String::New(env, edges[i].roadName));
            arr[i] = obj;
        }

        return arr;
    }

    Napi::Value GetAllNodes(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        const std::unordered_map<int, Node>& nodesMap = graph_->getAllNodes();
        Napi::Array arr = Napi::Array::New(env, nodesMap.size());

        size_t index = 0;
        for (const auto& pair : nodesMap) {
            Napi::Object obj = Napi::Object::New(env);
            obj.Set("id", Napi::Number::New(env, pair.second.id));
            obj.Set("name", Napi::String::New(env, pair.second.name));
            obj.Set("latitude", Napi::Number::New(env, pair.second.latitude));
            obj.Set("longitude", Napi::Number::New(env, pair.second.longitude));
            arr[index++] = obj;
        }

        return arr;
    }

    Napi::Value GetNumVertices(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        return Napi::Number::New(env, graph_->getNumVertices());
    }

    Graph* getGraph() { return graph_; }

    friend class RideMatcherWrapper;
    friend Napi::Object GenerateCityGraph(const Napi::CallbackInfo& info);
};

// Static member initialization
Napi::FunctionReference* GraphWrapper::constructor = nullptr;

// RideMatcher wrapper class for Node.js
class RideMatcherWrapper : public Napi::ObjectWrap<RideMatcherWrapper> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "RideMatcher", {
            InstanceMethod("addDriver", &RideMatcherWrapper::AddDriver),
            InstanceMethod("getDriver", &RideMatcherWrapper::GetDriver),
            InstanceMethod("getAllDrivers", &RideMatcherWrapper::GetAllDrivers),
            InstanceMethod("findRide", &RideMatcherWrapper::FindRide),
            InstanceMethod("computePath", &RideMatcherWrapper::ComputePath),
            InstanceMethod("updateDriverLocation", &RideMatcherWrapper::UpdateDriverLocation),
            InstanceMethod("setDriverAvailability", &RideMatcherWrapper::SetDriverAvailability)
        });

        Napi::FunctionReference* constructor = new Napi::FunctionReference();
        *constructor = Napi::Persistent(func);
        env.SetInstanceData(constructor);

        exports.Set("RideMatcher", func);
        return exports;
    }

    RideMatcherWrapper(const Napi::CallbackInfo& info) : Napi::ObjectWrap<RideMatcherWrapper>(info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1) {
            Napi::TypeError::New(env, "Graph expected").ThrowAsJavaScriptException();
            return;
        }

        GraphWrapper* graphWrapper = Napi::ObjectWrap<GraphWrapper>::Unwrap(info[0].As<Napi::Object>());
        matcher_ = new RideMatcher(graphWrapper->getGraph());
    }

    ~RideMatcherWrapper() {
        delete matcher_;
    }

private:
    RideMatcher* matcher_;

    Napi::Value AddDriver(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsObject()) {
            Napi::TypeError::New(env, "Driver object expected").ThrowAsJavaScriptException();
            return env.Null();
        }

        Napi::Object driverObj = info[0].As<Napi::Object>();

        Driver driver;
        driver.id = driverObj.Get("id").As<Napi::String>().Utf8Value();
        driver.name = driverObj.Get("name").As<Napi::String>().Utf8Value();
        driver.currentLocation = driverObj.Get("currentLocation").As<Napi::Number>().Int32Value();
        driver.isAvailable = driverObj.Get("isAvailable").As<Napi::Boolean>().Value();
        driver.vehicleType = driverObj.Get("vehicleType").As<Napi::String>().Utf8Value();
        driver.rating = driverObj.Get("rating").As<Napi::Number>().DoubleValue();
        driver.completedRides = driverObj.Get("completedRides").As<Napi::Number>().Int32Value();

        matcher_->addDriver(driver);
        return env.Undefined();
    }

    Napi::Value GetDriver(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "Driver ID expected").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string driverId = info[0].As<Napi::String>().Utf8Value();
        Driver driver = matcher_->getDriver(driverId);

        Napi::Object obj = Napi::Object::New(env);
        obj.Set("id", Napi::String::New(env, driver.id));
        obj.Set("name", Napi::String::New(env, driver.name));
        obj.Set("currentLocation", Napi::Number::New(env, driver.currentLocation));
        obj.Set("isAvailable", Napi::Boolean::New(env, driver.isAvailable));
        obj.Set("vehicleType", Napi::String::New(env, driver.vehicleType));
        obj.Set("rating", Napi::Number::New(env, driver.rating));
        obj.Set("completedRides", Napi::Number::New(env, driver.completedRides));

        return obj;
    }

    Napi::Value GetAllDrivers(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        std::vector<Driver> drivers = matcher_->getAllDrivers();
        Napi::Array arr = Napi::Array::New(env, drivers.size());

        for (size_t i = 0; i < drivers.size(); i++) {
            Napi::Object obj = Napi::Object::New(env);
            obj.Set("id", Napi::String::New(env, drivers[i].id));
            obj.Set("name", Napi::String::New(env, drivers[i].name));
            obj.Set("currentLocation", Napi::Number::New(env, drivers[i].currentLocation));
            obj.Set("isAvailable", Napi::Boolean::New(env, drivers[i].isAvailable));
            obj.Set("vehicleType", Napi::String::New(env, drivers[i].vehicleType));
            obj.Set("rating", Napi::Number::New(env, drivers[i].rating));
            obj.Set("completedRides", Napi::Number::New(env, drivers[i].completedRides));
            arr[i] = obj;
        }

        return arr;
    }

    Napi::Value FindRide(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 3) {
            Napi::TypeError::New(env, "Expected 3 arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string passengerId = info[0].As<Napi::String>().Utf8Value();
        int pickup = info[1].As<Napi::Number>().Int32Value();
        int destination = info[2].As<Napi::Number>().Int32Value();

        RideRequest request("", pickup, destination, passengerId);

        RideMatch match = matcher_->findRide(request);

        Napi::Object obj = Napi::Object::New(env);
        obj.Set("success", Napi::Boolean::New(env, match.success));
        obj.Set("message", Napi::String::New(env, match.message));

        if (match.success) {
            Napi::Object driverObj = Napi::Object::New(env);
            driverObj.Set("id", Napi::String::New(env, match.driver.id));
            driverObj.Set("name", Napi::String::New(env, match.driver.name));
            driverObj.Set("currentLocation", Napi::Number::New(env, match.driver.currentLocation));
            driverObj.Set("isAvailable", Napi::Boolean::New(env, match.driver.isAvailable));
            driverObj.Set("vehicleType", Napi::String::New(env, match.driver.vehicleType));
            driverObj.Set("rating", Napi::Number::New(env, match.driver.rating));
            driverObj.Set("completedRides", Napi::Number::New(env, match.driver.completedRides));
            obj.Set("driver", driverObj);

            obj.Set("distanceToPickup", Napi::Number::New(env, match.distanceToPickup));
            obj.Set("distanceToDestination", Napi::Number::New(env, match.distanceToDestination));
            obj.Set("totalDistance", Napi::Number::New(env, match.totalDistance));
            obj.Set("estimatedTime", Napi::Number::New(env, match.estimatedTime));

            Napi::Array pathToPickup = Napi::Array::New(env, match.pathToPickup.size());
            for (size_t i = 0; i < match.pathToPickup.size(); i++) {
                pathToPickup[i] = Napi::Number::New(env, match.pathToPickup[i]);
            }
            obj.Set("pathToPickup", pathToPickup);

            Napi::Array pathToDestination = Napi::Array::New(env, match.pathToDestination.size());
            for (size_t i = 0; i < match.pathToDestination.size(); i++) {
                pathToDestination[i] = Napi::Number::New(env, match.pathToDestination[i]);
            }
            obj.Set("pathToDestination", pathToDestination);
        }

        return obj;
    }

    Napi::Value UpdateDriverLocation(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 2) {
            Napi::TypeError::New(env, "Expected 2 arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string driverId = info[0].As<Napi::String>().Utf8Value();
        int newLocation = info[1].As<Napi::Number>().Int32Value();

        matcher_->updateDriverLocation(driverId, newLocation);
        return env.Undefined();
    }

    Napi::Value ComputePath(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 2) {
            Napi::TypeError::New(env, "Expected 2 arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        int source = info[0].As<Napi::Number>().Int32Value();
        int destination = info[1].As<Napi::Number>().Int32Value();

        PathInfo result = matcher_->computePath(source, destination);

        Napi::Object obj = Napi::Object::New(env);
        obj.Set("found", Napi::Boolean::New(env, result.found));
        obj.Set("distance", Napi::Number::New(env, result.distance));
        obj.Set("eta", Napi::Number::New(env, result.eta));

        Napi::Array path = Napi::Array::New(env, result.path.size());
        for (size_t i = 0; i < result.path.size(); i++) {
            path[i] = Napi::Number::New(env, result.path[i]);
        }
        obj.Set("path", path);

        return obj;
    }

    Napi::Value SetDriverAvailability(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 2) {
            Napi::TypeError::New(env, "Expected 2 arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string driverId = info[0].As<Napi::String>().Utf8Value();
        bool isAvailable = info[1].As<Napi::Boolean>().Value();

        matcher_->setDriverAvailability(driverId, isAvailable);
        return env.Undefined();
    }
};

// Function to generate city graph and demo data
Napi::Object GenerateCityGraph(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    int numNodes = 50;
    if (info.Length() > 0 && info[0].IsNumber()) {
        numNodes = info[0].As<Napi::Number>().Int32Value();
    }

    CityData* cityData = CityGraphGenerator::generateCityGraph(numNodes);

    Napi::Object result = Napi::Object::New(env);

    // Wrap the graph
    Napi::Object graphObj = GraphWrapper::constructor->New({Napi::Number::New(env, numNodes)});
    GraphWrapper* graphWrapper = Napi::ObjectWrap<GraphWrapper>::Unwrap(graphObj);
    delete graphWrapper->graph_;
    graphWrapper->graph_ = cityData->graph;

    result.Set("graph", graphObj);

    // Create drivers array
    Napi::Array driversArray = Napi::Array::New(env, cityData->drivers.size());
    for (size_t i = 0; i < cityData->drivers.size(); i++) {
        Napi::Object driverObj = Napi::Object::New(env);
        driverObj.Set("id", Napi::String::New(env, cityData->drivers[i].id));
        driverObj.Set("name", Napi::String::New(env, cityData->drivers[i].name));
        driverObj.Set("currentLocation", Napi::Number::New(env, cityData->drivers[i].currentLocation));
        driverObj.Set("isAvailable", Napi::Boolean::New(env, cityData->drivers[i].isAvailable));
        driverObj.Set("vehicleType", Napi::String::New(env, cityData->drivers[i].vehicleType));
        driverObj.Set("rating", Napi::Number::New(env, cityData->drivers[i].rating));
        driverObj.Set("completedRides", Napi::Number::New(env, cityData->drivers[i].completedRides));
        driversArray[i] = driverObj;
    }
    result.Set("drivers", driversArray);

    // Don't delete cityData->graph as it's now owned by graphWrapper
    cityData->graph = nullptr;
    delete cityData;

    return result;
}

// Initialize the addon
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    GraphWrapper::Init(env, exports);
    RideMatcherWrapper::Init(env, exports);

    exports.Set("generateCityGraph", Napi::Function::New(env, GenerateCityGraph));

    return exports;
}

NODE_API_MODULE(uber_mini_native, Init)
