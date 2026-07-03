/**
 * SmartCity Traffic Simulator - Simulation Engine (js/simulation.js)
 * Manages simulation ticks, sequential/parallel algorithm execution, and performance measurements.
 */

import { MAX_VERTICES, CityGraph } from './graph.js';
import { WorkerPool } from './worker-pool.js';

export const MAX_VEHICLES = 10000;

export class Simulation {
  constructor() {
    this.state = "stopped";   // running, paused, stopped
    this.mode = "sequential"; // sequential, parallel
    this.tickCount = 0;
    this.tickRate = 50;       // millisecond tick rate (default 20 FPS / 50ms)
    this.numThreads = 4;
    
    // Performance metrics
    this.metrics = {
      fwSequentialTime: 0,
      fwParallelTime: 0,
      updateSequentialTime: 0,
      updateParallelTime: 0,
      throughput: 0,
      totalFinished: 0
    };

    // Pre-allocated SharedArrayBuffers (Thread-safe memory layout)
    this.buffers = {
      weights: new SharedArrayBuffer(MAX_VERTICES * MAX_VERTICES * 4), // Float32
      blocked: new SharedArrayBuffer(MAX_VERTICES * MAX_VERTICES * 4), // Int32
      coords: new SharedArrayBuffer(MAX_VERTICES * 2 * 4),            // Float32
      activeNodes: new SharedArrayBuffer(MAX_VERTICES * 1),           // Uint8
      fwDistance: new SharedArrayBuffer(MAX_VERTICES * MAX_VERTICES * 4), // Float32
      fwNext: new SharedArrayBuffer(MAX_VERTICES * MAX_VERTICES * 4),      // Int32
      
      vehicleInts: new SharedArrayBuffer(MAX_VEHICLES * 8 * 4),       // Int32
      vehicleFloats: new SharedArrayBuffer(MAX_VEHICLES * 8 * 4),     // Float32
      vehiclePaths: new SharedArrayBuffer(MAX_VEHICLES * 100 * 4),    // Int32 (max path length = 100)
      
      sync: new SharedArrayBuffer(1050 * 4)                           // Int32: Barrier + 1000 intersection locks
    };

    // Instantiate components over Shared Memory
    this.graph = new CityGraph(this.buffers);
    this.workerPool = new WorkerPool(this.buffers);

    // Typed Array Views for direct main thread reads/writes
    this.vehicleIntsView = new Int32Array(this.buffers.vehicleInts);
    this.vehicleFloatsView = new Float32Array(this.buffers.vehicleFloats);
    this.vehiclePathsView = new Int32Array(this.buffers.vehiclePaths);
    
    this.fwDistanceView = new Float32Array(this.buffers.fwDistance);
    this.fwNextView = new Int32Array(this.buffers.fwNext);
    this.syncView = new Int32Array(this.buffers.sync);

    this.totalVehicles = 0;
    this.activeVehicles = 0;
    this.onTickCallback = null;

    // Reset Graph & Memory
    this.graph.clear();
    this.clearVehiclesMemory();
  }

  /**
   * Reset vehicle memory spaces to 0.
   */
  clearVehiclesMemory() {
    this.vehicleIntsView.fill(0);
    this.vehicleFloatsView.fill(0);
    this.vehiclePathsView.fill(0);
    
    // Clear sync buffer locks
    this.syncView.fill(0);
    
    this.totalVehicles = 0;
    this.activeVehicles = 0;
    this.metrics.totalFinished = 0;
    this.metrics.throughput = 0;
  }

  /**
   * Spawns worker threads if running in Parallel mode.
   */
  async initializeWorkerPool() {
    if (this.mode === "parallel") {
      await this.workerPool.spawn(this.numThreads);
    }
  }

  /**
   * Determine the size V of the active graph boundary.
   */
  getGraphBoundary() {
    let V_actual = 0;
    for (let i = 0; i < MAX_VERTICES; i++) {
      if (this.graph.activeNodes[i] === 1) {
        V_actual = i + 1;
      }
    }
    return V_actual;
  }

  /**
   * Run Floyd-Warshall shortest path algorithm (Sequential vs Parallel).
   */
  async calculateShortestPaths() {
    const V = this.getGraphBoundary();
    if (V === 0) return 0;

    const tStart = performance.now();

    if (this.mode === "sequential") {
      // 1. Initialize matrices
      for (let i = 0; i < V; i++) {
        for (let j = 0; j < V; j++) {
          const idx = i * MAX_VERTICES + j;
          if (i === j) {
            this.fwDistanceView[idx] = 0;
            this.fwNextView[idx] = -1;
          } else {
            const w = this.graph.weights[idx];
            const isBlocked = this.graph.blocked[idx] === 1;
            if (w !== Infinity && !isBlocked) {
              this.fwDistanceView[idx] = w;
              this.fwNextView[idx] = j;
            } else {
              this.fwDistanceView[idx] = Infinity;
              this.fwNextView[idx] = -1;
            }
          }
        }
      }

      // 2. Core FW DP update
      for (let k = 0; k < V; k++) {
        for (let i = 0; i < V; i++) {
          const ikIdx = i * MAX_VERTICES + k;
          const d_ik = this.fwDistanceView[ikIdx];

          if (d_ik !== Infinity) {
            for (let j = 0; j < V; j++) {
              const kjIdx = k * MAX_VERTICES + j;
              const d_kj = this.fwDistanceView[kjIdx];

              if (d_kj !== Infinity) {
                const ijIdx = i * MAX_VERTICES + j;
                const currentDist = this.fwDistanceView[ijIdx];
                const newDist = d_ik + d_kj;

                if (newDist < currentDist) {
                  this.fwDistanceView[ijIdx] = newDist;
                  this.fwNextView[ijIdx] = this.fwNextView[ikIdx];
                }
              }
            }
          }
        }
      }
      
      const tEnd = performance.now();
      this.metrics.fwSequentialTime = tEnd - tStart;
      return this.metrics.fwSequentialTime;

    } else {
      // Parallel mode
      await this.workerPool.runParallelFW(V);
      const tEnd = performance.now();
      this.metrics.fwParallelTime = tEnd - tStart;
      return this.metrics.fwParallelTime;
    }
  }

  /**
   * Spawns a vehicle count with routes computed from current graph.
   * @param {number} count - Total vehicles to generate
   */
  generateVehicles(count) {
    this.clearVehiclesMemory();

    const activeNodeIds = [];
    for (let i = 0; i < MAX_VERTICES; i++) {
      if (this.graph.activeNodes[i] === 1) {
        activeNodeIds.push(i);
      }
    }

    if (activeNodeIds.length < 2) {
      console.warn("Need at least 2 active intersections to generate vehicles.");
      return;
    }

    let generated = 0;
    let attempts = 0;
    const maxAttempts = count * 10;

    while (generated < count && attempts < maxAttempts) {
      attempts++;
      
      // Select random origin and destination
      const origin = activeNodeIds[Math.floor(Math.random() * activeNodeIds.length)];
      let destination = activeNodeIds[Math.floor(Math.random() * activeNodeIds.length)];
      
      if (origin === destination) continue;

      // Check if route exists
      const path = this.reconstructPath(origin, destination);
      if (path.length < 2) continue; // No reachable path

      // Pick vehicle type: 0=Car, 1=Motorbike, 2=Bus
      const randType = Math.random();
      let type = 0;
      let speed = 50.0; // Mobil speed base

      if (randType < 0.6) {
        type = 0; // Mobil
        speed = 50.0;
      } else if (randType < 0.9) {
        type = 1; // Motor
        speed = 70.0;
      } else {
        type = 2; // Bus
        speed = 30.0;
      }

      // Add speed variation (+/- 10%)
      speed = speed * (0.9 + Math.random() * 0.2);

      const vOffset = generated * 8;
      const vPathOffset = generated * 100;

      // Set Int properties
      this.vehicleIntsView[vOffset] = generated;      // ID
      this.vehicleIntsView[vOffset + 1] = type;       // Type
      this.vehicleIntsView[vOffset + 2] = 1;          // State: 1 = Moving
      this.vehicleIntsView[vOffset + 3] = origin;    // Origin
      this.vehicleIntsView[vOffset + 4] = destination; // Destination
      this.vehicleIntsView[vOffset + 5] = 0;          // Current path index (starts at 0)
      this.vehicleIntsView[vOffset + 6] = path.length; // Path length

      // Set Float properties
      this.vehicleFloatsView[vOffset] = 0.0;          // Progress
      this.vehicleFloatsView[vOffset + 1] = speed;    // Speed
      this.vehicleFloatsView[vOffset + 2] = 0.0;      // Travel time
      this.vehicleFloatsView[vOffset + 3] = this.graph.coords[origin * 2]; // X
      this.vehicleFloatsView[vOffset + 4] = this.graph.coords[origin * 2 + 1]; // Y
      this.vehicleFloatsView[vOffset + 7] = 0.0;      // Waiting delay

      // Populate path nodes
      for (let p = 0; p < path.length; p++) {
        this.vehiclePathsView[vPathOffset + p] = path[p];
      }

      generated++;
    }

    this.totalVehicles = generated;
    this.activeVehicles = generated;
    console.log(`Simulation: Generated ${generated} vehicles successfully.`);
  }

  /**
   * Run one simulation step (tick update).
   */
  async step() {
    if (this.state !== "running") return;

    const tStart = performance.now();
    let finishedCountThisTick = 0;

    if (this.mode === "sequential") {
      this.runSequentialVehicles();
      const tEnd = performance.now();
      this.metrics.updateSequentialTime = tEnd - tStart;
    } else {
      // Parallel updating on worker pool
      await this.workerPool.runParallelVehicles(this.totalVehicles, this.tickRate);
      const tEnd = performance.now();
      this.metrics.updateParallelTime = tEnd - tStart;
    }

    // Main thread statistics compilation
    let active = 0;
    let finished = 0;
    let waiting = 0;
    let stuck = 0;

    for (let i = 0; i < this.totalVehicles; i++) {
      const state = this.vehicleIntsView[i * 8 + 2];
      if (state === 1) active++;
      else if (state === 0) finished++;
      else if (state === 2) {
        active++;
        waiting++;
      } else if (state === 3) {
        stuck++;
      }
    }

    finishedCountThisTick = finished - this.metrics.totalFinished;
    this.metrics.totalFinished = finished;
    this.activeVehicles = active;

    // Calculate throughput: finished vehicles per second
    const dt = this.tickRate / 1000;
    this.metrics.throughput = finishedCountThisTick / dt;

    this.tickCount++;

    if (this.onTickCallback) {
      this.onTickCallback({
        tick: this.tickCount,
        active: active,
        finished: finished,
        waiting: waiting,
        stuck: stuck,
        throughput: this.metrics.throughput
      });
    }

    // Auto-stop if all vehicles arrived or got stuck
    if (active === 0) {
      this.state = "finished";
      console.log("Simulation finished: All vehicles processed.");
    }
  }

  /**
   * Tick handler. Loops using requestAnimationFrame or timers.
   */
  runLoop() {
    if (this.state !== "running") return;
    
    const nextTick = () => {
      if (this.state !== "running") return;
      this.step().then(() => {
        setTimeout(nextTick, this.tickRate);
      });
    };
    
    setTimeout(nextTick, this.tickRate);
  }

  /**
   * Start simulation.
   */
  async start() {
    this.state = "running";
    await this.initializeWorkerPool();
    this.runLoop();
  }

  /**
   * Pause simulation.
   */
  pause() {
    this.state = "paused";
  }

  /**
   * Resume simulation.
   */
  resume() {
    this.state = "running";
    this.runLoop();
  }

  /**
   * Stop simulation.
   */
  stop() {
    this.state = "stopped";
    this.workerPool.terminate();
  }

  /**
   * Reset simulation states.
   */
  reset() {
    this.state = "stopped";
    this.tickCount = 0;
    this.clearVehiclesMemory();
    this.workerPool.terminate();
  }

  /**
   * Reconstruct route helper using precalculated next-hop matrix (fwNext)
   */
  reconstructPath(start, end) {
    if (this.fwNextView[start * MAX_VERTICES + end] === -1) return [];
    const path = [start];
    let curr = start;
    while (curr !== end) {
      curr = this.fwNextView[curr * MAX_VERTICES + end];
      if (curr === -1) return []; // Broken path
      path.push(curr);
      if (path.length > MAX_VERTICES) return []; // Loop protection
    }
    return path;
  }

  /**
   * Local sequential vehicle update.
   */
  runSequentialVehicles() {
    const dt = this.tickRate / 1000;

    for (let i = 0; i < this.totalVehicles; i++) {
      const vOffset = i * 8;
      const vPathOffset = i * 100;

      const id = this.vehicleIntsView[vOffset];
      const type = this.vehicleIntsView[vOffset + 1];
      let state = this.vehicleIntsView[vOffset + 2]; // 0=Finished, 1=Moving, 2=Waiting, 3=Stuck
      const origin = this.vehicleIntsView[vOffset + 3];
      const destination = this.vehicleIntsView[vOffset + 4];
      let currentPathIndex = this.vehicleIntsView[vOffset + 5];
      const pathLength = this.vehicleIntsView[vOffset + 6];

      if (state !== 1 && state !== 2 && state !== 3) continue;

      let progress = this.vehicleFloatsView[vOffset];
      const speed = this.vehicleFloatsView[vOffset + 1];
      let travelTime = this.vehicleFloatsView[vOffset + 2];
      let delayCounter = this.vehicleFloatsView[vOffset + 7];

      travelTime += dt;

      if (state === 2) {
        delayCounter -= dt;
        if (delayCounter <= 0) {
          delayCounter = 0;
          state = 1;
        }
      }

      if (state === 1) {
        const u = this.vehiclePathsView[vPathOffset + currentPathIndex];
        const v = this.vehiclePathsView[vPathOffset + currentPathIndex + 1];

        const w = this.graph.weights[u * MAX_VERTICES + v];
        const isBlocked = this.graph.blocked[u * MAX_VERTICES + v] === 1;

        if (isBlocked || w === Infinity) {
          // Dynamic rerouting
          const newPath = this.reconstructPath(u, destination);
          if (newPath.length > 1) {
            this.vehicleIntsView[vOffset + 6] = newPath.length;
            this.vehicleIntsView[vOffset + 5] = 0;
            currentPathIndex = 0;
            for (let pIdx = 0; pIdx < newPath.length; pIdx++) {
              this.vehiclePathsView[vPathOffset + pIdx] = newPath[pIdx];
            }
            progress = 0;
          } else {
            state = 3; // Stuck
          }
        }

        if (state === 1) {
          progress += (speed * dt) / w;

          if (progress >= 1.0) {
            progress = 1.0;

            if (v === destination) {
              state = 0; // Finished
              progress = 1.0;
            } else {
              // Crossing delay simulation (intersection conflict safety)
              const lockIndex = 10 + v;
              
              if (this.syncView[lockIndex] === 0) {
                // Acquire lock
                this.syncView[lockIndex] = 1;
                currentPathIndex += 1;
                this.vehicleIntsView[vOffset + 5] = currentPathIndex;
                progress = 0;
                state = 2; // Waiting
                delayCounter = 0.5; // crossing time in seconds
                
                // Release lock immediately since state updated
                this.syncView[lockIndex] = 0;
              } else {
                state = 2; // Waiting to acquire intersection
                delayCounter = 0.2;
              }
            }
          }

          // Update position values
          const nextU = this.vehiclePathsView[vPathOffset + currentPathIndex];
          const nextV = this.vehiclePathsView[vPathOffset + currentPathIndex + 1];

          const ux = this.graph.coords[nextU * 2];
          const uy = this.graph.coords[nextU * 2 + 1];
          const vx = this.graph.coords[nextV * 2];
          const vy = this.graph.coords[nextV * 2 + 1];

          const x = ux + (vx - ux) * progress;
          const y = uy + (vy - uy) * progress;

          this.vehicleFloatsView[vOffset + 3] = x;
          this.vehicleFloatsView[vOffset + 4] = y;
          this.vehicleFloatsView[vOffset + 5] = vx;
          this.vehicleFloatsView[vOffset + 6] = vy;
        }
      }

      this.vehicleIntsView[vOffset + 2] = state;
      this.vehicleFloatsView[vOffset] = progress;
      this.vehicleFloatsView[vOffset + 2] = travelTime;
      this.vehicleFloatsView[vOffset + 7] = delayCounter;
    }
  }
}
