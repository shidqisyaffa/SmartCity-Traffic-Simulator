/**
 * SmartCity Traffic Simulator - Graph Module (js/graph.js)
 * Manages the city graph G=(V,E) using pre-allocated typed arrays.
 * Supports SharedArrayBuffer for zero-copy thread sharing.
 */

export const MAX_VERTICES = 1000;

export class CityGraph {
  constructor(sharedBuffers = null) {
    if (sharedBuffers) {
      // Use pre-allocated SharedArrayBuffers
      this.isShared = true;
      this.weights = new Float32Array(sharedBuffers.weights);
      this.blocked = new Int32Array(sharedBuffers.blocked);
      this.coords = new Float32Array(sharedBuffers.coords);
      this.activeNodes = new Uint8Array(sharedBuffers.activeNodes);
    } else {
      // Fallback to local non-shared ArrayBuffers (e.g. if SAB is not supported or for testing)
      this.isShared = false;
      this.weights = new Float32Array(MAX_VERTICES * MAX_VERTICES);
      this.blocked = new Int32Array(MAX_VERTICES * MAX_VERTICES);
      this.coords = new Float32Array(MAX_VERTICES * 2);
      this.activeNodes = new Uint8Array(MAX_VERTICES);
      this.clear();
    }
  }

  /**
   * Reset graph to empty state.
   */
  clear() {
    this.weights.fill(Infinity);
    this.blocked.fill(0);
    this.coords.fill(0);
    this.activeNodes.fill(0);
    
    // Self-edges have 0 weight
    for (let i = 0; i < MAX_VERTICES; i++) {
      this.weights[i * MAX_VERTICES + i] = 0;
    }
  }

  /**
   * Add a new vertex (intersection) to the graph.
   * @param {number} id - Node ID (0 to MAX_VERTICES - 1)
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   */
  addVertex(id, x, y) {
    if (id < 0 || id >= MAX_VERTICES) {
      console.error(`Vertex ID ${id} is out of bounds (0-${MAX_VERTICES - 1})`);
      return false;
    }
    this.activeNodes[id] = 1;
    this.coords[id * 2] = x;
    this.coords[id * 2 + 1] = y;
    return true;
  }

  /**
   * Remove a vertex and all its incident edges.
   * @param {number} id - Node ID
   */
  removeVertex(id) {
    if (id < 0 || id >= MAX_VERTICES || !this.activeNodes[id]) return false;

    this.activeNodes[id] = 0;
    this.coords[id * 2] = 0;
    this.coords[id * 2 + 1] = 0;

    // Clear incident edges
    for (let i = 0; i < MAX_VERTICES; i++) {
      // Outgoing edges
      this.weights[id * MAX_VERTICES + i] = (id === i) ? 0 : Infinity;
      this.blocked[id * MAX_VERTICES + i] = 0;
      
      // Incoming edges
      this.weights[i * MAX_VERTICES + id] = (id === i) ? 0 : Infinity;
      this.blocked[i * MAX_VERTICES + id] = 0;
    }
    return true;
  }

  /**
   * Add or update an edge (road segment).
   * @param {number} from - Origin Node ID
   * @param {number} to - Destination Node ID
   * @param {number} weight - Cost/Travel duration (must be > 0)
   * @param {boolean} isTwoWay - True if bidirected road
   */
  addEdge(from, to, weight, isTwoWay = true) {
    if (from < 0 || from >= MAX_VERTICES || to < 0 || to >= MAX_VERTICES) return false;
    if (!this.activeNodes[from] || !this.activeNodes[to]) return false;
    if (weight <= 0) return false;

    this.weights[from * MAX_VERTICES + to] = weight;
    this.blocked[from * MAX_VERTICES + to] = 0;

    if (isTwoWay) {
      this.weights[to * MAX_VERTICES + from] = weight;
      this.blocked[to * MAX_VERTICES + from] = 0;
    }
    return true;
  }

  /**
   * Remove an edge.
   */
  removeEdge(from, to, isTwoWay = true) {
    if (from < 0 || from >= MAX_VERTICES || to < 0 || to >= MAX_VERTICES) return false;
    
    this.weights[from * MAX_VERTICES + to] = Infinity;
    this.blocked[from * MAX_VERTICES + to] = 0;

    if (isTwoWay) {
      this.weights[to * MAX_VERTICES + from] = Infinity;
      this.blocked[to * MAX_VERTICES + from] = 0;
    }
    return true;
  }

  /**
   * Block a road segment (temporary closure).
   */
  blockRoad(from, to, isTwoWay = true) {
    if (from < 0 || from >= MAX_VERTICES || to < 0 || to >= MAX_VERTICES) return false;
    
    this.blocked[from * MAX_VERTICES + to] = 1;
    if (isTwoWay) {
      this.blocked[to * MAX_VERTICES + from] = 1;
    }
    return true;
  }

  /**
   * Unblock a road segment.
   */
  unblockRoad(from, to, isTwoWay = true) {
    if (from < 0 || from >= MAX_VERTICES || to < 0 || to >= MAX_VERTICES) return false;
    
    this.blocked[from * MAX_VERTICES + to] = 0;
    if (isTwoWay) {
      this.blocked[to * MAX_VERTICES + from] = 0;
    }
    return true;
  }

  /**
   * Get the weight of an edge, taking blocked status into account.
   */
  getWeight(from, to) {
    if (from < 0 || from >= MAX_VERTICES || to < 0 || to >= MAX_VERTICES) return Infinity;
    if (!this.activeNodes[from] || !this.activeNodes[to]) return Infinity;
    if (this.blocked[from * MAX_VERTICES + to] === 1) return Infinity;
    return this.weights[from * MAX_VERTICES + to];
  }

  /**
   * Check if edge is blocked.
   */
  isBlocked(from, to) {
    if (from < 0 || from >= MAX_VERTICES || to < 0 || to >= MAX_VERTICES) return false;
    return this.blocked[from * MAX_VERTICES + to] === 1;
  }

  /**
   * Get all active adjacent vertices of a node.
   */
  getAdjacentNodes(nodeId) {
    const list = [];
    if (nodeId < 0 || nodeId >= MAX_VERTICES || !this.activeNodes[nodeId]) return list;

    for (let i = 0; i < MAX_VERTICES; i++) {
      if (this.activeNodes[i] && i !== nodeId) {
        const w = this.weights[nodeId * MAX_VERTICES + i];
        if (w !== Infinity) {
          list.push({
            id: i,
            weight: w,
            blocked: this.blocked[nodeId * MAX_VERTICES + i] === 1
          });
        }
      }
    }
    return list;
  }

  /**
   * Export graph layout configurations to JSON.
   */
  exportToJSON() {
    const nodes = [];
    const edges = [];

    for (let i = 0; i < MAX_VERTICES; i++) {
      if (this.activeNodes[i]) {
        nodes.push({
          id: i,
          x: this.coords[i * 2],
          y: this.coords[i * 2 + 1]
        });
      }
    }

    for (let i = 0; i < MAX_VERTICES; i++) {
      if (this.activeNodes[i]) {
        for (let j = 0; j < MAX_VERTICES; j++) {
          if (this.activeNodes[j] && i < j) { // Export each undirected edge once, or check directedness
            const wDirect = this.weights[i * MAX_VERTICES + j];
            const wReverse = this.weights[j * MAX_VERTICES + i];
            
            if (wDirect !== Infinity || wReverse !== Infinity) {
              const isTwoWay = (wDirect === wReverse) && 
                               (this.blocked[i * MAX_VERTICES + j] === this.blocked[j * MAX_VERTICES + i]);
              
              if (isTwoWay) {
                edges.push({
                  from: i,
                  to: j,
                  weight: wDirect,
                  blocked: this.blocked[i * MAX_VERTICES + j] === 1,
                  isTwoWay: true
                });
              } else {
                if (wDirect !== Infinity) {
                  edges.push({
                    from: i,
                    to: j,
                    weight: wDirect,
                    blocked: this.blocked[i * MAX_VERTICES + j] === 1,
                    isTwoWay: false
                  });
                }
                if (wReverse !== Infinity) {
                  edges.push({
                    from: j,
                    to: i,
                    weight: wReverse,
                    blocked: this.blocked[j * MAX_VERTICES + i] === 1,
                    isTwoWay: false
                  });
                }
              }
            }
          }
        }
      }
    }

    return JSON.stringify({ nodes, edges }, null, 2);
  }

  /**
   * Import graph layout from JSON.
   */
  importFromJSON(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      this.clear();

      if (data.nodes) {
        for (const n of data.nodes) {
          this.addVertex(n.id, n.x, n.y);
        }
      }

      if (data.edges) {
        for (const e of data.edges) {
          this.addEdge(e.from, e.to, e.weight, e.isTwoWay ?? true);
          if (e.blocked) {
            this.blockRoad(e.from, e.to, e.isTwoWay ?? true);
          }
        }
      }
      return true;
    } catch (e) {
      console.error("Failed to import graph JSON:", e);
      return false;
    }
  }
}
