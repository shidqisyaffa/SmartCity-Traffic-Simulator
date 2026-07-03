/**
 * SmartCity Traffic Simulator - Main App Module (js/app.js)
 * Ties UI elements, simulation engine, renderer, and benchmarks together.
 * Manages click selections, drag panning, zoom operations, stats cards, and threads monitors.
 */

import { Simulation, MAX_VEHICLES } from './simulation.js';
import { CityGraph, MAX_VERTICES } from './graph.js';
import { CanvasRenderer } from './renderer.js';
import { runSystemTests } from './tests.js';

document.addEventListener("DOMContentLoaded", async () => {
  // Run Diagnostics Suite
  runSystemTests();

  // Initialize core simulation and canvas renderer
  const sim = new Simulation();
  const canvas = document.getElementById("sim-canvas");
  const renderer = new CanvasRenderer(canvas, sim);
  
  // Track visual loop state
  let animationFrameId = null;

  // DOM UI references
  const compModeSelect = document.getElementById("comp-mode");
  const threadSlider = document.getElementById("thread-count");
  const threadVal = document.getElementById("thread-val");
  const threadGroup = document.getElementById("thread-group");
  const tickSlider = document.getElementById("tick-rate");
  const tickVal = document.getElementById("tick-val");
  const presetSelect = document.getElementById("preset-graph");
  const btnLoadGraph = document.getElementById("btn-load-graph");
  const vehicleSelect = document.getElementById("vehicle-count");
  const btnSpawnVehicles = document.getElementById("btn-spawn-vehicles");
  
  const btnStart = document.getElementById("btn-start");
  const btnPause = document.getElementById("btn-pause");
  const btnResume = document.getElementById("btn-resume");
  const btnStop = document.getElementById("btn-stop");
  const btnReset = document.getElementById("btn-reset");

  const statusBadge = document.getElementById("status-badge");
  const actionNotifier = document.getElementById("action-notifier");

  // Presentation Mode Elements
  const presModeCheckbox = document.getElementById("presentation-mode");
  const presStatusText = document.getElementById("pres-status");

  // Zoom / Pan elements
  const btnZoomIn = document.getElementById("btn-zoom-in");
  const btnZoomOut = document.getElementById("btn-zoom-out");
  const btnZoomFit = document.getElementById("btn-zoom-fit");

  // Dashboard Items
  const metricTick = document.getElementById("metric-tick");
  const metricThroughput = document.getElementById("metric-throughput");
  const metricActive = document.getElementById("metric-active");
  const metricFinished = document.getElementById("metric-finished");
  const metricTime = document.getElementById("metric-time");
  const metricProgressPct = document.getElementById("metric-progress-pct");
  const timelineProgressBar = document.getElementById("timeline-progress-bar");

  // Vehicle Status distribution bars
  const distBarMoving = document.getElementById("dist-bar-moving");
  const distBarWaiting = document.getElementById("dist-bar-waiting");
  const distBarStuck = document.getElementById("dist-bar-stuck");
  const distBarFinished = document.getElementById("dist-bar-finished");

  // Congestion Card Elements
  const congestionAvg = document.getElementById("congestion-avg");
  const congestionMaxRoad = document.getElementById("congestion-max-road");
  const congestionBusyNode = document.getElementById("congestion-busy-node");

  // Graph Statistics Panel
  const statNodesEdges = document.getElementById("stat-nodes-edges");
  const statDensity = document.getElementById("stat-density");
  const statAvgDegree = document.getElementById("stat-avg-degree");
  const statBlockedCount = document.getElementById("stat-blocked-count");

  // Thread activity lists
  const workerActivityList = document.getElementById("worker-activity-list");
  const metricFwTime = document.getElementById("metric-fw-time");
  const metricUpdateTime = document.getElementById("metric-update-time");

  // Interactive buttons
  const btnBlockAll = document.getElementById("btn-block-all");
  const btnUnblockAll = document.getElementById("btn-unblock-all");
  const btnExportCsv = document.getElementById("btn-export-csv");
  const btnExportJson = document.getElementById("btn-export-json");

  // Benchmark tabs & high impact cards
  const tabLive = document.getElementById("tab-live");
  const tabBench = document.getElementById("tab-bench");
  const contentLive = document.getElementById("tab-content-live");
  const contentBench = document.getElementById("tab-content-bench");
  
  const btnRunBenchmark = document.getElementById("btn-run-benchmark");
  const benchResults = document.getElementById("bench-results");
  const chartExecTime = document.getElementById("chart-exec-time");
  const chartSpeedup = document.getElementById("chart-speedup");
  const chartEfficiency = document.getElementById("chart-efficiency");
  const amdahlAnalysis = document.getElementById("amdahl-analysis");

  const benchValSeq = document.getElementById("bench-val-seq");
  const benchValPar = document.getElementById("bench-val-par");
  const benchValSpeedup = document.getElementById("bench-val-speedup");
  const benchValEff = document.getElementById("bench-val-eff");

  // Setup initial state
  updateUIForStatus("stopped");
  generatePresetGraph("grid"); // load grid by default
  renderer.draw();

  // ── Floating Info Cards — Collapse / Expand ──────────────────
  function bindInfoCardToggle(toggleId, cardId) {
    const btn  = document.getElementById(toggleId);
    const card = document.getElementById(cardId);
    if (!btn || !card) return;
    btn.addEventListener("click", () => {
      card.classList.toggle("is-collapsed");
    });
  }
  bindInfoCardToggle("toggle-vehicle-types",  "card-vehicle-types");
  bindInfoCardToggle("toggle-traffic-heatmap","card-traffic-heatmap");
  // ─────────────────────────────────────────────────────────────


  // Draw loop for Canvas rendering (60 FPS visual smoothness)
  function renderLoop() {
    renderer.draw();
    updateThreadVisuals(); // Update worker bars at rendering tick
    animationFrameId = requestAnimationFrame(renderLoop);
  }
  
  // Start drawing canvas
  renderLoop();

  // Helper: notify user in notifier box
  function notify(msg) {
    actionNotifier.textContent = msg;
  }

  // Handle Presentation Mode Toggle
  presModeCheckbox.addEventListener("change", () => {
    const active = presModeCheckbox.checked;
    renderer.presentationMode = active;
    
    if (active) {
      document.body.classList.add("pres-mode-on");
      presStatusText.textContent = "ON";
      presStatusText.classList.add("active");
      notify("Presentation Mode [ON]: Visual glows, line widths and text size scaled up for display.");
    } else {
      document.body.classList.remove("pres-mode-on");
      presStatusText.textContent = "OFF";
      presStatusText.classList.remove("active");
      notify("Presentation Mode [OFF]: Default performance rendering mode restored.");
    }
    renderer.draw();
  });

  // Handle Zoom Operations
  btnZoomIn.addEventListener("click", () => {
    renderer.zoomLevel = Math.min(renderer.zoomLevel * 1.25, 4.0);
    notify(`Zoom Level: ${(renderer.zoomLevel * 100).toFixed(0)}%`);
  });

  btnZoomOut.addEventListener("click", () => {
    renderer.zoomLevel = Math.max(renderer.zoomLevel / 1.25, 0.45);
    notify(`Zoom Level: ${(renderer.zoomLevel * 100).toFixed(0)}%`);
  });

  btnZoomFit.addEventListener("click", () => {
    renderer.resetView();
    notify("View aligned to graph bounds.");
  });

  // Drag Panning Event Handlers
  canvas.addEventListener("mousedown", (e) => {
    renderer.isDragging = true;
    renderer.startX = e.clientX;
    renderer.startY = e.clientY;
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!renderer.isDragging) return;
    const dx = e.clientX - renderer.startX;
    const dy = e.clientY - renderer.startY;
    
    renderer.panX += dx;
    renderer.panY += dy;
    
    renderer.startX = e.clientX;
    renderer.startY = e.clientY;
  });

  window.addEventListener("mouseup", () => {
    renderer.isDragging = false;
  });

  // Handle mode select
  compModeSelect.addEventListener("change", () => {
    sim.mode = compModeSelect.value;
    if (sim.mode === "sequential") {
      threadGroup.style.opacity = "0.4";
      threadSlider.disabled = true;
      notify("Switched to Sequential computing mode.");
    } else {
      threadGroup.style.opacity = "1";
      threadSlider.disabled = false;
      notify(`Switched to Parallel computing mode with ${sim.numThreads} threads.`);
    }
    updateThreadVisuals();
  });

  // Handle threads slider
  threadSlider.addEventListener("input", async () => {
    const val = parseInt(threadSlider.value);
    threadVal.textContent = val;
    sim.numThreads = val;
    notify(`Thread allocation updated to ${val}.`);
    
    // Spawn threads if simulation is running/paused in parallel mode
    if (sim.state !== "stopped" && sim.mode === "parallel") {
      notify(`Re-spawning worker threads pool to ${val}...`);
      await sim.initializeWorkerPool();
      notify(`Worker pool successfully adjusted to ${val} threads.`);
    }
    updateThreadVisuals();
  });

  // Handle tick interval slider
  tickSlider.addEventListener("input", () => {
    const val = parseInt(tickSlider.value);
    tickVal.textContent = val + "ms";
    sim.tickRate = val;
  });

  // Handle Load Graph
  btnLoadGraph.addEventListener("click", () => {
    const type = presetSelect.value;
    generatePresetGraph(type);
    renderer.resetView(); // auto-center new topology
    sim.clearVehiclesMemory();
    updateDashboardMetrics();
    updateGraphStatsPanel();
  });

  // Handle Spawn Vehicles
  btnSpawnVehicles.addEventListener("click", async () => {
    const count = parseInt(vehicleSelect.value);
    notify(`Calculating shortest routing matrices using Floyd-Warshall...`);
    
    btnSpawnVehicles.disabled = true;
    const fwTime = await sim.calculateShortestPaths();
    
    notify(`Paths calculated in ${fwTime.toFixed(2)}ms. Spawning ${count} vehicles...`);
    sim.generateVehicles(count);
    
    btnSpawnVehicles.disabled = false;
    renderer.selectedVehicleId = null; // Reset selection
    updateDashboardMetrics();
    notify(`Spawned ${sim.totalVehicles} vehicles. Ready to simulate.`);
  });

  // Tab switching
  tabLive.addEventListener("click", () => {
    tabLive.classList.add("active");
    tabBench.classList.remove("active");
    contentLive.classList.remove("hidden");
    contentBench.classList.add("hidden");
  });

  tabBench.addEventListener("click", () => {
    tabBench.classList.add("active");
    tabLive.classList.remove("active");
    contentBench.classList.remove("hidden");
    contentLive.classList.add("hidden");
  });

  // Action buttons events
  btnStart.addEventListener("click", async () => {
    if (sim.totalVehicles === 0) {
      notify("Please spawn vehicles before starting.");
      return;
    }
    
    notify("Starting simulation engine...");
    updateUIForStatus("running");
    
    // Calculate path matrices initially
    await sim.calculateShortestPaths();
    await sim.start();
    notify("Simulation running...");
  });

  btnPause.addEventListener("click", () => {
    sim.pause();
    updateUIForStatus("paused");
    notify("Simulation paused.");
  });

  btnResume.addEventListener("click", () => {
    sim.resume();
    updateUIForStatus("running");
    notify("Simulation resumed.");
  });

  btnStop.addEventListener("click", () => {
    sim.stop();
    updateUIForStatus("stopped");
    notify("Simulation stopped. Workers terminated.");
    updateThreadVisuals();
  });

  btnReset.addEventListener("click", () => {
    sim.reset();
    renderer.selectedVehicleId = null; // Clear selection
    updateUIForStatus("stopped");
    notify("Simulation reset. All metrics cleared.");
    updateDashboardMetrics();
    updateThreadVisuals();
  });

  // Tick updates listener
  sim.onTickCallback = (metrics) => {
    updateDashboardMetrics(metrics);
  };

  // Sync dashboard values
  function updateDashboardMetrics(metrics = null) {
    // 1. Timeline & Progress calculations
    const timeVal = sim.tickCount * (sim.tickRate / 1000);
    metricTime.textContent = timeVal.toFixed(1) + "s";

    let finishedCount = 0;
    if (metrics) {
      metricTick.textContent = metrics.tick;
      metricThroughput.textContent = metrics.throughput.toFixed(1) + " v/s";
      metricActive.textContent = metrics.active;
      metricFinished.textContent = metrics.finished;
      finishedCount = metrics.finished;
    } else {
      metricTick.textContent = sim.tickCount;
      metricThroughput.textContent = "0.0 v/s";
      metricActive.textContent = sim.activeVehicles;
      metricFinished.textContent = sim.metrics.totalFinished;
      finishedCount = sim.metrics.totalFinished;
    }

    const progressPct = sim.totalVehicles > 0 
      ? Math.round((finishedCount / sim.totalVehicles) * 100) 
      : 0;
    
    metricProgressPct.textContent = progressPct + "%";
    timelineProgressBar.style.width = progressPct + "%";

    // 2. Vehicle Status Distribution visual bar updates
    let moving = 0, waiting = 0, stuck = 0;
    for (let i = 0; i < sim.totalVehicles; i++) {
      const state = sim.vehicleIntsView[i * 8 + 2];
      if (state === 1) moving++;
      else if (state === 2) waiting++;
      else if (state === 3) stuck++;
    }

    const total = sim.totalVehicles || 1;
    distBarMoving.style.width = ((moving / total) * 100) + "%";
    distBarWaiting.style.width = ((waiting / total) * 100) + "%";
    distBarStuck.style.width = ((stuck / total) * 100) + "%";
    distBarFinished.style.width = ((finishedCount / total) * 100) + "%";

    // 3. Execution time readouts
    if (sim.mode === "sequential") {
      metricFwTime.textContent = sim.metrics.fwSequentialTime.toFixed(2) + " ms";
      metricUpdateTime.textContent = sim.metrics.updateSequentialTime.toFixed(2) + " ms";
    } else {
      metricFwTime.textContent = sim.metrics.fwParallelTime.toFixed(2) + " ms";
      metricUpdateTime.textContent = sim.metrics.updateParallelTime.toFixed(2) + " ms";
    }

    // 4. Update Congestion Summary calculations
    updateCongestionSummary();

    if (sim.state === "finished") {
      updateUIForStatus("finished");
      notify("Simulation completed.");
    }
  }

  // Update Congestion metrics on dashboard
  function updateCongestionSummary() {
    const V = sim.getGraphBoundary();
    if (V === 0) {
      congestionAvg.textContent = "0.0%";
      congestionMaxRoad.textContent = "None";
      congestionBusyNode.textContent = "None";
      return;
    }

    // Map active vehicles to edges & count waiting vehicles on intersections
    const edgeVehiclesCount = {};
    const nodeWaitingCount = new Int32Array(MAX_VERTICES);
    const edgeCapacity = 10;
    let totalCongestion = 0;
    let activeEdges = 0;
    let maxEdgeKey = "None";
    let maxEdgeVal = -1;

    for (let i = 0; i < sim.totalVehicles; i++) {
      const state = sim.vehicleIntsView[i * 8 + 2];
      if (state === 1 || state === 2) {
        const currentPathIdx = sim.vehicleIntsView[i * 8 + 5];
        const vPathOffset = i * 100;
        const u = sim.vehiclePathsView[vPathOffset + currentPathIdx];
        const v = sim.vehiclePathsView[vPathOffset + currentPathIdx + 1];

        if (u !== undefined && v !== undefined) {
          const key = `${u} ➔ ${v}`;
          edgeVehiclesCount[key] = (edgeVehiclesCount[key] || 0) + 1;
          if (edgeVehiclesCount[key] > maxEdgeVal) {
            maxEdgeVal = edgeVehiclesCount[key];
            maxEdgeKey = key;
          }
        }
        
        if (state === 2 && u !== undefined) {
          nodeWaitingCount[u]++; // count waiting at intersection u
        }
      }
    }

    // Average density calculation
    for (let i = 0; i < V; i++) {
      if (sim.graph.activeNodes[i] !== 1) continue;
      for (let j = 0; j < V; j++) {
        if (sim.graph.activeNodes[j] === 1 && i !== j && sim.graph.weights[i * MAX_VERTICES + j] !== Infinity) {
          const count = edgeVehiclesCount[`${i} ➔ ${j}`] || 0;
          totalCongestion += Math.min(count / edgeCapacity, 1.0);
          activeEdges++;
        }
      }
    }

    const avgDensity = activeEdges > 0 ? (totalCongestion / activeEdges) * 100 : 0;
    congestionAvg.textContent = avgDensity.toFixed(1) + "%";
    congestionMaxRoad.textContent = maxEdgeKey;

    // Find busiest intersection node
    let busiestNode = "None";
    let maxNodeWaiting = -1;
    for (let i = 0; i < V; i++) {
      if (sim.graph.activeNodes[i] === 1 && nodeWaitingCount[i] > maxNodeWaiting) {
        maxNodeWaiting = nodeWaitingCount[i];
        if (maxNodeWaiting > 0) {
          busiestNode = `Intersection #${i}`;
        }
      }
    }
    congestionBusyNode.textContent = busiestNode;
  }

  // Update Graph Statistics widget values
  function updateGraphStatsPanel() {
    const V = sim.getGraphBoundary();
    if (V === 0) {
      statNodesEdges.textContent = "0 / 0";
      statDensity.textContent = "0.0%";
      statAvgDegree.textContent = "0.00";
      statBlockedCount.textContent = "0";
      return;
    }

    let edges = 0;
    let blockedCount = 0;
    let activeNodes = 0;

    for (let i = 0; i < V; i++) {
      if (sim.graph.activeNodes[i] === 1) {
        activeNodes++;
        for (let j = 0; j < V; j++) {
          if (sim.graph.activeNodes[j] === 1 && i !== j) {
            const w = sim.graph.weights[i * MAX_VERTICES + j];
            if (w !== Infinity) {
              edges++;
              if (sim.graph.blocked[i * MAX_VERTICES + j] === 1) {
                blockedCount++;
              }
            }
          }
        }
      }
    }

    // Graph Density calculation
    const densityVal = activeNodes > 1 ? (edges / (activeNodes * (activeNodes - 1))) * 100 : 0;
    const avgDegreeVal = activeNodes > 0 ? edges / activeNodes : 0;

    statNodesEdges.textContent = `${activeNodes} / ${edges}`;
    statDensity.textContent = densityVal.toFixed(1) + "%";
    statAvgDegree.textContent = avgDegreeVal.toFixed(2);
    statBlockedCount.textContent = blockedCount;
  }

  // Update visual worker activity progress bars in right panel
  function updateThreadVisuals() {
    if (sim.mode === "sequential" || sim.state === "stopped") {
      workerActivityList.innerHTML = `<div class="description-text" style="text-align:center; padding: 10px 0;">Thread monitor inactive in Sequential Mode.</div>`;
      return;
    }

    let html = "";
    for (let i = 0; i < sim.numThreads; i++) {
      const stateCode = sim.syncView[4 + i]; // Offset by 4 in sync array
      let stateText = "IDLE";
      let barClass = "worker-idle";
      
      if (stateCode === 1) {
        stateText = "FW COMPUTE";
        barClass = "worker-fw";
      } else if (stateCode === 2) {
        stateText = "VEHICLE UPDATE";
        barClass = "worker-update";
      }

      html += `
        <div class="worker-bar-item">
          <div class="worker-bar-lbl">
            <span>Worker #${i + 1}</span>
            <span class="worker-bar-state" style="color: ${stateCode === 1 ? '#a5b4fc' : stateCode === 2 ? '#34d399' : '#9ca3af'}">${stateText}</span>
          </div>
          <div class="worker-bar-track">
            <div class="worker-bar-fill ${barClass}"></div>
          </div>
        </div>
      `;
    }
    workerActivityList.innerHTML = html;
  }

  // Update button visibility
  function updateUIForStatus(status) {
    sim.state = status;
    statusBadge.className = `badge badge-${status}`;
    statusBadge.textContent = status;

    if (status === "running") {
      btnStart.style.display = "none";
      btnPause.style.display = "block";
      btnResume.style.display = "none";
      btnStop.disabled = false;
      btnPause.disabled = false;
      btnResume.disabled = true;
      btnLoadGraph.disabled = true;
      btnSpawnVehicles.disabled = true;
    } else if (status === "paused") {
      btnStart.style.display = "none";
      btnPause.style.display = "none";
      btnResume.style.display = "block";
      btnStop.disabled = false;
      btnPause.disabled = true;
      btnResume.disabled = false;
    } else if (status === "stopped" || status === "finished") {
      btnStart.style.display = "block";
      btnPause.style.display = "none";
      btnResume.style.display = "none";
      btnStop.disabled = true;
      btnPause.disabled = true;
      btnResume.disabled = true;
      btnLoadGraph.disabled = false;
      btnSpawnVehicles.disabled = false;
    }
  }

  // Road intervention selection handler & Vehicle Selection Click
  canvas.addEventListener("mouseup", async (e) => {
    // If dragging has occurred, prevent processing click logic
    if (renderer.isDragging) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // A. Check if user clicked a vehicle first to select it
    // Project mouse position back to graph coordinates
    const clickedWorld = renderer.toWorld(mouseX, mouseY);
    let selectedVehicleId = null;
    let minVehicleDist = 12; // selection threshold radius in px

    for (let i = 0; i < sim.totalVehicles; i++) {
      const state = sim.vehicleIntsView[i * 8 + 2];
      if (state !== 1 && state !== 2 && state !== 3) continue;

      const vx = sim.vehicleFloatsView[i * 8 + 3];
      const vy = sim.vehicleFloatsView[i * 8 + 4];
      const dist = Math.hypot(clickedWorld.x - vx, clickedWorld.y - vy);
      
      // Map back to screen distance
      const screenDist = dist * renderer.scale * renderer.zoomLevel;
      if (screenDist < minVehicleDist) {
        minVehicleDist = screenDist;
        selectedVehicleId = i;
      }
    }

    if (selectedVehicleId !== null) {
      renderer.selectedVehicleId = selectedVehicleId;
      notify(`Selected Vehicle #${selectedVehicleId}. Active path highlighted.`);
      renderer.draw();
      return;
    }

    // B. Check if user clicked an edge to block/unblock
    if (sim.state === "running") {
      notify("Please pause or stop simulation to block/unblock roads.");
      return;
    }

    const V = sim.getGraphBoundary();
    let clickedEdge = null;
    let minEdgeDistance = 8; // edge line click radius in px

    for (let i = 0; i < V; i++) {
      if (sim.graph.activeNodes[i] !== 1) continue;
      const uCoords = renderer.toScreen(sim.graph.coords[i * 2], sim.graph.coords[i * 2 + 1]);

      for (let j = 0; j < V; j++) {
        if (sim.graph.activeNodes[j] !== 1 || i === j) continue;
        const w = sim.graph.weights[i * MAX_VERTICES + j];
        if (w === Infinity) continue;

        const vCoords = renderer.toScreen(sim.graph.coords[j * 2], sim.graph.coords[j * 2 + 1]);

        // Segment projection calculations
        const dx = vCoords.x - uCoords.x;
        const dy = vCoords.y - uCoords.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) continue;

        let t = ((mouseX - uCoords.x) * dx + (mouseY - uCoords.y) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));

        const nearestX = uCoords.x + t * dx;
        const nearestY = uCoords.y + t * dy;

        const dist = Math.hypot(mouseX - nearestX, mouseY - nearestY);
        if (dist < minEdgeDistance) {
          minEdgeDistance = dist;
          clickedEdge = { from: i, to: j };
        }
      }
    }

    if (clickedEdge) {
      const from = clickedEdge.from;
      const to = clickedEdge.to;
      const isBlocked = sim.graph.isBlocked(from, to);

      if (isBlocked) {
        sim.graph.unblockRoad(from, to, true); // unblock two-way
        notify(`Road segment ${from} ➔ ${to} Unblocked.`);
      } else {
        sim.graph.blockRoad(from, to, true); // block two-way
        notify(`Road segment ${from} ➔ ${to} Blocked! Dynamic rerouting triggered.`);
      }

      // Recalculate shortest path matrices dynamically
      notify("Recalculating routing matrices...");
      const t = await sim.calculateShortestPaths();
      notify(`Routing matrices updated in ${t.toFixed(2)}ms.`);
      updateGraphStatsPanel();
      renderer.draw();
    } else {
      // Clear selection if clicked blank space
      renderer.selectedVehicleId = null;
      renderer.draw();
    }
  });

  // Random blockage triggers
  btnBlockAll.addEventListener("click", async () => {
    const V = sim.getGraphBoundary();
    if (V < 2) return;
    
    const edges = [];
    for (let i = 0; i < V; i++) {
      if (sim.graph.activeNodes[i] !== 1) continue;
      for (let j = 0; j < V; j++) {
        if (sim.graph.activeNodes[j] === 1 && i !== j && sim.graph.weights[i * MAX_VERTICES + j] !== Infinity) {
          edges.push({ from: i, to: j });
        }
      }
    }

    if (edges.length > 0) {
      const edge = edges[Math.floor(Math.random() * edges.length)];
      sim.graph.blockRoad(edge.from, edge.to, true);
      notify(`Random road closed: ${edge.from} ➔ ${edge.to}`);
      await sim.calculateShortestPaths();
      updateGraphStatsPanel();
      renderer.draw();
    }
  });

  btnUnblockAll.addEventListener("click", async () => {
    sim.graph.blocked.fill(0);
    notify("All road blocks cleared.");
    await sim.calculateShortestPaths();
    updateGraphStatsPanel();
    renderer.draw();
  });

  // Export JSON
  btnExportJson.addEventListener("click", () => {
    const jsonStr = sim.graph.exportToJSON();
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smartcity_graph_${Date.now()}.json`;
    a.click();
    notify("Graph configuration JSON downloaded.");
  });

  // Export CSV
  btnExportCsv.addEventListener("click", () => {
    if (sim.totalVehicles === 0) {
      notify("No vehicle journey logs found.");
      return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Vehicle ID,Vehicle Type,State Code,Origin,Destination,Progress (%),Travel Time (s)\n";

    for (let i = 0; i < sim.totalVehicles; i++) {
      const offset = i * 8;
      const id = sim.vehicleIntsView[offset];
      const type = sim.vehicleIntsView[offset + 1];
      const state = sim.vehicleIntsView[offset + 2];
      const origin = sim.vehicleIntsView[offset + 3];
      const destination = sim.vehicleIntsView[offset + 4];
      
      const progress = sim.vehicleFloatsView[offset] * 100;
      const travelTime = sim.vehicleFloatsView[offset + 2];

      const typeStr = type === 0 ? "Mobil" : type === 1 ? "Motor" : "Bus";
      const stateStr = state === 0 ? "Finished" : state === 1 ? "Moving" : state === 2 ? "Waiting" : "Stuck";

      csvContent += `${id},${typeStr},${stateStr},${origin},${destination},${progress.toFixed(1)}%,${travelTime.toFixed(2)}\n`;
    }

    const encodedUri = encodeURI(csvContent);
    const a = document.createElement("a");
    a.href = encodedUri;
    a.download = `smartcity_statistics_${Date.now()}.csv`;
    a.click();
    notify("Vehicles statistics CSV downloaded.");
  });

  // Graph generators presets
  function generatePresetGraph(type) {
    sim.graph.clear();
    
    if (type === "grid") {
      // 7x7 grid (49 nodes)
      const size = 7;
      let id = 0;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const x = 100 + c * 100;
          const y = 80 + r * 80;
          sim.graph.addVertex(id++, x, y);
        }
      }

      // Add bidirectional connections
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const curr = r * size + c;
          if (c < size - 1) { // connect right
            const w = 50 + Math.floor(Math.random() * 50);
            sim.graph.addEdge(curr, curr + 1, w, true);
          }
          if (r < size - 1) { // connect down
            const w = 50 + Math.floor(Math.random() * 50);
            sim.graph.addEdge(curr, curr + size, w, true);
          }
        }
      }
      notify("Generated standard 7x7 Grid city graph.");
    } 
    else if (type === "circle") {
      // Circular Ring Road
      const rings = 3;
      const nodesPerRing = 20;
      let id = 0;

      // Add center intersection
      const cx = 400;
      const cy = 300;
      sim.graph.addVertex(id++, cx, cy);

      for (let ring = 1; ring <= rings; ring++) {
        const radius = ring * 80;
        for (let i = 0; i < nodesPerRing; i++) {
          const angle = (i * 2 * Math.PI) / nodesPerRing;
          const x = cx + radius * Math.cos(angle);
          const y = cy + radius * Math.sin(angle);
          sim.graph.addVertex(id++, x, y);
        }
      }

      // Connect rings concentric edges
      for (let ring = 1; ring <= rings; ring++) {
        const offset = 1 + (ring - 1) * nodesPerRing;
        for (let i = 0; i < nodesPerRing; i++) {
          const next = offset + ((i + 1) % nodesPerRing);
          const curr = offset + i;
          sim.graph.addEdge(curr, next, 60, true);
        }
      }

      // Connect rings radially
      // Connect center to first ring
      for (let i = 0; i < nodesPerRing; i += 4) {
        sim.graph.addEdge(0, 1 + i, 80, true);
      }
      
      // Connect inner ring to middle ring
      for (let i = 0; i < nodesPerRing; i += 2) {
        const inner = 1 + i;
        const middle = 1 + nodesPerRing + i;
        sim.graph.addEdge(inner, middle, 80, true);
      }

      // Connect middle to outer ring
      for (let i = 0; i < nodesPerRing; i++) {
        const middle = 1 + nodesPerRing + i;
        const outer = 1 + nodesPerRing * 2 + i;
        sim.graph.addEdge(middle, outer, 80, true);
      }

      notify("Generated Circular Concentric Ring road system.");
    }
    else if (type === "complex") {
      // Complex High Density city structure
      const count = 120;
      generateRandomConnectedGraph(count, 0.08);
      notify("Generated High Density Core complex city graph.");
    }
    else if (type.startsWith("custom_")) {
      const size = parseInt(type.split("_")[1]);
      generateRandomConnectedGraph(size, size > 250 ? 0.02 : 0.05);
      notify(`Generated stress-testing layout with ${size} nodes.`);
    }
    updateGraphStatsPanel();
  }

  // Generates randomized graph ensuring single-component connectivity
  function generateRandomConnectedGraph(numNodes, edgeProb) {
    const cx = 400;
    const cy = 300;

    for (let i = 0; i < numNodes; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 1.5) * 250;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      sim.graph.addVertex(i, x, y);
    }

    // Connect node to nearest neighbors first to prevent disjoint sets
    for (let i = 1; i < numNodes; i++) {
      let nearest = 0;
      let minDist = Infinity;
      const ix = sim.graph.coords[i * 2];
      const iy = sim.graph.coords[i * 2 + 1];

      for (let j = 0; j < i; j++) {
        const jx = sim.graph.coords[j * 2];
        const jy = sim.graph.coords[j * 2 + 1];
        const dist = Math.hypot(ix - jx, iy - jy);
        if (dist < minDist) {
          minDist = dist;
          nearest = j;
        }
      }
      sim.graph.addEdge(i, nearest, Math.max(20, Math.round(minDist / 2)), true);
    }

    // Add secondary mesh connectivity edges
    for (let i = 0; i < numNodes; i++) {
      const ix = sim.graph.coords[i * 2];
      const iy = sim.graph.coords[i * 2 + 1];

      for (let j = i + 1; j < numNodes; j++) {
        if (Math.random() < edgeProb) {
          const jx = sim.graph.coords[j * 2];
          const jy = sim.graph.coords[j * 2 + 1];
          const dist = Math.hypot(ix - jx, iy - jy);
          
          if (dist < 150) {
            sim.graph.addEdge(i, j, Math.max(20, Math.round(dist / 2)), true);
          }
        }
      }
    }
  }

  // scientific benchmarking runs
  btnRunBenchmark.addEventListener("click", async () => {
    btnRunBenchmark.disabled = true;
    notify("Initializing Scientific Benchmark execution...");
    benchResults.classList.add("hidden");
    
    // Pause canvas animation loops to avoid rendering overhead affecting benchmarks
    cancelAnimationFrame(animationFrameId);

    // Save previous state configurations
    const prevMode = sim.mode;
    const prevThreads = sim.numThreads;
    
    notify("Generating test graph (V=250 Nodes)...");
    generatePresetGraph("custom_250");

    const threadRuns = [1, 2, 4, 8, 16];
    const execTimes = []; // ms
    
    // Run Sequential Floyd-Warshall
    notify("Measuring Sequential Floyd-Warshall (Baseline, Thread=1)...");
    sim.mode = "sequential";
    let seqSum = 0;
    const runsCount = 3;
    for (let run = 0; run < runsCount; run++) {
      seqSum += await sim.calculateShortestPaths();
    }
    const tSeq = seqSum / runsCount;
    execTimes.push(tSeq);
    
    // Run Parallel Floyd-Warshall across thread sizes
    for (const t of threadRuns) {
      notify(`Measuring Parallel Floyd-Warshall with Thread=${t}...`);
      sim.mode = "parallel";
      sim.numThreads = t;
      await sim.initializeWorkerPool();
      
      // Update thread visualizer dynamically during benchmarks
      let barHtml = "";
      for (let w = 0; w < t; w++) {
        barHtml += `
          <div class="worker-bar-item">
            <div class="worker-bar-lbl">
              <span>Worker #${w + 1}</span>
              <span class="worker-bar-state" style="color:#a5b4fc">FW COMPUTE</span>
            </div>
            <div class="worker-bar-track">
              <div class="worker-bar-fill worker-fw"></div>
            </div>
          </div>
        `;
      }
      workerActivityList.innerHTML = barHtml;

      let parSum = 0;
      for (let run = 0; run < runsCount; run++) {
        parSum += await sim.calculateShortestPaths();
      }
      execTimes.push(parSum / runsCount);
    }

    // Terminate workers
    sim.workerPool.terminate();

    // Compile statistics
    const sequentialBaseline = execTimes[0];
    const results = {
      threads: [1, 2, 4, 8, 16],
      times: execTimes.slice(1), // parallel times
      speedup: [],
      efficiency: []
    };

    let bestParTime = Infinity;
    let maxSpeedup = -1;
    let optimalThreads = 1;

    for (let i = 0; i < results.threads.length; i++) {
      const tVal = results.threads[i];
      const pTime = results.times[i];
      if (pTime < bestParTime) bestParTime = pTime;

      const s_p = sequentialBaseline / pTime;
      const e_p = s_p / tVal;
      
      if (s_p > maxSpeedup) {
        maxSpeedup = s_p;
        optimalThreads = tVal;
      }

      results.speedup.push(s_p);
      results.efficiency.push(e_p);
    }

    // Render stats cards
    benchValSeq.textContent = sequentialBaseline.toFixed(1) + " ms";
    benchValPar.textContent = bestParTime.toFixed(1) + " ms";
    benchValSpeedup.textContent = maxSpeedup.toFixed(2) + "x";
    
    const peakEff = Math.round(results.efficiency[results.speedup.indexOf(maxSpeedup)] * 100);
    benchValEff.textContent = peakEff + "%";

    // Render scientific custom SVG charts
    renderSVGCharts(sequentialBaseline, results);
    
    // Draw Amdahl's Law automatically
    const s4 = results.speedup[2]; // 4 threads speedup
    const f = Math.max(0, ((1 / s4) - 0.25) / 0.75);

    amdahlAnalysis.innerHTML = `
      Hasil benchmark menunjukkan waktu eksekusi sekuensial adalah <strong>${sequentialBaseline.toFixed(1)} ms</strong>. 
      Kecepatan puncak (Max Speedup) sebesar <strong>${maxSpeedup.toFixed(2)}x</strong> dicapai pada alokasi <strong>${optimalThreads} thread</strong>.
      <br><br>
      Berdasarkan <strong>Hukum Amdahl</strong>, estimasi fraksi serial sistem ini adalah <strong>${(f * 100).toFixed(1)}%</strong>. 
      Hal ini mengonfirmasi adanya parallel overhead (manajemen barrier konkurensi di Web Worker, atomic locks, dan Shared Memory locking) yang membatasi speedup linear pada core CPU yang tinggi.
    `;

    // Restore state
    sim.mode = prevMode;
    sim.numThreads = prevThreads;
    await sim.initializeWorkerPool();
    
    // Resume drawing canvas
    benchResults.classList.remove("hidden");
    btnRunBenchmark.disabled = false;
    notify("Benchmark completed. Visual animation loop restored.");
    renderLoop();
  });

  // Custom SVG charting renderers
  function renderSVGCharts(seqVal, data) {
    // 1. Time Chart
    let svgTime = `<svg width="100%" height="100%" viewBox="0 0 300 150" style="background:#1f293700">`;
    for (let y = 20; y <= 120; y += 25) {
      svgTime += `<line x1="40" y1="${y}" x2="280" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
    }
    // Plot Sequential line (Horizontal)
    svgTime += `<line x1="40" y1="35" x2="280" y2="35" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="3,3"/>`;
    svgTime += `<text x="210" y="30" fill="#ef4444" font-size="8">Seq Baseline</text>`;
    
    // Plot Parallel line
    const getScaledY = (val) => {
      const maxVal = Math.max(seqVal, ...data.times);
      return 120 - (val / maxVal) * 90;
    };
    
    const xCoords = [60, 110, 160, 210, 260];
    let pathPoints = "";
    for (let i = 0; i < data.times.length; i++) {
      const x = xCoords[i];
      const y = getScaledY(data.times[i]);
      pathPoints += `${i === 0 ? "M" : "L"} ${x} ${y}`;
      svgTime += `<circle cx="${x}" cy="${y}" r="3" fill="#60a5fa"/>`;
      svgTime += `<text x="${x}" y="${y - 8}" fill="#60a5fa" font-size="8" text-anchor="middle">${data.times[i].toFixed(0)}ms</text>`;
    }
    svgTime += `<path d="${pathPoints}" fill="none" stroke="#3b82f6" stroke-width="2"/>`;
    
    // X Axis labels
    for (let i = 0; i < data.threads.length; i++) {
      svgTime += `<text x="${xCoords[i]}" y="138" fill="#9ca3af" font-size="8" text-anchor="middle">${data.threads[i]}T</text>`;
    }
    svgTime += `</svg>`;
    chartExecTime.innerHTML = svgTime;

    // 2. Speedup Chart
    let svgSpeedup = `<svg width="100%" height="100%" viewBox="0 0 300 150">`;
    svgSpeedup += `<line x1="40" y1="120" x2="280" y2="20" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="3,3"/>`;
    for (let y = 20; y <= 120; y += 25) {
      svgSpeedup += `<line x1="40" y1="${y}" x2="280" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
    }
    
    // Scale: map 0 to 16 speedup to 120 to 20
    const getSpeedupY = (val) => 120 - (val / 16) * 100;
    
    let pathSpeedup = "";
    for (let i = 0; i < data.speedup.length; i++) {
      const x = xCoords[i];
      const y = getSpeedupY(data.speedup[i]);
      pathSpeedup += `${i === 0 ? "M" : "L"} ${x} ${y}`;
      svgSpeedup += `<circle cx="${x}" cy="${y}" r="3" fill="#fbbf24"/>`;
      svgSpeedup += `<text x="${x}" y="${y - 8}" fill="#fbbf24" font-size="8" text-anchor="middle">${data.speedup[i].toFixed(1)}x</text>`;
    }
    svgSpeedup += `<path d="${pathSpeedup}" fill="none" stroke="#f59e0b" stroke-width="2"/>`;
    
    for (let i = 0; i < data.threads.length; i++) {
      svgSpeedup += `<text x="${xCoords[i]}" y="138" fill="#9ca3af" font-size="8" text-anchor="middle">${data.threads[i]}T</text>`;
    }
    svgSpeedup += `</svg>`;
    chartSpeedup.innerHTML = svgSpeedup;

    // 3. Efficiency Chart
    let svgEff = `<svg width="100%" height="100%" viewBox="0 0 300 150">`;
    svgEff += `<line x1="40" y1="20" x2="280" y2="20" stroke="rgba(16,185,129,0.2)" stroke-width="1"/>`;
    for (let y = 20; y <= 120; y += 25) {
      svgEff += `<line x1="40" y1="${y}" x2="280" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
    }
    
    // Scale: map efficiency 0.0 to 1.0 to 120 to 20
    const getEffY = (val) => 120 - val * 100;
    
    let pathEff = "";
    for (let i = 0; i < data.efficiency.length; i++) {
      const x = xCoords[i];
      const y = getEffY(data.efficiency[i]);
      pathEff += `${i === 0 ? "M" : "L"} ${x} ${y}`;
      svgEff += `<circle cx="${x}" cy="${y}" r="3" fill="#34d399"/>`;
      svgEff += `<text x="${x}" y="${y - 8}" fill="#34d399" font-size="8" text-anchor="middle">${(data.efficiency[i]*100).toFixed(0)}%</text>`;
    }
    svgEff += `<path d="${pathEff}" fill="none" stroke="#10b981" stroke-width="2"/>`;
    
    for (let i = 0; i < data.threads.length; i++) {
      svgEff += `<text x="${xCoords[i]}" y="138" fill="#9ca3af" font-size="8" text-anchor="middle">${data.threads[i]}T</text>`;
    }
    svgEff += `</svg>`;
    chartEfficiency.innerHTML = svgEff;
  }
});
