import { useMemo, useEffect, useState, useRef, useCallback, forwardRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getTerrainHeight, WATER_LEVEL, HEIGHT_SCALE, gridToHexWorld, isGridInsideHexWorld } from './TerrainMesh';

const API = 'http://localhost:8000';
const MAX_DOTS = 8;
const SPRITE_SIZE = 1.6;
const MAX_VISIBLE = 600;
const WATER_Y = WATER_LEVEL * 0.4 * HEIGHT_SCALE + 0.3; // just above water surface

function spriteUrl(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
}

function mulberry32(seed) {
  let t = seed + 0x6D2B79F5;
  return function () {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const textureCache = {};
const loader = new THREE.TextureLoader();
function getTexture(pokemonId) {
  if (textureCache[pokemonId]) return textureCache[pokemonId];
  const tex = loader.load(spriteUrl(pokemonId));
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache[pokemonId] = tex;
  return tex;
}

// ============================================================
// Agent behavior system
// ============================================================

function createAgent(x, y, z, speciesId, biomeId, rng) {
  return {
    x, y, z,              // current world position
    homeX: x, homeZ: z,   // anchor point (stays near here)
    baseY: y,             // terrain height at spawn (for Y updates)
    vx: (rng() - 0.5) * 0.3,
    vz: (rng() - 0.5) * 0.3,
    speciesId,
    biomeId,
    bobPhase: rng() * Math.PI * 2,
  };
}

function updateAgents(agents, delta, elevation, width, foodChain) {
  const dt = Math.min(delta, 0.05); // cap delta to prevent huge jumps
  const WANDER_STRENGTH = 0.15;
  const HOME_PULL = 0.02;
  const FLOCK_RADIUS = 4.0;
  const SEPARATION_RADIUS = 1.2;
  const FLOCK_COHESION = 0.008;
  const FLOCK_SEPARATION = 0.05;
  const FLOCK_ALIGNMENT = 0.02;
  const CHASE_RADIUS = 6.0;
  const CHASE_STRENGTH = 0.03;
  const FLEE_STRENGTH = 0.05;
  const MAX_SPEED = 0.8;
  const DAMPING = 0.96;

  // Build spatial index: grid cells of size 5
  const CELL_SIZE = 5;
  const grid = {};
  for (let i = 0; i < agents.length; i++) {
    const cx = Math.floor(agents[i].x / CELL_SIZE);
    const cz = Math.floor(agents[i].z / CELL_SIZE);
    const key = `${cx},${cz}`;
    if (!grid[key]) grid[key] = [];
    grid[key].push(i);
  }

  function getNeighborIndices(ax, az) {
    const cx = Math.floor(ax / CELL_SIZE);
    const cz = Math.floor(az / CELL_SIZE);
    const result = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = grid[`${cx + dx},${cz + dz}`];
        if (cell) result.push(...cell);
      }
    }
    return result;
  }

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];

    // --- Wander: small random velocity change ---
    a.vx += (Math.random() - 0.5) * WANDER_STRENGTH * dt;
    a.vz += (Math.random() - 0.5) * WANDER_STRENGTH * dt;

    // --- Home pull: drift back toward anchor ---
    const dhx = a.homeX - a.x;
    const dhz = a.homeZ - a.z;
    const homeDist = Math.sqrt(dhx * dhx + dhz * dhz);
    if (homeDist > 3) {
      a.vx += (dhx / homeDist) * HOME_PULL * Math.min(homeDist, 10);
      a.vz += (dhz / homeDist) * HOME_PULL * Math.min(homeDist, 10);
    }

    // --- Flocking: cohesion + separation + alignment with same species ---
    const neighbors = getNeighborIndices(a.x, a.z);
    let cohX = 0, cohZ = 0, cohCount = 0;
    let sepX = 0, sepZ = 0;
    let alignVx = 0, alignVz = 0;

    for (const j of neighbors) {
      if (j === i) continue;
      const b = agents[j];
      if (b.speciesId !== a.speciesId) continue;

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < FLOCK_RADIUS) {
        // Cohesion
        cohX += b.x;
        cohZ += b.z;
        cohCount++;

        // Alignment
        alignVx += b.vx;
        alignVz += b.vz;

        // Separation
        if (dist < SEPARATION_RADIUS && dist > 0.01) {
          sepX -= dx / dist;
          sepZ -= dz / dist;
        }
      }
    }

    if (cohCount > 0) {
      cohX /= cohCount;
      cohZ /= cohCount;
      a.vx += (cohX - a.x) * FLOCK_COHESION;
      a.vz += (cohZ - a.z) * FLOCK_COHESION;
      a.vx += (alignVx / cohCount - a.vx) * FLOCK_ALIGNMENT;
      a.vz += (alignVz / cohCount - a.vz) * FLOCK_ALIGNMENT;
    }
    a.vx += sepX * FLOCK_SEPARATION;
    a.vz += sepZ * FLOCK_SEPARATION;

    // --- Predator-prey: chase/flee ---
    if (foodChain) {
      const preySet = foodChain.prey?.get(a.speciesId);
      const predSet = foodChain.predators?.get(a.speciesId);

      for (const j of neighbors) {
        if (j === i) continue;
        const b = agents[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > CHASE_RADIUS || dist < 0.01) continue;

        // I'm a predator, b is my prey -> chase
        if (preySet && preySet.has(b.speciesId)) {
          a.vx += (dx / dist) * CHASE_STRENGTH;
          a.vz += (dz / dist) * CHASE_STRENGTH;
        }
        // I'm prey, b is my predator -> flee
        if (predSet && predSet.has(b.speciesId)) {
          a.vx -= (dx / dist) * FLEE_STRENGTH;
          a.vz -= (dz / dist) * FLEE_STRENGTH;
        }
      }
    }

    // --- Damping & speed limit ---
    a.vx *= DAMPING;
    a.vz *= DAMPING;
    const speed = Math.sqrt(a.vx * a.vx + a.vz * a.vz);
    if (speed > MAX_SPEED) {
      a.vx = (a.vx / speed) * MAX_SPEED;
      a.vz = (a.vz / speed) * MAX_SPEED;
    }

    // --- Apply velocity ---
    a.x += a.vx;
    a.z += a.vz;

    // --- Clamp: keep near home (hex world coords) ---
    // Don't wander more than 15 units from home
    const dHomeX = a.x - a.homeX;
    const dHomeZ = a.z - a.homeZ;
    const homeDist2 = Math.sqrt(dHomeX * dHomeX + dHomeZ * dHomeZ);
    if (homeDist2 > 15) {
      a.x = a.homeX + (dHomeX / homeDist2) * 15;
      a.z = a.homeZ + (dHomeZ / homeDist2) * 15;
    }

    // --- Update Y from terrain + bob ---
    // Use stored grid coords for elevation lookup (hex world coords don't map 1:1 to grid)
    const terrainY = a.baseY || WATER_Y;
    a.bobPhase += dt * 2.5;
    a.y = terrainY + SPRITE_SIZE * 0.5 + Math.sin(a.bobPhase) * 0.15;
  }
}

// ============================================================
// React component
// ============================================================

export default function PokemonSprites({ mapData, biomeCells, animFrame }) {
  const [slots, setSlots] = useState(null);
  const [foodChain, setFoodChain] = useState(null);
  const [agentVersion, setAgentVersion] = useState(0); // triggers re-render when agents change
  const agentsRef = useRef([]);
  const spritesRef = useRef([]);

  const { width, height: mapHeight, elevation } = mapData;

  // Load food chain for predator-prey behaviors
  useEffect(() => {
    fetch(`${API}/food-chain?limit=5000`)
      .then(r => r.json())
      .then(data => {
        if (!data.edges) return;
        const prey = new Map();     // predator_id -> Set of prey_ids
        const predators = new Map(); // prey_id -> Set of predator_ids
        for (const edge of data.edges) {
          if (!prey.has(edge.predator_id)) prey.set(edge.predator_id, new Set());
          prey.get(edge.predator_id).add(edge.prey_id);
          if (!predators.has(edge.prey_id)) predators.set(edge.prey_id, new Set());
          predators.get(edge.prey_id).add(edge.predator_id);
        }
        setFoodChain({ prey, predators });
      })
      .catch(() => {}); // food chain is optional
  }, []);

  // Pre-compute dot slot positions
  useEffect(() => {
    if (!biomeCells) return;

    fetch(`${API}/biomes`)
      .then(r => r.json())
      .then(biomes =>
        Promise.all(biomes.map(b => fetch(`${API}/biomes/${b.id}`).then(r => r.json())))
      )
      .then(biomeDetails => {
        const rng = mulberry32(42);
        const slotMap = {};

        for (const biome of biomeDetails) {
          const cells = biomeCells[biome.id];
          if (!cells || cells.length === 0) continue;

          for (const sp of biome.species) {
            const key = `${sp.pokemon_id}-${biome.id}`;

            const positions = [];
            for (let i = 0; i < MAX_DOTS; i++) {
              // Try up to 5 cells to find one inside the hex world
              let placed = false;
              for (let attempt = 0; attempt < 5; attempt++) {
                const cell = cells[Math.floor(rng() * cells.length)];
                const gx = cell.x + rng() * 0.9 + 0.05;
                const gz = cell.y + rng() * 0.9 + 0.05;
                const ix = Math.floor(gx);
                const iz = Math.floor(gz);

                if (!isGridInsideHexWorld(gx, gz, width, mapHeight)) continue;

                const [wx, wz] = gridToHexWorld(gx, gz, width);
                const rawElev = elevation[iz * width + ix] / 255;
                const isWater = rawElev < WATER_LEVEL;
                const gy = isWater
                  ? WATER_Y + SPRITE_SIZE * 0.5
                  : getTerrainHeight(elevation, width, gx, gz) + SPRITE_SIZE * 0.5;

                positions.push({ x: wx, y: gy, z: wz });
                placed = true;
                break;
              }
            }

            slotMap[key] = {
              positions,
              trophic: sp.trophic_level,
              name: sp.name,
              id: sp.pokemon_id,
              biome: biome.name,
              biomeId: biome.id,
              population: sp.population,
            };
          }
        }

        setSlots(slotMap);

        // Pre-load top textures
        const pops = {};
        for (const key in slotMap) {
          const s = slotMap[key];
          pops[s.id] = (pops[s.id] || 0) + s.population;
        }
        Object.entries(pops)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 120)
          .forEach(([id]) => getTexture(parseInt(id)));

        // Build initial agents
        rebuildAgents(slotMap, null, agentsRef, rng, width);
        setAgentVersion(v => v + 1);
      });
  }, [biomeCells]);

  // Animation frame update
  useEffect(() => {
    if (!animFrame || !slots) return;
    const rng = mulberry32(77);
    rebuildAgents(slots, animFrame, agentsRef, rng, width);
    setAgentVersion(v => v + 1);
  }, [animFrame, slots]);

  // Per-frame agent update
  useFrame((_, delta) => {
    const agents = agentsRef.current;
    if (agents.length === 0) return;

    updateAgents(agents, delta, elevation, width, foodChain);

    // Update sprite positions
    if (spritesRef.current.length !== agents.length) return;
    for (let i = 0; i < agents.length; i++) {
      const sprite = spritesRef.current[i];
      if (sprite) {
        sprite.position.x = agents[i].x;
        sprite.position.y = agents[i].y;
        sprite.position.z = agents[i].z;
      }
    }
  });

  const agents = agentsRef.current;
  if (!slots || agents.length === 0) return null;

  // Build sprite refs array
  spritesRef.current = new Array(agents.length);

  return (
    <group>
      {agents.map((agent, i) => (
        <SpriteAgent
          key={`${agent.speciesId}-${agent.biomeId}-${i}`}
          ref={el => { spritesRef.current[i] = el; }}
          agent={agent}
        />
      ))}
      {/* Shadow dots under each sprite */}
      <ShadowDots agents={agents} />
    </group>
  );
}

const SpriteAgent = forwardRef(function SpriteAgent({ agent }, ref) {
  const texture = useMemo(() => getTexture(agent.speciesId), [agent.speciesId]);

  return (
    <sprite
      ref={ref}
      position={[agent.x, agent.y, agent.z]}
      scale={[SPRITE_SIZE, SPRITE_SIZE, SPRITE_SIZE]}
    >
      <spriteMaterial
        map={texture}
        transparent
        alphaTest={0.1}
        depthWrite={false}
      />
    </sprite>
  );
});

// Small dark circles under each sprite for grounding
function ShadowDots({ agents }) {
  const meshRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geo = useMemo(() => new THREE.CircleGeometry(0.5, 6), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#000000',
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), []);

  useFrame(() => {
    if (!meshRef.current) return;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      dummy.position.set(a.x, a.y - SPRITE_SIZE * 0.5 + 0.05, a.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.count = agents.length;
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[geo, mat, Math.max(agents.length, 100)]} frustumCulled={false} />
  );
}

function rebuildAgents(slots, animFrame, agentsRef, rng, mapWidth) {
  const dots = [];

  if (animFrame) {
    for (const sp of animFrame.species) {
      const key = `${sp.id}-${sp.biome_id}`;
      const slot = slots[key];
      if (!slot || slot.positions.length === 0) continue;
      const numDots = Math.max(1, Math.min(slot.positions.length, Math.ceil(sp.population / 50)));
      for (let i = 0; i < numDots; i++) {
        const p = slot.positions[i];
        dots.push(createAgent(p.x, p.y, p.z, sp.id, sp.biome_id, rng));
      }
    }
  } else {
    for (const key in slots) {
      const slot = slots[key];
      if (slot.population <= 0) continue;
      const numDots = Math.max(1, Math.min(slot.positions.length, Math.ceil(slot.population / 50)));
      for (let i = 0; i < numDots; i++) {
        const p = slot.positions[i];
        dots.push(createAgent(p.x, p.y, p.z, slot.id, slot.biomeId, rng));
      }
    }
  }

  // Cap for performance
  if (dots.length > MAX_VISIBLE) {
    const step = dots.length / MAX_VISIBLE;
    const sampled = [];
    for (let i = 0; i < MAX_VISIBLE; i++) {
      sampled.push(dots[Math.floor(i * step)]);
    }
    agentsRef.current = sampled;
  } else {
    agentsRef.current = dots;
  }
}
