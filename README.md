# 🚗 Uber Mini — Ride Sharing Simulation

A real-time **ride-sharing simulation** with **Rider** and **Driver** modes.

🔗 **Live demo:** [uber-mini.onrender.com](https://uber-mini.onrender.com)

---

## ✨ Features

**Two experiences, one live city**
- **Landing page** to choose your role — Rider or Driver.
- **Rider:** a two-step flow — pick pickup/destination and a ride type, get an upfront fare, then track the trip live on a map.
- **Driver:** choose a driver profile, go online/offline, receive ride requests, and watch live earnings and trips.

**Realistic ride-hailing behavior**
- **50-location city graph** with named places and multiple road types.
- **28 drivers** across **4 vehicle tiers** — Compact, Sedan, SUV, Luxury.
- **Nearest-driver matching** of the requested type, cascading to the next driver and **falling back to other vehicle types** if needed.
- Full **ride lifecycle**: request → matched → arriving → in-progress → completed (plus cancel).
- **Upfront fare** per vehicle tier, **live driver movement** along the route.
- **Real-time updates** over WebSockets — positions, statuses, and stats stream live to every page.

---

## 🛠️ Build Requirements

- **Node.js** (recommended v18)
- **Python** 3.x (for node-gyp)
- **C++ Compiler**

---

## 🚀 Quick Start

```bash
git clone "https://github.com/letDiyaCode/Uber-Mini"   # Clone the repo
cd Uber-Mini
npm install                                            # Installs deps & builds the C++ addon
npm start                                              # Starts the server on port 3000
```

Then open **http://localhost:3000** and pick Rider or Driver.

State is in-memory, so restarting the server resets all rides and drivers.

---

## 📊 Technology Stack

- **Engine:** C++17 native addon (Node.js N-API / node-gyp)
- **Server:** Node.js + Express + Socket.IO (real-time)
- **Frontend:** HTML / CSS / vanilla JavaScript (no framework)

---

## 📁 Project Structure

```
backend/
  cpp/            # C++ engine: graph, dijkstra, min-heap, driver manager, ride matcher
  lib/            # Node logic: ride lifecycle, pricing, spatial grid, geo helpers
  server.js       # Express + Socket.IO server
frontend/
  index.html      # Landing (choose role)
  rider.html      # Rider experience
  driver.html     # Driver experience
  js/, style.css  # Map renderer, controllers, socket client, styling
```
