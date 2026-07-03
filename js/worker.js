/**
 * SmartCity Traffic Simulator - Worker Script (js/worker.js)
 * Executes heavy computations (Parallel Floyd-Warshall and Parallel Vehicle Updates) in background threads.
 */

const MAX_VERTICES = 1000;
const MAX_VEHICLES = 10000;

// Shared state references (initialized via 'INIT' message)
let workerId = -1;
let numWorkers = -1;

let weights = null;       // Float32Array (V_max * V_max)
let blocked = null;       // Int32Array (V_max * V_max)
let coords = null;        // Float32Array (V_max * 2)
let activeNodes = null;   // Uint8Array (V_max)

let fwDistance = null;    // Float32Array (V_max * V_max)
let fwNext = null;        // Int32Array (V_max * V_max)

let vehicleInts = null;   // Int32Array (N_max * 8)
let vehicleFloats = null; // Float32Array (N_max * 8)
let vehiclePaths = null;  // Int32Array (N_max * 100)

let sync = null;          // Int32Array (64)
// Sync indices:
// 0: current V (for FW loop size)
// 1: barrier count (completed workers)
// 2: barrier phase (toggle flag)
// 3: atomic lock for intersection queues / capacities (or array starting at index 10)

/**
 * Thread Barrier Synchronization using Atomics.
 */
function barrier() {
  const currentPhase = Atomics.load(sync, 2);
  const completed = Atomics.add(sync, 1, 1) + 1;
  
  if (completed === numWorkers) {
    // Last worker resets completed count, increments phase, and wakes up others
    Atomics.store(sync, 1, 0);
    Atomics.add(sync, 2, 1);
    Atomics.notify(sync, 2);
  } else {
    // Wait until the phase changes
    while (Atomics.load(sync, 2) === currentPhase) {
      const res = Atomics.wait(sync, 2, currentPhase);
      if (res === 'not-equal') break;
    }
  }
}

self.onmessage = function (e) {
  const { type, data } = e.data;

  switch (type) {
    case "INIT":
      workerId = data.workerId;
      numWorkers = data.numWorkers;
      
      // Initialize shared typed arrays
      weights = new Float32Array(data.buffers.weights);
      blocked = new Int32Array(data.buffers.blocked);
      coords = new Float32Array(data.buffers.coords);
      activeNodes = new Uint8Array(data.buffers.activeNodes);
      
      fwDistance = new Float32Array(data.buffers.fwDistance);
      fwNext = new Int32Array(data.buffers.fwNext);
      
      vehicleInts = new Int32Array(data.buffers.vehicleInts);
      vehicleFloats = new Float32Array(data.buffers.vehicleFloats);
      vehiclePaths = new Int32Array(data.buffers.vehiclePaths);
      
      sync = new Int32Array(data.buffers.sync);

      self.postMessage({ type: "INIT_DONE" });
      break;

    case "RUN_FW":
      const V = data.V;
      Atomics.store(sync, 4 + workerId, 1); // 1 = FW_COMPUTE
      runParallelFW(V);
      Atomics.store(sync, 4 + workerId, 0); // 0 = IDLE
      self.postMessage({ type: "FW_DONE" });
      break;

    case "RUN_VEHICLES":
      const { startIdx, endIdx, tickRate } = data;
      Atomics.store(sync, 4 + workerId, 2); // 2 = VEHICLE_UPDATE
      runParallelVehicles(startIdx, endIdx, tickRate);
      Atomics.store(sync, 4 + workerId, 0); // 0 = IDLE
      self.postMessage({ type: "VEHICLES_DONE" });
      break;

    default:
      console.warn("Unknown message type in worker:", type);
  }
};

/**
 * Parallel Floyd-Warshall implementation with barrier synchronization.
 */
function runParallelFW(V) {
  // 1. Parallel Initialization of matrices
  // Partition vertices (rows) among workers
  const rowsPerWorker = Math.ceil(V / numWorkers);
  const startRow = workerId * rowsPerWorker;
  const endRow = Math.min(V, startRow + rowsPerWorker);

  for (let i = startRow; i < endRow; i++) {
    for (let j = 0; j < V; j++) {
      const idx = i * MAX_VERTICES + j;
      if (i === j) {
        fwDistance[idx] = 0;
        fwNext[idx] = -1;
      } else {
        const isBlocked = blocked[idx] === 1;
        const w = weights[idx];
        if (w !== Infinity && !isBlocked) {
          fwDistance[idx] = w;
          fwNext[idx] = j;
        } else {
          fwDistance[idx] = Infinity;
          fwNext[idx] = -1;
        }
      }
    }
  }

  // Wait for all workers to complete initialization
  barrier();

  // 2. Parallel Floyd-Warshall main loop
  for (let k = 0; k < V; k++) {
    for (let i = startRow; i < endRow; i++) {
      const ikIdx = i * MAX_VERTICES + k;
      const d_ik = fwDistance[ikIdx];

      if (d_ik !== Infinity) {
        for (let j = 0; j < V; j++) {
          const kjIdx = k * MAX_VERTICES + j;
          const d_kj = fwDistance[kjIdx];

          if (d_kj !== Infinity) {
            const ijIdx = i * MAX_VERTICES + j;
            const currentDist = fwDistance[ijIdx];
            const newDist = d_ik + d_kj;

            if (newDist < currentDist) {
              fwDistance[ijIdx] = newDist;
              // Next-hop routing pointer update
              fwNext[ijIdx] = fwNext[ikIdx];
            }
          }
        }
      }
    }
    // Barrier synchronization after each iteration k
    barrier();
  }
}

/**
 * Parallel Vehicle Update logic.
 * Processes vehicles in range [startIdx, endIdx).
 */
function runParallelVehicles(startIdx, endIdx, tickRate) {
  const dt = tickRate / 1000; // time step in seconds

  for (let i = startIdx; i < endIdx; i++) {
    const vOffset = i * 8;
    const vPathOffset = i * 100;

    const id = vehicleInts[vOffset];
    const type = vehicleInts[vOffset + 1];
    let state = vehicleInts[vOffset + 2]; // 0=Finished, 1=Moving, 2=Waiting, 3=Stuck
    const origin = vehicleInts[vOffset + 3];
    const destination = vehicleInts[vOffset + 4];
    let currentPathIndex = vehicleInts[vOffset + 5];
    const pathLength = vehicleInts[vOffset + 6];

    if (state !== 1 && state !== 2 && state !== 3) continue; // Skip inactive/finished

    let progress = vehicleFloats[vOffset];
    const speed = vehicleFloats[vOffset + 1];
    let travelTime = vehicleFloats[vOffset + 2];
    let delayCounter = vehicleFloats[vOffset + 7];

    travelTime += dt;

    if (state === 2) {
      // Waiting status - waiting at intersection or queue
      delayCounter -= dt;
      if (delayCounter <= 0) {
        delayCounter = 0;
        state = 1; // Try moving again
      }
    }

    if (state === 1) {
      // Moving along the edge
      const u = vehiclePaths[vPathOffset + currentPathIndex];
      const v = vehiclePaths[vPathOffset + currentPathIndex + 1];

      // Retrieve actual weight/distance of edge
      const w = weights[u * MAX_VERTICES + v];
      const isBlocked = blocked[u * MAX_VERTICES + v] === 1;

      if (isBlocked) {
        // Dynamic Rerouting needed!
        // We recalculate route from node 'u' to destination
        const newPath = reconstructPath(u, destination);
        if (newPath.length > 1) {
          // Re-write path to vehicle path array
          vehicleInts[vOffset + 6] = newPath.length; // pathLength
          vehicleInts[vOffset + 5] = 0; // Reset index to 0
          currentPathIndex = 0;
          for (let pIdx = 0; pIdx < newPath.length; pIdx++) {
            vehiclePaths[vPathOffset + pIdx] = newPath[pIdx];
          }
          // Reset progress on the new edge
          progress = 0;
        } else {
          // No route exists! Vehicle is stuck
          state = 3; // Stuck
        }
      }

      if (state === 1) {
        // Progress vehicle along the road segment
        progress += (speed * dt) / w;

        if (progress >= 1.0) {
          // Vehicle arrived at node 'v'
          progress = 1.0;
          
          if (v === destination) {
            // Reached destination!
            state = 0; // Finished
            progress = 1.0;
          } else {
            // Need to cross intersection to next road
            const nextNodeInPath = vehiclePaths[vPathOffset + currentPathIndex + 2];
            
            // Intersection coordination lock: Check intersection slot
            // To ensure thread safety and capacity constraints, we use atomic operations.
            // Node index 'v' represents the intersection. We lock this intersection using Atomics.
            const lockIndex = 10 + v; // offset by 10 in sync buffer
            
            // Try to acquire lock for intersection: Atomics.compareExchange returns the old value
            // 0 means unlocked, 1 means locked.
            const currentLockVal = Atomics.compareExchange(sync, lockIndex, 0, 1);
            
            if (currentLockVal === 0) {
              // Successfully acquired intersection slot!
              // Advance path index
              currentPathIndex += 1;
              vehicleInts[vOffset + 5] = currentPathIndex;
              progress = 0; // Start new segment
              
              // Simulate intersection crossing delay (e.g. wait for 0.5s)
              state = 2; // Waiting
              delayCounter = 0.5; // seconds delay
              
              // Release lock immediately since state is updated and vehicle entered the next edge
              Atomics.store(sync, lockIndex, 0);
            } else {
              // Intersection is busy, vehicle must wait (Stuck / Waiting)
              // Wait for 0.2 seconds and retry
              state = 2; // Waiting
              delayCounter = 0.2;
            }
          }
        }

        // Interpolate coordinates for main thread rendering
        const nextU = vehiclePaths[vPathOffset + currentPathIndex];
        const nextV = vehiclePaths[vPathOffset + currentPathIndex + 1];
        
        const ux = coords[nextU * 2];
        const uy = coords[nextU * 2 + 1];
        const vx = coords[nextV * 2];
        const vy = coords[nextV * 2 + 1];

        const x = ux + (vx - ux) * progress;
        const y = uy + (vy - uy) * progress;

        vehicleFloats[vOffset + 3] = x;
        vehicleFloats[vOffset + 4] = y;
        vehicleFloats[vOffset + 5] = vx;
        vehicleFloats[vOffset + 6] = vy;
      }
    }

    // Write updated states back
    vehicleInts[vOffset + 2] = state;
    vehicleFloats[vOffset] = progress;
    vehicleFloats[vOffset + 2] = travelTime;
    vehicleFloats[vOffset + 7] = delayCounter;
  }
}

/**
 * Reconstruct route using precalculated next-hop matrix (fwNext)
 */
function reconstructPath(start, end) {
  if (fwNext[start * MAX_VERTICES + end] === -1) return [];
  const path = [start];
  let curr = start;
  while (curr !== end) {
    curr = fwNext[curr * MAX_VERTICES + end];
    if (curr === -1) return []; // Broken
    path.push(curr);
    if (path.length > MAX_VERTICES) return []; // Loop protection
  }
  return path;
}
