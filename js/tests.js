/**
 * SmartCity Traffic Simulator - Verification & Test Suite (js/tests.js)
 * Implements unit tests, equivalence tests, and stress tests.
 */

import { Simulation, MAX_VEHICLES } from './simulation.js';
import { CityGraph, MAX_VERTICES } from './graph.js';

export async function runSystemTests() {
  console.log("%c=== STARTING SIMULATOR VERIFICATION SUITE ===", "color: #4F46E5; font-weight: bold; font-size: 1.1rem;");
  
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`%c[PASS] %c${message}`, "color: #10B981; font-weight: bold;", "color: #D1D5DB;");
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  // TEST 1: Graph CRUD Operations
  try {
    const graph = new CityGraph();
    graph.addVertex(0, 100, 100);
    graph.addVertex(1, 200, 200);
    graph.addEdge(0, 1, 55.5, true);
    
    assert(graph.activeNodes[0] === 1 && graph.activeNodes[1] === 1, "Graph active nodes created correctly.");
    assert(graph.getWeight(0, 1) === 55.5 && graph.getWeight(1, 0) === 55.5, "Graph edge weight assigned correctly.");
    
    graph.blockRoad(0, 1, true);
    assert(graph.getWeight(0, 1) === Infinity, "Graph edge blocking functions successfully.");
    
    graph.unblockRoad(0, 1, true);
    assert(graph.getWeight(0, 1) === 55.5, "Graph edge unblocking functions successfully.");
    
    graph.removeVertex(0);
    assert(graph.activeNodes[0] === 0, "Graph vertex removal functions successfully.");
    assert(graph.getWeight(0, 1) === Infinity, "incident edges removed on vertex deletion.");
  } catch (e) {
    console.error("Test 1 crashed:", e);
    failed++;
  }

  // TEST 2: Floyd-Warshall Deterministic Equivalence
  try {
    const sim = new Simulation();
    const size = 150; // Use a moderate graph size for equivalence test
    
    // Generate a random connected graph
    for (let i = 0; i < size; i++) {
      sim.graph.addVertex(i, Math.random() * 800, Math.random() * 600);
    }
    
    // Grid connect
    for (let i = 1; i < size; i++) {
      sim.graph.addEdge(i, i - 1, 40 + Math.random() * 40, true);
    }
    
    // Add extra random edges
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) {
        if (Math.random() < 0.05) {
          sim.graph.addEdge(i, j, 50 + Math.random() * 50, true);
        }
      }
    }

    // Step A: Run Sequential FW
    sim.mode = "sequential";
    const tSeq = await sim.calculateShortestPaths();
    
    // Copy computed sequential matrices
    const seqDist = new Float32Array(sim.fwDistanceView);
    const seqNext = new Int32Array(sim.fwNextView);

    // Step B: Run Parallel FW (4 threads)
    sim.mode = "parallel";
    sim.numThreads = 4;
    await sim.initializeWorkerPool();
    const tPar = await sim.calculateShortestPaths();

    // Verify identity
    let identical = true;
    const boundary = sim.getGraphBoundary();
    
    for (let i = 0; i < boundary * MAX_VERTICES; i++) {
      // Check if coordinate indices map to active subgrids
      const r = Math.floor(i / MAX_VERTICES);
      const c = i % MAX_VERTICES;
      if (r < boundary && c < boundary) {
        if (sim.fwDistanceView[i] !== seqDist[i] || sim.fwNextView[i] !== seqNext[i]) {
          identical = false;
          console.error(`Mismatch at cell [${r}, ${c}]: Seq Dist=${seqDist[i]}, Par Dist=${sim.fwDistanceView[i]}; Seq Next=${seqNext[i]}, Par Next=${sim.fwNextView[i]}`);
          break;
        }
      }
    }

    assert(identical, `Equivalence test passed: Sequential and Parallel FW calculated 100% IDENTICAL output matrices.`);
    console.log(`  (Sequential FW: ${tSeq.toFixed(2)}ms | Parallel FW (4T): ${tPar.toFixed(2)}ms)`);
    
    sim.workerPool.terminate();
  } catch (e) {
    console.error("Test 2 crashed:", e);
    failed++;
  }

  // TEST 3: Route Reconstruction
  try {
    const sim = new Simulation();
    sim.graph.addVertex(0, 100, 100);
    sim.graph.addVertex(1, 200, 100);
    sim.graph.addVertex(2, 300, 100);
    
    sim.graph.addEdge(0, 1, 10, true);
    sim.graph.addEdge(1, 2, 20, true);
    
    await sim.calculateShortestPaths();
    const path = sim.reconstructPath(0, 2);
    
    assert(path.length === 3 && path[0] === 0 && path[1] === 1 && path[2] === 2, "Shortest path reconstructed correctly: " + path.join(" -> "));
  } catch (e) {
    console.error("Test 3 crashed:", e);
    failed++;
  }

  console.log(`%c=== VERIFICATION COMPLETE: ${passed} Passed, ${failed} Failed ===`, 
    failed === 0 ? "color: #10B981; font-weight: bold;" : "color: #EF4444; font-weight: bold;");
  
  return { passed, failed };
}

// Attach to window for dev console access
window.runSystemTests = runSystemTests;
