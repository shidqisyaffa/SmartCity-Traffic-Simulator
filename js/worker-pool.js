/**
 * SmartCity Traffic Simulator - Worker Pool Module (js/worker-pool.js)
 * Spawns and coordinates Web Workers, allocating work partitions.
 */

export class WorkerPool {
  constructor(buffers) {
    this.buffers = buffers; // Reference to all SharedArrayBuffers
    this.workers = [];
    this.numWorkers = 0;
    this.pendingResolvers = null;
    this.pendingCount = 0;
  }

  /**
   * Spawns worker threads. Automatically terminates any existing threads.
   * @param {number} count - Number of workers to spawn
   */
  async spawn(count) {
    this.terminate();
    this.numWorkers = count;
    this.workers = [];

    const promises = [];

    for (let i = 0; i < count; i++) {
      const worker = new Worker("js/worker.js");
      this.workers.push(worker);

      const promise = new Promise((resolve) => {
        worker.onmessage = (e) => {
          if (e.data.type === "INIT_DONE") {
            resolve();
          } else {
            this.handleWorkerMessage(i, e.data);
          }
        };
      });
      promises.push(promise);

      // Initialize the worker with buffers and identification
      worker.postMessage({
        type: "INIT",
        data: {
          workerId: i,
          numWorkers: count,
          buffers: this.buffers
        }
      });
    }

    await Promise.all(promises);
    console.log(`Worker Pool: Spawned ${count} parallel workers successfully.`);
  }

  /**
   * Terminate all worker instances.
   */
  terminate() {
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
    this.numWorkers = 0;
    console.log("Worker Pool: Terminated all running workers.");
  }

  /**
   * Handle incoming messages from workers.
   */
  handleWorkerMessage(workerId, message) {
    const { type } = message;

    if (type === "FW_DONE" || type === "VEHICLES_DONE") {
      this.pendingCount--;
      if (this.pendingCount === 0 && this.pendingResolvers) {
        const resolve = this.pendingResolvers;
        this.pendingResolvers = null;
        resolve();
      }
    }
  }

  /**
   * Execute Parallel Floyd-Warshall across all workers.
   * @param {number} V - Active number of vertices
   */
  runParallelFW(V) {
    return new Promise((resolve) => {
      if (this.numWorkers === 0) {
        resolve();
        return;
      }

      this.pendingResolvers = resolve;
      this.pendingCount = this.numWorkers;

      // Reset sync barrier values in Shared Memory before run
      const syncView = new Int32Array(this.buffers.sync);
      syncView[0] = V; // V
      syncView[1] = 0; // Completed barrier counter
      syncView[2] = 0; // Phase toggle

      for (let i = 0; i < this.numWorkers; i++) {
        this.workers[i].postMessage({
          type: "RUN_FW",
          data: { V }
        });
      }
    });
  }

  /**
   * Execute Parallel Vehicle Updates.
   * @param {number} totalVehicles - Total active vehicle count
   * @param {number} tickRate - Tick speed in milliseconds
   */
  runParallelVehicles(totalVehicles, tickRate) {
    return new Promise((resolve) => {
      if (this.numWorkers === 0 || totalVehicles === 0) {
        resolve();
        return;
      }

      this.pendingResolvers = resolve;
      this.pendingCount = this.numWorkers;

      // Partition vehicles linearly among workers
      const vehiclesPerWorker = Math.ceil(totalVehicles / this.numWorkers);

      for (let i = 0; i < this.numWorkers; i++) {
        const startIdx = i * vehiclesPerWorker;
        const endIdx = Math.min(totalVehicles, startIdx + vehiclesPerWorker);

        if (startIdx < totalVehicles) {
          this.workers[i].postMessage({
            type: "RUN_VEHICLES",
            data: { startIdx, endIdx, tickRate }
          });
        } else {
          // Worker has no vehicles to process, count it as immediately done
          this.pendingCount--;
        }
      }

      if (this.pendingCount === 0) {
        this.pendingResolvers = null;
        resolve();
      }
    });
  }
}
