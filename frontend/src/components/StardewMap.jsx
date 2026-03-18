import { useRef, useEffect, useState, useCallback } from 'react';
import { getMap, getStatus, getBiomes, getAllBiomeDetails, getFoodChain } from '../data';
const TILE_SIZE = 12;        // pixels per grid cell
const SPRITE_SIZE = 28;      // pokemon sprite render size
const MAX_AGENTS = 2000;

// Stardew Valley inspired biome colors (pixel-art style, warm and inviting)
const BIOME_COLORS = {
  7:  '#4a8db7',   // sea — calm blue
  9:  '#5bb5a6',   // waters-edge — teal
  2:  '#3d8c3d',   // forest — rich green
  3:  '#7cbd4f',   // grassland — bright green
  6:  '#b08858',   // rough-terrain — earthy brown
  4:  '#9a95a0',   // mountain — cool gray
  1:  '#5c4a3d',   // cave — dark brown
  8:  '#8878a0',   // urban — dusty purple
  5:  '#d4a844',   // rare — golden
};

// Map raw biome colors to base IDs (for split biomes)
const ORIG_COLORS = {
  7: [30, 100, 200], 9: [70, 170, 190], 2: [34, 120, 50],
  3: [140, 180, 60], 6: [150, 110, 70], 4: [160, 160, 170],
  1: [80, 60, 50], 8: [130, 100, 150], 5: [220, 190, 60],
};

function matchBaseId(rawColor) {
  let best = 3, bestD = Infinity;
  for (const [id, c] of Object.entries(ORIG_COLORS)) {
    const d = Math.abs(rawColor[0]-c[0]) + Math.abs(rawColor[1]-c[1]) + Math.abs(rawColor[2]-c[2]);
    if (d < bestD) { bestD = d; best = parseInt(id); }
  }
  return best;
}

// Deterministic PRNG
function mulberry32(seed) {
  let t = seed + 0x6D2B79F5;
  return function () {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
// AGENT SYSTEM
// ============================================================

function createAgent(x, y, speciesId, biomeId, rng) {
  return {
    x, y,
    homeX: x, homeY: y,
    vx: (rng() - 0.5) * 0.3,
    vy: (rng() - 0.5) * 0.3,
    speciesId,
    biomeId,
    facingRight: rng() > 0.5,
    bobPhase: rng() * Math.PI * 2,
    state: 'walk', // walk, idle, eat, flee
    stateTimer: rng() * 120,
    // visual
    alpha: 1.0,
  };
}

function updateAgent(a, dtMs, allAgents, spatialGrid, gridW, gridH, foodChainPrey, foodChainPredators) {
  // Normalize dt to seconds (requestAnimationFrame gives ms)
  const dt = dtMs / 1000;

  // ---- Tuning constants (all in pixels/second) ----
  // Map is 2400x2400px. At default zoom, need visible movement.
  const WANDER_FORCE = 400;       // strong random walk
  const HOME_PULL = 25;           // pull back toward spawn area
  const HOME_RADIUS = 120;        // start pulling beyond this distance

  // Flocking (same species)
  const FLOCK_RADIUS = 150;       // notice same-species within this range
  const SEP_RADIUS = 20;          // too-close separation distance
  const COHESION = 25;            // strong pull toward group center
  const SEPARATION = 80;          // push away from too-close neighbors
  const ALIGNMENT = 15;           // match group velocity

  // Predator-prey
  const CHASE_RADIUS = 180;       // predator detection range
  const CHASE_FORCE = 120;        // predator chase strength
  const FLEE_FORCE = 160;         // prey flee strength (prey flee faster)

  // Movement
  const MAX_SPEED_WALK = 60;      // pixels per second (visible at any zoom)
  const MAX_SPEED_FLEE = 110;     // noticeably faster when fleeing
  const DAMPING = 0.90;           // moderate damping for smooth movement

  // ---- State machine (timers in seconds) ----
  a.stateTimer -= dt;
  if (a.stateTimer <= 0 && a.state !== 'flee') {
    const roll = Math.random();
    if (roll < 0.75) {
      a.state = 'walk';
      a.stateTimer = 5 + Math.random() * 10; // walk for 5-15 seconds
    } else if (roll < 0.88) {
      a.state = 'idle';
      a.stateTimer = 1 + Math.random() * 2; // brief pause 1-3s
    } else {
      a.state = 'eat';
      a.stateTimer = 1 + Math.random() * 1.5; // eat 1-2.5s
    }
  }

  // Bob animation always runs
  a.bobPhase += dt * 3;

  // Idle/eat: slow to a stop, but don't skip physics entirely (allows flee interrupt)
  if (a.state === 'idle' || a.state === 'eat') {
    a.vx *= Math.pow(0.3, dt * 60); // heavy braking
    a.vy *= Math.pow(0.3, dt * 60);
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    // Don't return — still check for predators below so flee can interrupt eating
  }

  // ---- Forces ----
  let fx = 0, fy = 0;
  const isMoving = (a.state === 'walk' || a.state === 'flee');

  // Wander + home pull only when walking
  if (isMoving) {
    fx += (Math.random() - 0.5) * WANDER_FORCE;
    fy += (Math.random() - 0.5) * WANDER_FORCE;
  }

  // Home pull: always active (prevents drifting too far)
  const dhx = a.homeX - a.x;
  const dhy = a.homeY - a.y;
  const hd = Math.sqrt(dhx * dhx + dhy * dhy);
  if (hd > HOME_RADIUS) {
    const pullStr = HOME_PULL * ((hd - HOME_RADIUS) / HOME_RADIUS);
    fx += (dhx / hd) * pullStr * 10;
    fy += (dhy / hd) * pullStr * 10;
  }

  // ---- Neighbors (spatial grid lookup) ----
  const cx = Math.floor(a.x / 80);
  const cy = Math.floor(a.y / 80);
  const neighbors = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = `${cx+dx},${cy+dy}`;
      if (spatialGrid[key]) {
        for (const b of spatialGrid[key]) {
          if (b !== a) neighbors.push(b);
        }
      }
    }
  }

  // ---- Flocking (same species) ----
  let cohX = 0, cohY = 0, cohN = 0;
  let sepFx = 0, sepFy = 0;
  let alVx = 0, alVy = 0;

  for (const b of neighbors) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.1) continue;

    // Same species: flock together (only when walking)
    if (isMoving && b.speciesId === a.speciesId && dist < FLOCK_RADIUS) {
      cohX += b.x; cohY += b.y; cohN++;
      alVx += b.vx; alVy += b.vy;

      if (dist < SEP_RADIUS) {
        sepFx -= (dx / dist) * (1 - dist / SEP_RADIUS);
        sepFy -= (dy / dist) * (1 - dist / SEP_RADIUS);
      }
    }

    // ---- Predator-prey interaction ----
    if (dist < CHASE_RADIUS) {
      // Am I a predator of b?
      if (foodChainPrey && foodChainPrey.has(a.speciesId) &&
          foodChainPrey.get(a.speciesId).has(b.speciesId)) {
        fx += (dx / dist) * CHASE_FORCE;
        fy += (dy / dist) * CHASE_FORCE;
        if (a.state !== 'flee') a.state = 'walk';
      }
      // Am I prey of b?
      if (foodChainPredators && foodChainPredators.has(a.speciesId) &&
          foodChainPredators.get(a.speciesId).has(b.speciesId)) {
        fx -= (dx / dist) * FLEE_FORCE;
        fy -= (dy / dist) * FLEE_FORCE;
        a.state = 'flee';
        a.stateTimer = 2;
      }
    }
  }

  // Apply flocking forces (only when walking)
  if (isMoving && cohN > 0) {
    fx += (cohX / cohN - a.x) * COHESION;
    fy += (cohY / cohN - a.y) * COHESION;
    fx += (alVx / cohN - a.vx) * ALIGNMENT;
    fy += (alVy / cohN - a.vy) * ALIGNMENT;
  }
  // Separation always active (don't overlap)
  fx += sepFx * SEPARATION;
  fy += sepFy * SEPARATION;

  // ---- Apply forces to velocity ----
  a.vx += fx * dt;
  a.vy += fy * dt;

  // Damping (frame-rate independent)
  const dampFactor = Math.pow(DAMPING, dt * 60);
  a.vx *= dampFactor;
  a.vy *= dampFactor;

  // Speed limit
  const spd = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
  const maxSpd = a.state === 'flee' ? MAX_SPEED_FLEE : MAX_SPEED_WALK;
  if (spd > maxSpd) {
    a.vx = (a.vx / spd) * maxSpd;
    a.vy = (a.vy / spd) * maxSpd;
  }

  // ---- Apply velocity (always, so flee interrupts idle) ----
  a.x += a.vx * dt;
  a.y += a.vy * dt;

  // Clamp to map
  a.x = Math.max(4, Math.min(gridW * TILE_SIZE - 4, a.x));
  a.y = Math.max(4, Math.min(gridH * TILE_SIZE - 4, a.y));

  // Facing direction
  if (Math.abs(a.vx) > 2) {
    a.facingRight = a.vx > 0;
  }
}

// ============================================================
// SPRITE CACHE
// ============================================================

const spriteCache = {};
let spritesLoadedCount = 0;
let spritesFailedCount = 0;

function loadSprite(id) {
  if (spriteCache[id]) return spriteCache[id];
  const img = new Image();
  img.crossOrigin = 'anonymous';
  spriteCache[id] = { img, loaded: false };
  img.onload = () => {
    spriteCache[id].loaded = true;
    spritesLoadedCount++;
    if (spritesLoadedCount % 50 === 0) {
      console.log(`[Sprites] ${spritesLoadedCount} loaded, ${spritesFailedCount} failed`);
    }
  };
  img.onerror = () => {
    spritesFailedCount++;
  };
  // Use local sprites (bundled in /data/sprites/) with GitHub fallback
  const basePath = import.meta.env.BASE_URL || '/';
  img.src = `${basePath}data/sprites/${id}.png`;
  return spriteCache[id];
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function StardewMap({ onSpeciesClick, onTickLoaded, animFrame }) {
  const canvasRef = useRef(null);
  const terrainCanvasRef = useRef(null); // offscreen pre-rendered terrain
  const agentsRef = useRef([]);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, camStartX: 0, camStartY: 0 });
  const mapDataRef = useRef(null);
  const biomeColorMapRef = useRef({});
  const foodChainRef = useRef({ prey: null, predators: null });
  const [loaded, setLoaded] = useState(false);

  // Load map + biomes + food chain + build agents
  useEffect(() => {
    Promise.all([
      getMap(),
      getBiomes(),
      getStatus(),
      getFoodChain(),
    ]).then(([mapData, biomes, status, foodChain]) => {
      mapDataRef.current = mapData;
      if (onTickLoaded) onTickLoaded(status.current_tick);

      // Build biome color map
      const colorMap = {};
      for (const [idStr, rawColor] of Object.entries(mapData.biome_colors)) {
        const baseId = matchBaseId(rawColor);
        colorMap[parseInt(idStr)] = BIOME_COLORS[baseId] || '#666';
      }
      biomeColorMapRef.current = colorMap;

      // Build food chain lookups
      if (foodChain.edges) {
        const prey = new Map();
        const predators = new Map();
        for (const e of foodChain.edges) {
          if (!prey.has(e.predator_id)) prey.set(e.predator_id, new Set());
          prey.get(e.predator_id).add(e.prey_id);
          if (!predators.has(e.prey_id)) predators.set(e.prey_id, new Set());
          predators.get(e.prey_id).add(e.predator_id);
        }
        foodChainRef.current = { prey, predators };
      }

      // Pre-render terrain to offscreen canvas
      const terrainCanvas = document.createElement('canvas');
      terrainCanvas.width = mapData.width * TILE_SIZE;
      terrainCanvas.height = mapData.height * TILE_SIZE;
      const tCtx = terrainCanvas.getContext('2d');

      for (let y = 0; y < mapData.height; y++) {
        for (let x = 0; x < mapData.width; x++) {
          const biomeId = mapData.grid[y * mapData.width + x];
          const color = colorMap[biomeId] || '#666';

          tCtx.fillStyle = color;
          tCtx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

          // Subtle grid lines
          tCtx.strokeStyle = 'rgba(0,0,0,0.06)';
          tCtx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

          // Add texture variation: small random dots for grass/forest
          const baseId = matchBaseId(mapData.biome_colors[String(biomeId)] || [128,128,128]);
          if (baseId === 2 || baseId === 3) {
            // Grass/forest: tiny darker dots
            tCtx.fillStyle = 'rgba(0,0,0,0.08)';
            const rng = mulberry32(y * mapData.width + x);
            for (let d = 0; d < 2; d++) {
              const dx = Math.floor(rng() * TILE_SIZE);
              const dy = Math.floor(rng() * TILE_SIZE);
              tCtx.fillRect(x * TILE_SIZE + dx, y * TILE_SIZE + dy, 1, 1);
            }
          }
          // Water: subtle wave highlight
          if (baseId === 7) {
            tCtx.fillStyle = 'rgba(255,255,255,0.1)';
            const rng = mulberry32(y * mapData.width + x + 99);
            if (rng() > 0.7) {
              const dx = Math.floor(rng() * (TILE_SIZE - 3));
              const dy = Math.floor(rng() * (TILE_SIZE - 1));
              tCtx.fillRect(x * TILE_SIZE + dx, y * TILE_SIZE + dy, 3, 1);
            }
          }
        }
      }
      terrainCanvasRef.current = terrainCanvas;

      // Build initial agents from biome species data
      return getAllBiomeDetails()
        .then(biomeDetails => {
          console.log('[StardewMap] biomeDetails:', biomeDetails.length, 'biomes');
          if (biomeDetails.length > 0) {
            console.log('[StardewMap] first biome:', biomeDetails[0].name, 'species:', biomeDetails[0].species?.length);
          }

          const biomeCells = {};
          for (let y = 0; y < mapData.height; y++) {
            for (let x = 0; x < mapData.width; x++) {
              const bid = mapData.grid[y * mapData.width + x];
              if (!biomeCells[bid]) biomeCells[bid] = [];
              biomeCells[bid].push({ x, y });
            }
          }

          const rng = mulberry32(42);
          const agents = [];

          for (const biome of biomeDetails) {
            const cells = biomeCells[biome.id];
            if (!cells || cells.length === 0) continue;

            // Density limit: scale agents strictly by biome area
            // 1 cell = 1 agent max, 100 cells = 15 agents max, 1000+ cells = uncapped
            const biomeArea = cells.length;
            const maxAgentsForBiome = Math.max(1, Math.min(
              Math.floor(biomeArea * 0.12),  // 12% of cells
              200                             // hard cap per biome
            ));
            let biomeAgentCount = 0;

            for (const sp of biome.species) {
              if (sp.population <= 0) continue;
              if (biomeAgentCount >= maxAgentsForBiome) break;

              // Trophic-aware agent count:
              // Prey/producers: herds (many agents)
              // Predators: solitary (few agents)
              const trophic = sp.trophic_level;
              let agentsPerPop, maxAgents;
              if (trophic === 'producer' || trophic === 'primary_consumer') {
                agentsPerPop = 20;   // 1 sprite per 20 pop → visible herds
                maxAgents = 15;
              } else if (trophic === 'secondary_consumer') {
                agentsPerPop = 50;
                maxAgents = 6;
              } else if (trophic === 'apex_predator') {
                agentsPerPop = 150;  // rare, solitary
                maxAgents = 3;
              } else { // decomposer
                agentsPerPop = 40;
                maxAgents = 8;
              }

              let numAgents = Math.max(1, Math.min(maxAgents, Math.ceil(sp.population / agentsPerPop)));
              // Don't exceed biome budget
              numAgents = Math.min(numAgents, maxAgentsForBiome - biomeAgentCount);
              if (numAgents <= 0) break;

              // Spawn herds: pick cluster center, spread around it
              // Use multiple cells spread across the biome for larger herds
              const numClusters = Math.max(1, Math.ceil(numAgents / 6));
              let agentsPlaced = 0;

              for (let c = 0; c < numClusters && agentsPlaced < numAgents; c++) {
                const clusterCell = cells[Math.floor(rng() * cells.length)];
                const clusterX = clusterCell.x * TILE_SIZE + TILE_SIZE / 2;
                const clusterY = clusterCell.y * TILE_SIZE + TILE_SIZE / 2;
                // Prey cluster tightly, predators spread wide
                const spread = (trophic === 'apex_predator') ? 100 : 25;

                const agentsInCluster = Math.min(6, numAgents - agentsPlaced);
                for (let i = 0; i < agentsInCluster; i++) {
                  const px = clusterX + (rng() - 0.5) * spread * 2;
                  const py = clusterY + (rng() - 0.5) * spread * 2;
                  // Clamp to map
                  const cpx = Math.max(4, Math.min(mapData.width * TILE_SIZE - 4, px));
                  const cpy = Math.max(4, Math.min(mapData.height * TILE_SIZE - 4, py));
                  agents.push(createAgent(cpx, cpy, sp.pokemon_id, biome.id, rng));
                  agentsPlaced++;
                }
              }
              biomeAgentCount += agentsPlaced;
            }
          }

          console.log('[StardewMap] Built', agents.length, 'agents');

          // Cap agents
          if (agents.length > MAX_AGENTS) {
            const step = agents.length / MAX_AGENTS;
            const sampled = [];
            for (let i = 0; i < MAX_AGENTS; i++) {
              sampled.push(agents[Math.floor(i * step)]);
            }
            agentsRef.current = sampled;
          } else {
            agentsRef.current = agents;
          }

          // Pre-load sprite textures for all unique species
          const uniqueIds = new Set(agentsRef.current.map(a => a.speciesId));
          for (const id of uniqueIds) loadSprite(id);

          // Center camera
          cameraRef.current.x = mapData.width * TILE_SIZE / 2;
          cameraRef.current.y = mapData.height * TILE_SIZE / 2;

          setLoaded(true);
        });
    });
  }, []);

  // Handle animation frames — DON'T rebuild agents (they keep walking).
  // Just let the visual world stay alive. The tick counter updates in the UI
  // but the agents on screen are cosmetic and keep their positions.
  // Only rebuild if we have zero agents (e.g., after reset).
  useEffect(() => {
    if (!animFrame || !mapDataRef.current) return;
    // Agents already exist from initial load — let them be.
    // The population data is reflected in the sidebar/timeline, not by teleporting sprites.
  }, [animFrame]);

  // Game loop
  useEffect(() => {
    if (!loaded) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animId;
    let lastTime = performance.now();

    let frameCount = 0;
    function gameLoop(now) {
      const dt = Math.min(now - lastTime, 50); // cap at 50ms
      lastTime = now;
      frameCount++;
      if (frameCount === 120) {
        const a = agentsRef.current[0];
        if (a) console.log(`[GameLoop] agent0: x=${a.x.toFixed(1)} y=${a.y.toFixed(1)} vx=${a.vx.toFixed(2)} vy=${a.vy.toFixed(2)} state=${a.state}`);
      }

      const { width: cw, height: ch } = canvas.getBoundingClientRect();
      canvas.width = cw * window.devicePixelRatio;
      canvas.height = ch * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

      const cam = cameraRef.current;
      const mapData = mapDataRef.current;

      // Update agents
      const agents = agentsRef.current;
      const spatialGrid = {};
      for (const a of agents) {
        const key = `${Math.floor(a.x/80)},${Math.floor(a.y/80)}`;
        if (!spatialGrid[key]) spatialGrid[key] = [];
        spatialGrid[key].push(a);
      }

      for (const a of agents) {
        updateAgent(a, dt, agents, spatialGrid, mapData.width, mapData.height,
                    foodChainRef.current.prey, foodChainRef.current.predators);
      }

      // Draw
      ctx.clearRect(0, 0, cw, ch);

      // Background
      ctx.fillStyle = '#2a3a2a';
      ctx.fillRect(0, 0, cw, ch);

      ctx.save();

      // Camera transform
      const scale = cam.zoom;
      const offsetX = cw / 2 - cam.x * scale;
      const offsetY = ch / 2 - cam.y * scale;
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);

      // Draw terrain (pre-rendered)
      if (terrainCanvasRef.current) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(terrainCanvasRef.current, 0, 0);
      }

      // Sort agents by Y for depth ordering
      agents.sort((a, b) => a.y - b.y);

      // Draw shadows
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (const a of agents) {
        ctx.beginPath();
        ctx.ellipse(a.x, a.y + SPRITE_SIZE * 0.35, SPRITE_SIZE * 0.3, SPRITE_SIZE * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw agents
      for (const a of agents) {
        const sprite = spriteCache[a.speciesId];
        const bob = Math.sin(a.bobPhase) * 1.5;
        const drawX = a.x - SPRITE_SIZE / 2;
        const drawY = a.y - SPRITE_SIZE + bob;

        // If sprite not loaded yet, draw colored circle as fallback
        if (!sprite || !sprite.loaded) {
          ctx.fillStyle = '#e88';
          ctx.beginPath();
          ctx.arc(a.x, a.y - SPRITE_SIZE * 0.3 + bob, SPRITE_SIZE * 0.3, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }

        ctx.save();

        // Flip if facing left
        if (!a.facingRight) {
          ctx.translate(a.x, 0);
          ctx.scale(-1, 1);
          ctx.translate(-a.x, 0);
        }

        // State visual effects
        if (a.state === 'eat') {
          // Slight green tint
          ctx.globalAlpha = 0.9;
        } else if (a.state === 'flee') {
          // Slightly transparent when fleeing
          ctx.globalAlpha = 0.75;
        }

        ctx.drawImage(sprite.img, drawX, drawY, SPRITE_SIZE, SPRITE_SIZE);

        // Eating particles
        if (a.state === 'eat') {
          const particlePhase = a.bobPhase * 3;
          ctx.fillStyle = '#5cb85c';
          for (let p = 0; p < 3; p++) {
            const px = a.x + Math.sin(particlePhase + p * 2) * 6;
            const py = a.y - 4 + Math.cos(particlePhase + p * 1.5) * 4;
            ctx.fillRect(px - 1, py - 1, 2, 2);
          }
        }

        ctx.globalAlpha = 1;
        ctx.restore();
      }

      ctx.restore();

      // HUD: agent count
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(cw - 140, 8, 132, 24);
      ctx.fillStyle = '#fff';
      ctx.font = '11px monospace';
      ctx.fillText(`${agents.length} pokemon visible`, cw - 132, 24);

      animId = requestAnimationFrame(gameLoop);
    }

    animId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animId);
  }, [loaded]);

  // Mouse handlers for camera
  const handleMouseDown = useCallback((e) => {
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      camStartX: cameraRef.current.x,
      camStartY: cameraRef.current.y,
    };
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    cameraRef.current.x = dragRef.current.camStartX - dx / cameraRef.current.zoom;
    cameraRef.current.y = dragRef.current.camStartY - dy / cameraRef.current.zoom;
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current.dragging = false;
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    cameraRef.current.zoom = Math.max(0.3, Math.min(6, cameraRef.current.zoom * delta));
  }, []);

  if (!loaded) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#2a3a2a', color: '#8ab060', fontSize: 16,
        fontFamily: '"Press Start 2P", monospace',
      }}>
        Loading world...
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      style={{
        flex: 1,
        cursor: dragRef.current?.dragging ? 'grabbing' : 'grab',
        imageRendering: 'pixelated',
      }}
    />
  );
}
