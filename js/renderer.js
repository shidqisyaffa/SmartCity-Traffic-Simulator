/**
 * SmartCity Traffic Simulator - Renderer Module (js/renderer.js)
 * Visualizes graph structures, vehicle states, and traffic congestion heatmaps on HTML5 Canvas.
 * Supports Panning, Zooming, Presentation Mode, and Adaptive Level-of-Detail (LOD).
 */

import { MAX_VERTICES } from './graph.js';
import { MAX_VEHICLES } from './simulation.js';

export class CanvasRenderer {
  constructor(canvas, simulation) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sim = simulation;
    
    // Zoom and Panning State
    this.scale = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.padding = 50;
    
    this.zoomLevel = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;

    // Interactive Selection
    this.selectedVehicleId = null;
    
    // Toggle switch for Presentation Mode
    this.presentationMode = false;

    // Styling themes (Curated dark mode theme)
    this.theme = {
      bg: "#0B0F19",           // Deep Blue-Grey 950
      node: "#1F2937",         // Grey 800
      nodeBorder: "#4F46E5",   // Indigo 600
      nodeText: "#F3F4F6",     // Grey 100
      nodeTextBrd: "#0B0F19",  
      road: "#374151",         // Grey 700
      roadBlocked: "#EF4444",  // Red 500
      
      // Heatmap density glows (translucent values)
      heatLancar: "rgba(16, 185, 129, 0.4)",  // Emerald
      heatPadat: "rgba(245, 158, 11, 0.4)",   // Amber
      heatMacet: "rgba(249, 115, 22, 0.4)",   // Orange
      heatGridlock: "rgba(239, 68, 68, 0.5)", // Red
      
      // Vehicle colors
      car: "#60A5FA",          // Sky Blue
      motorbike: "#F59E0B",    // Amber
      bus: "#EC4899",          // Pink
      stuck: "#EF4444",        // Red
      waiting: "#10B981",       // Emerald
      
      // Selection highlight
      selectedPath: "#06B6D4", // Cyan 500
      hudBg: "rgba(17, 24, 39, 0.85)",
      hudBrd: "rgba(255, 255, 255, 0.08)"
    };
  }

  /**
   * Convert World (Simulation Graph) coordinate to Screen coordinate.
   */
  toScreen(worldX, worldY) {
    return {
      x: (worldX * this.scale * this.zoomLevel) + this.offsetX + this.panX,
      y: (worldY * this.scale * this.zoomLevel) + this.offsetY + this.panY
    };
  }

  /**
   * Convert Screen coordinate to World (Simulation Graph) coordinate.
   */
  toWorld(screenX, screenY) {
    return {
      x: ((screenX - this.offsetX - this.panX) / this.zoomLevel) / this.scale,
      y: ((screenY - this.offsetY - this.panY) / this.zoomLevel) / this.scale
    };
  }

  /**
   * Automatically calculate scaling and offset factors to fit the graph on Canvas.
   */
  fitToCanvas() {
    const V = this.sim.getGraphBoundary();
    if (V === 0) return;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let count = 0;

    for (let i = 0; i < V; i++) {
      if (this.sim.graph.activeNodes[i] === 1) {
        const x = this.sim.graph.coords[i * 2];
        const y = this.sim.graph.coords[i * 2 + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        count++;
      }
    }

    if (count === 0) return;

    const graphWidth = maxX - minX || 1;
    const graphHeight = maxY - minY || 1;

    const availableWidth = this.canvas.width - this.padding * 2;
    const availableHeight = this.canvas.height - this.padding * 2;

    this.scale = Math.min(availableWidth / graphWidth, availableHeight / graphHeight);
    
    // Center alignment offsets
    this.offsetX = this.padding - minX * this.scale + (availableWidth - graphWidth * this.scale) / 2;
    this.offsetY = this.padding - minY * this.scale + (availableHeight - graphHeight * this.scale) / 2;
  }

  /**
   * Reset Zoom and Pan parameters to default auto-fit.
   */
  resetView() {
    this.zoomLevel = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.fitToCanvas();
  }

  /**
   * Draw the entire simulation frame.
   */
  draw() {
    // 0. Setup state and level of detail
    const V = this.sim.getGraphBoundary();
    const activeVehicles = this.sim.activeVehicles;
    const isLODActive = activeVehicles > 2000 && !this.presentationMode;

    // Apply canvas scaling on high resolution screens
    this.ctx.fillStyle = this.theme.bg;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (V === 0) return;

    // Calculate initial scale/offset if first run
    if (this.scale === 1.0 && this.offsetX === 0) {
      this.fitToCanvas();
    }

    // 1. Gather edge congestion metrics
    const edgeVehiclesCount = {};
    const edgeCapacity = 12; // Capacity base for density calculations

    for (let i = 0; i < this.sim.totalVehicles; i++) {
      const state = this.sim.vehicleIntsView[i * 8 + 2];
      if (state === 1 || state === 2) { // Moving / Waiting
        const currentPathIdx = this.sim.vehicleIntsView[i * 8 + 5];
        const vPathOffset = i * 100;
        const u = this.sim.vehiclePathsView[vPathOffset + currentPathIdx];
        const v = this.sim.vehiclePathsView[vPathOffset + currentPathIdx + 1];
        
        if (u !== undefined && v !== undefined) {
          const key = `${u}->${v}`;
          edgeVehiclesCount[key] = (edgeVehiclesCount[key] || 0) + 1;
        }
      }
    }

    // 2. Draw Selected Vehicle Path Highlight (Cyan pulsing route)
    if (this.selectedVehicleId !== null && this.selectedVehicleId < this.sim.totalVehicles) {
      const vState = this.sim.vehicleIntsView[this.selectedVehicleId * 8 + 2];
      if (vState === 1 || vState === 2) { // Active
        this.drawSelectedPathHighlight(isLODActive);
      }
    }

    // 3. Draw Road Segments (Edges) & Heatmaps
    for (let i = 0; i < V; i++) {
      if (this.sim.graph.activeNodes[i] !== 1) continue;
      const uCoords = this.toScreen(this.sim.graph.coords[i * 2], this.sim.graph.coords[i * 2 + 1]);

      for (let j = 0; j < V; j++) {
        if (this.sim.graph.activeNodes[j] !== 1 || i === j) continue;

        const w = this.sim.graph.weights[i * MAX_VERTICES + j];
        if (w === Infinity) continue;

        const vCoords = this.toScreen(this.sim.graph.coords[j * 2], this.sim.graph.coords[j * 2 + 1]);
        const isBlocked = this.sim.graph.blocked[i * MAX_VERTICES + j] === 1;

        // Angle & lane shift offset calculations
        const angle = Math.atan2(vCoords.y - uCoords.y, vCoords.x - uCoords.x);
        const laneShiftDist = this.presentationMode ? 5 : 3.5;
        const shiftX = Math.sin(angle) * laneShiftDist;
        const shiftY = -Math.cos(angle) * laneShiftDist;

        const startX = uCoords.x + shiftX;
        const startY = uCoords.y + shiftY;
        const endX = vCoords.x + shiftX;
        const endY = vCoords.y + shiftY;

        const activeOnEdge = edgeVehiclesCount[`${i}->${j}`] || 0;
        const density = Math.min(activeOnEdge / edgeCapacity, 1.0);

        // A. Draw Heatmap Glowing Underlay (Disable in LOD to boost FPS)
        if (!isBlocked && !isLODActive && density > 0.05) {
          this.ctx.beginPath();
          this.ctx.moveTo(startX, startY);
          this.ctx.lineTo(endX, endY);
          
          let glowColor = this.theme.heatLancar;
          if (density > 0.9) glowColor = this.theme.heatGridlock;
          else if (density > 0.6) glowColor = this.theme.heatMacet;
          else if (density > 0.2) glowColor = this.theme.heatPadat;
          
          this.ctx.strokeStyle = glowColor;
          this.ctx.lineWidth = this.presentationMode ? 14 : 9;
          this.ctx.lineCap = "round";
          this.ctx.stroke();
        }

        // B. Draw Main Road Segment
        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        this.ctx.lineTo(endX, endY);
        
        let roadColor = this.theme.road;
        let roadWidth = this.presentationMode ? 3.5 : 2;

        if (isBlocked) {
          roadColor = this.theme.roadBlocked;
          roadWidth = this.presentationMode ? 4 : 2.5;
          this.ctx.setLineDash([6, 4]); // dashed closed road indicator
        } else {
          this.ctx.setLineDash([]);
          // Edge weight color highlight if congested
          if (density > 0.6) {
            roadColor = density > 0.9 ? "#EF4444" : "#F97316";
          }
        }

        this.ctx.strokeStyle = roadColor;
        this.ctx.lineWidth = roadWidth;
        this.ctx.stroke();
        this.ctx.setLineDash([]); // Reset dash

        // C. Draw Directional Arrows (only if roads are not blocked)
        if (!isBlocked) {
          this.drawArrow(startX, startY, endX, endY, roadColor, angle);
        }

        // D. Draw Cost (Weight) Labels along road segments (Skip in LOD or high zoom out)
        if (!isLODActive && this.zoomLevel >= 0.7 && !isBlocked) {
          const midX = (startX + endX) / 2 - Math.sin(angle) * 8;
          const midY = (startY + endY) / 2 + Math.cos(angle) * 8;
          
          this.ctx.fillStyle = "rgba(156, 163, 175, 0.65)"; // translucent grey
          this.ctx.font = "8px monospace";
          this.ctx.textAlign = "center";
          this.ctx.textBaseline = "middle";
          this.ctx.fillText(w.toFixed(0), midX, midY);
        }
      }
    }

    // 4. Draw Intersections (Nodes)
    for (let i = 0; i < V; i++) {
      if (this.sim.graph.activeNodes[i] !== 1) continue;
      const coords = this.toScreen(this.sim.graph.coords[i * 2], this.sim.graph.coords[i * 2 + 1]);

      const nodeRadius = this.presentationMode ? 14 : 11;

      // Draw subtle shadow glow on active nodes in Presentation mode
      if (this.presentationMode) {
        this.ctx.shadowColor = "rgba(79, 70, 229, 0.4)";
        this.ctx.shadowBlur = 10;
      }

      this.ctx.beginPath();
      this.ctx.arc(coords.x, coords.y, nodeRadius, 0, Math.PI * 2);
      this.ctx.fillStyle = this.theme.node;
      this.ctx.strokeStyle = this.theme.nodeBorder;
      this.ctx.lineWidth = this.presentationMode ? 3.5 : 2;
      this.ctx.fill();
      this.ctx.stroke();
      
      this.ctx.shadowBlur = 0; // Reset shadow

      // Label text
      this.ctx.fillStyle = this.theme.nodeText;
      this.ctx.font = `bold ${this.presentationMode ? 11 : 9}px 'Inter', sans-serif`;
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(i.toString(), coords.x, coords.y);
    }

    // 5. Draw Vehicles (Smooth oriented shapes)
    for (let i = 0; i < this.sim.totalVehicles; i++) {
      const state = this.sim.vehicleIntsView[i * 8 + 2];
      if (state !== 1 && state !== 2 && state !== 3) continue; // Skip finished

      const currentX = this.sim.vehicleFloatsView[i * 8 + 3];
      const currentY = this.sim.vehicleFloatsView[i * 8 + 4];
      const targetX = this.sim.vehicleFloatsView[i * 8 + 5];
      const targetY = this.sim.vehicleFloatsView[i * 8 + 6];

      const coords = this.toScreen(currentX, currentY);
      const type = this.sim.vehicleIntsView[i * 8 + 1];

      // Draw standard circles in LOD mode to maximize performance
      if (isLODActive) {
        this.drawLODVehicle(coords.x, coords.y, type, state);
      } else {
        // Calculate orientation angle facing motion
        const angle = Math.atan2(targetY - currentY, targetX - currentX);
        this.drawOrientedVehicle(coords.x, coords.y, type, state, angle, i === this.selectedVehicleId);
      }
    }

    // 6. Draw HUD Overlays (Legends & Info Boxes)
    this.drawHUDOverlays();
  }

  /**
   * Draw lightweight dot for vehicles in high workload level-of-detail.
   */
  drawLODVehicle(x, y, type, state) {
    let color = this.theme.car;
    if (type === 1) color = this.theme.motorbike;
    else if (type === 2) color = this.theme.bus;

    if (state === 3) color = this.theme.stuck;

    this.ctx.beginPath();
    this.ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();
  }

  /**
   * Draw styled oriented shapes for vehicles.
   */
  drawOrientedVehicle(x, y, type, state, angle, isSelected) {
    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(angle);

    let vehicleColor = this.theme.car;
    let width = 11;
    let height = 6.5;

    if (type === 1) { // Motorbike
      vehicleColor = this.theme.motorbike;
      width = 7.5;
      height = 3.5;
    } else if (type === 2) { // Bus
      vehicleColor = this.theme.bus;
      width = 18;
      height = 8.5;
    }

    // A. Draw glowing status border if waiting or stuck
    if (state === 3) { // Stuck (pulsing red glow)
      const pulse = 2.5 + Math.sin(Date.now() / 150) * 1.5;
      this.ctx.shadowColor = this.theme.stuck;
      this.ctx.shadowBlur = pulse * 2.5;
      this.ctx.strokeStyle = this.theme.stuck;
      this.ctx.lineWidth = 1.5;
      this.ctx.strokeRect(-width/2 - pulse/2, -height/2 - pulse/2, width + pulse, height + pulse);
    } else if (state === 2) { // Waiting at intersection (pulsing green glow)
      const pulse = 1.5 + Math.sin(Date.now() / 200) * 1.0;
      this.ctx.shadowColor = this.theme.waiting;
      this.ctx.shadowBlur = pulse * 2;
      this.ctx.strokeStyle = this.theme.waiting;
      this.ctx.lineWidth = 1.2;
      this.ctx.strokeRect(-width/2 - pulse/2, -height/2 - pulse/2, width + pulse, height + pulse);
    }

    // B. Draw Selected visual indicators
    if (isSelected) {
      this.ctx.strokeStyle = this.theme.selectedPath;
      this.ctx.lineWidth = 2.5;
      this.ctx.strokeRect(-width/2 - 3, -height/2 - 3, width + 6, height + 6);
      
      // Floating indicator dot on top
      this.ctx.fillStyle = this.theme.selectedPath;
      this.ctx.beginPath();
      this.ctx.arc(0, -height/2 - 6, 3, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // C. Draw vehicle body
    this.ctx.fillStyle = vehicleColor;
    if (type === 1) { // Motor capsule shape
      this.drawCapsule(-width/2, -height/2, width, height);
    } else { // Car/Bus rounded rect
      this.drawRoundedRect(-width/2, -height/2, width, height, type === 2 ? 1.5 : 2);
    }

    // D. Details: Headlamp beams (only if in presentation mode)
    if (this.presentationMode) {
      this.ctx.fillStyle = "rgba(254, 243, 199, 0.4)"; // warm white beam
      this.ctx.beginPath();
      this.ctx.moveTo(width/2, -height/4);
      this.ctx.lineTo(width/2 + 10, -height/2 - 4);
      this.ctx.lineTo(width/2 + 10, height/2 + 4);
      this.ctx.lineTo(width/2, height/4);
      this.ctx.closePath();
      this.ctx.fill();
    }

    // Wheels & detailing
    this.ctx.fillStyle = "#111"; // black
    if (type === 2) { // Bus windows
      this.ctx.fillRect(-width/2 + 3, -height/2 + 1.5, 3, height - 3);
      this.ctx.fillRect(-width/2 + 8, -height/2 + 1.5, 3, height - 3);
      this.ctx.fillRect(-width/2 + 13, -height/2 + 1.5, 3, height - 3);
    } else if (type === 0) { // Car windshield
      this.ctx.fillRect(-width/2 + 2, -height/2 + 1, 2, height - 2);
    }

    this.ctx.restore();
  }

  // Draw helpers
  drawRoundedRect(x, y, w, h, r) {
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.lineTo(x + w - r, y);
    this.ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    this.ctx.lineTo(x + w, y + h - r);
    this.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.ctx.lineTo(x + r, y + h);
    this.ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    this.ctx.lineTo(x, y + r);
    this.ctx.quadraticCurveTo(x, y, x + r, y);
    this.ctx.closePath();
    this.ctx.fill();
  }

  drawCapsule(x, y, w, h) {
    this.ctx.beginPath();
    const r = h / 2;
    this.ctx.arc(x + r, y + r, r, Math.PI/2, Math.PI*1.5);
    this.ctx.lineTo(x + w - r, y);
    this.ctx.arc(x + w - r, y + r, r, Math.PI*1.5, Math.PI/2);
    this.ctx.closePath();
    this.ctx.fill();
  }

  /**
   * Draws a cyan glowing path representing the selected vehicle route.
   */
  drawSelectedPathHighlight(isLODActive) {
    const vOffset = this.selectedVehicleId * 8;
    const vPathOffset = this.selectedVehicleId * 100;
    
    const currentPathIdx = this.sim.vehicleIntsView[vOffset + 5];
    const pathLength = this.sim.vehicleIntsView[vOffset + 6];

    if (currentPathIdx >= pathLength - 1) return;

    this.ctx.save();
    this.ctx.beginPath();

    // Map starting from current vehicle position
    const currentX = this.sim.vehicleFloatsView[vOffset + 3];
    const currentY = this.sim.vehicleFloatsView[vOffset + 4];
    const startCoords = this.toScreen(currentX, currentY);
    this.ctx.moveTo(startCoords.x, startCoords.y);

    // Chain lines to remaining path nodes
    for (let p = currentPathIdx + 1; p < pathLength; p++) {
      const node = this.sim.vehiclePathsView[vPathOffset + p];
      if (node !== undefined && this.sim.graph.activeNodes[node] === 1) {
        const coords = this.toScreen(this.sim.graph.coords[node * 2], this.sim.graph.coords[node * 2 + 1]);
        this.ctx.lineTo(coords.x, coords.y);
      }
    }

    // Visual attributes of highlighted path
    this.ctx.strokeStyle = this.theme.selectedPath;
    this.ctx.lineWidth = this.presentationMode ? 5 : 3.5;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    
    // Ant marching animated path
    const dashOffset = (Date.now() / 45) % 24;
    this.ctx.setLineDash([8, 4]);
    this.ctx.lineDashOffset = -dashOffset;

    // Glowing blur effect in Presentation Mode
    if (!isLODActive && this.presentationMode) {
      this.ctx.shadowColor = this.theme.selectedPath;
      this.ctx.shadowBlur = 12;
    }

    this.ctx.stroke();
    this.ctx.restore();
  }

  /**
   * Draw directions on edges
   */
  drawArrow(fromx, fromy, tox, toy, color, angle) {
    const headlen = this.presentationMode ? 8.5 : 6.5; // length of head in pixels
    const dx = tox - fromx;
    const dy = toy - fromy;
    
    // Draw arrow at 70% along the path length
    const arrowX = fromx + dx * 0.7;
    const arrowY = fromy + dy * 0.7;

    this.ctx.beginPath();
    this.ctx.moveTo(arrowX, arrowY);
    this.ctx.lineTo(arrowX - headlen * Math.cos(angle - Math.PI / 6), arrowY - headlen * Math.sin(angle - Math.PI / 6));
    this.ctx.moveTo(arrowX, arrowY);
    this.ctx.lineTo(arrowX - headlen * Math.cos(angle + Math.PI / 6), arrowY - headlen * Math.sin(angle + Math.PI / 6));
    
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = this.presentationMode ? 2.5 : 1.5;
    this.ctx.stroke();
  }

  /**
   * Draw Canvas legends and HUD.
   */
  drawHUDOverlays() {
    this.ctx.save();
    
    // Increase size of boxes in Presentation Mode
    const boxScale = this.presentationMode ? 1.15 : 1.0;

    // C. Draw Selected Vehicle Info HUD Overlay
    if (this.selectedVehicleId !== null && this.selectedVehicleId < this.sim.totalVehicles) {
      const vOffset = this.selectedVehicleId * 8;
      const state = this.sim.vehicleIntsView[vOffset + 2];
      
      if (state === 1 || state === 2 || state === 3) {
        const id = this.sim.vehicleIntsView[vOffset];
        const type = this.sim.vehicleIntsView[vOffset + 1];
        const speed = this.sim.vehicleFloatsView[vOffset + 1];
        const travelTime = this.sim.vehicleFloatsView[vOffset + 2];
        const progress = this.sim.vehicleFloatsView[vOffset] * 100;
        
        const typeStr = type === 0 ? "Mobil" : type === 1 ? "Motor" : "Bus";
        const stateStr = state === 1 ? "Moving" : state === 2 ? "Waiting" : "Stuck";

        const hudW = 160 * boxScale;
        const hudH = 80 * boxScale;
        const hudX = 15;
        const hudY = this.canvas.height - hudH - 95; // above zoom buttons

        this.ctx.fillStyle = this.theme.hudBg;
        this.ctx.strokeStyle = this.theme.selectedPath;
        this.ctx.lineWidth = 1.5;
        this.drawRoundedRect(hudX, hudY, hudW, hudH, 10);
        this.ctx.stroke();

        this.ctx.fillStyle = this.theme.nodeText;
        this.ctx.font = `bold ${this.presentationMode ? 11 : 9.5}px 'Inter', sans-serif`;
        this.ctx.fillText(`🔍 Selected Vehicle #${id}`, hudX + 10, hudY + 16 * boxScale);

        this.ctx.font = `${this.presentationMode ? 10 : 8.5}px monospace`;
        this.ctx.fillStyle = varColor(this.theme.nodeText, 0.8);
        this.ctx.fillText(`Type  : ${typeStr} (${stateStr})`, hudX + 10, hudY + 32 * boxScale);
        this.ctx.fillText(`Speed : ${speed.toFixed(1)} px/s`, hudX + 10, hudY + 44 * boxScale);
        this.ctx.fillText(`Time  : ${travelTime.toFixed(1)} s`, hudX + 10, hudY + 56 * boxScale);
        this.ctx.fillText(`Prog  : ${progress.toFixed(0)}%`, hudX + 10, hudY + 68 * boxScale);
      }
    }

    this.ctx.restore();
  }
}

// Helpers
function varColor(hex, opacity) {
  // Simple hex to rgba convert
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
