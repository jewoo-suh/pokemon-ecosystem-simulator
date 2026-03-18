import { useState, useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getTerrainHeight, WATER_LEVEL, HEIGHT_SCALE } from './TerrainMesh';
import { getAllBiomeDetails, getFoodChain } from '../data';

const MAX_AGENTS = 1500;
const SPRITE_SIZE = 1.8;
const WATER_Y = WATER_LEVEL * 0.4 * HEIGHT_SCALE + 0.3;

function mulberry32(seed) {
  let t = seed + 0x6D2B79F5;
  return function () {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sprite texture cache
const textureCache = {};
const loader = new THREE.TextureLoader();
function getTexture(id, basePath) {
  if (textureCache[id]) return textureCache[id];
  const tex = loader.load(`${basePath}data/sprites/${id}.png`);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache[id] = tex;
  return tex;
}

// Agent behavior update
function updateAgents(agents, dtMs) {
  const dt = dtMs / 1000;
  const WANDER = 15;
  const HOME_PULL = 3;
  const HOME_R = 8;
  const FLOCK_R = 12;
  const SEP_R = 2.5;
  const COHESION = 3;
  const SEPARATION = 8;
  const ALIGNMENT = 2;
  const CHASE_R = 15;
  const CHASE_F = 12;
  const FLEE_F = 18;
  const MAX_WALK = 5;
  const MAX_FLEE = 9;
  const DAMP = 0.88;

  // Spatial grid
  const grid = {};
  for (const a of agents) {
    const k = `${Math.floor(a.x/15)},${Math.floor(a.z/15)}`;
    (grid[k] || (grid[k] = [])).push(a);
  }

  for (const a of agents) {
    a.stateTimer -= dt;
    if (a.stateTimer <= 0 && a.state !== 'flee') {
      const r = Math.random();
      if (r < 0.75) { a.state = 'walk'; a.stateTimer = 4 + Math.random() * 8; }
      else if (r < 0.90) { a.state = 'idle'; a.stateTimer = 1 + Math.random() * 2; }
      else { a.state = 'eat'; a.stateTimer = 1 + Math.random() * 1.5; }
    }

    a.bobPhase += dt * 3;
    const isMoving = a.state === 'walk' || a.state === 'flee';

    if (!isMoving) {
      a.vx *= 0.85; a.vz *= 0.85;
      a.x += a.vx * dt; a.z += a.vz * dt;
      continue;
    }

    let fx = 0, fz = 0;

    // Wander
    fx += (Math.random() - 0.5) * WANDER;
    fz += (Math.random() - 0.5) * WANDER;

    // Home pull
    const dhx = a.homeX - a.x, dhz = a.homeZ - a.z;
    const hd = Math.sqrt(dhx*dhx + dhz*dhz);
    if (hd > HOME_R) {
      const pull = HOME_PULL * ((hd - HOME_R) / HOME_R);
      fx += (dhx/hd) * pull * 5;
      fz += (dhz/hd) * pull * 5;
    }

    // Neighbors
    const cx = Math.floor(a.x/15), cz = Math.floor(a.z/15);
    let cohX=0, cohZ=0, cohN=0, sepX=0, sepZ=0;

    for (let dx=-1; dx<=1; dx++) for (let dz=-1; dz<=1; dz++) {
      const cell = grid[`${cx+dx},${cz+dz}`];
      if (!cell) continue;
      for (const b of cell) {
        if (b === a) continue;
        const bx = b.x-a.x, bz = b.z-a.z;
        const dist = Math.sqrt(bx*bx + bz*bz);
        if (dist < 0.1) continue;

        // Flock with same species
        if (b.speciesId === a.speciesId && dist < FLOCK_R) {
          cohX += b.x; cohZ += b.z; cohN++;
          if (dist < SEP_R) { sepX -= bx/dist; sepZ -= bz/dist; }
        }

        // Predator-prey
        if (dist < CHASE_R && a.preySet && a.preySet.has(b.speciesId)) {
          fx += (bx/dist)*CHASE_F; fz += (bz/dist)*CHASE_F;
        }
        if (dist < CHASE_R && a.predatorSet && a.predatorSet.has(b.speciesId)) {
          fx -= (bx/dist)*FLEE_F; fz -= (bz/dist)*FLEE_F;
          a.state = 'flee'; a.stateTimer = 2;
        }
      }
    }

    if (cohN > 0) {
      fx += (cohX/cohN - a.x)*COHESION;
      fz += (cohZ/cohN - a.z)*COHESION;
    }
    fx += sepX*SEPARATION; fz += sepZ*SEPARATION;

    a.vx = (a.vx + fx*dt) * Math.pow(DAMP, dt*60);
    a.vz = (a.vz + fz*dt) * Math.pow(DAMP, dt*60);

    const spd = Math.sqrt(a.vx*a.vx + a.vz*a.vz);
    const max = a.state === 'flee' ? MAX_FLEE : MAX_WALK;
    if (spd > max) { a.vx = a.vx/spd*max; a.vz = a.vz/spd*max; }

    a.x += a.vx * dt;
    a.z += a.vz * dt;
    a.x = Math.max(1, Math.min(a.mapW - 1, a.x));
    a.z = Math.max(1, Math.min(a.mapH - 1, a.z));

    if (Math.abs(a.vx) > 0.2) a.facingRight = a.vx > 0;
  }
}

export default function PokemonSprites3D({ mapData, biomeCells }) {
  const [agents, setAgents] = useState([]);
  const agentsRef = useRef([]);
  const spritesRef = useRef([]);
  const shadowRef = useRef();
  const basePath = import.meta.env.BASE_URL || '/';

  const { width, height: mapH, elevation } = mapData;

  // Load biome data + food chain, build agents
  useEffect(() => {
    if (!biomeCells) return;

    Promise.all([getAllBiomeDetails(), getFoodChain()])
      .then(([biomeDetails, foodChain]) => {
        // Food chain lookups
        const preyMap = new Map();
        const predMap = new Map();
        if (foodChain.edges) {
          for (const e of foodChain.edges) {
            if (!preyMap.has(e.predator_id)) preyMap.set(e.predator_id, new Set());
            preyMap.get(e.predator_id).add(e.prey_id);
            if (!predMap.has(e.prey_id)) predMap.set(e.prey_id, new Set());
            predMap.get(e.prey_id).add(e.predator_id);
          }
        }

        const rng = mulberry32(42);
        const allAgents = [];

        for (const biome of biomeDetails) {
          const cells = biomeCells[biome.id];
          if (!cells || cells.length === 0) continue;

          const biomeArea = cells.length;
          const maxForBiome = Math.max(1, Math.min(Math.floor(biomeArea * 0.12), 200));
          let biomeCount = 0;

          for (const sp of biome.species) {
            if (sp.population <= 0 || biomeCount >= maxForBiome) continue;

            const trophic = sp.trophic_level;
            let perPop = 20, maxA = 12;
            if (trophic === 'apex_predator') { perPop = 150; maxA = 3; }
            else if (trophic === 'secondary_consumer') { perPop = 50; maxA = 6; }

            let num = Math.max(1, Math.min(maxA, Math.ceil(sp.population / perPop)));
            num = Math.min(num, maxForBiome - biomeCount);
            if (num <= 0) continue;

            const clusterCell = cells[Math.floor(rng() * cells.length)];
            const spread = trophic === 'apex_predator' ? 10 : 3;

            for (let i = 0; i < num; i++) {
              const gx = clusterCell.x + (rng() - 0.5) * spread * 2;
              const gz = clusterCell.y + (rng() - 0.5) * spread * 2;
              const cgx = Math.max(0, Math.min(width - 1, gx));
              const cgz = Math.max(0, Math.min(mapH - 1, gz));

              const ix = Math.floor(cgx), iz = Math.floor(cgz);
              const rawElev = elevation[iz * width + ix] / 255;
              const gy = rawElev < WATER_LEVEL ? WATER_Y : getTerrainHeight(elevation, width, cgx, cgz);

              allAgents.push({
                x: cgx, y: gy + SPRITE_SIZE * 0.5, z: cgz,
                homeX: cgx, homeZ: cgz, baseY: gy + SPRITE_SIZE * 0.5,
                vx: (rng()-0.5)*0.5, vz: (rng()-0.5)*0.5,
                speciesId: sp.pokemon_id,
                biomeId: biome.id,
                facingRight: rng() > 0.5,
                bobPhase: rng() * Math.PI * 2,
                state: 'walk',
                stateTimer: rng() * 8,
                mapW: width, mapH: mapH,
                preySet: preyMap.get(sp.pokemon_id) || null,
                predatorSet: predMap.get(sp.pokemon_id) || null,
              });
            }
            biomeCount += num;
          }
        }

        // Cap
        let final = allAgents;
        if (allAgents.length > MAX_AGENTS) {
          const step = allAgents.length / MAX_AGENTS;
          final = [];
          for (let i = 0; i < MAX_AGENTS; i++) final.push(allAgents[Math.floor(i * step)]);
        }

        // Preload textures
        const ids = new Set(final.map(a => a.speciesId));
        for (const id of ids) getTexture(id, basePath);

        agentsRef.current = final;
        spritesRef.current = new Array(final.length);
        console.log(`[3D Sprites] ${final.length} agents built`);
        setAgents(final);
      });
  }, [biomeCells]);

  // Shadow geometry
  const shadowGeo = useMemo(() => new THREE.CircleGeometry(0.5, 6), []);
  const shadowMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#000', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide,
  }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Per-frame update
  useFrame((_, delta) => {
    const ag = agentsRef.current;
    if (ag.length === 0) return;

    updateAgents(ag, delta * 1000);

    // Update sprite positions
    for (let i = 0; i < ag.length; i++) {
      const a = ag[i];
      const s = spritesRef.current[i];
      if (!s) continue;

      const ix = Math.floor(Math.max(0, Math.min(width-1, a.x)));
      const iz = Math.floor(Math.max(0, Math.min(mapH-1, a.z)));
      const rawElev = elevation[iz * width + ix] / 255;
      const terrY = rawElev < WATER_LEVEL ? WATER_Y : getTerrainHeight(elevation, width, a.x, a.z);
      const bob = Math.sin(a.bobPhase) * 0.15;

      s.position.set(a.x, terrY + SPRITE_SIZE * 0.5 + bob, a.z);
    }

    // Update shadows
    if (shadowRef.current) {
      for (let i = 0; i < ag.length; i++) {
        const a = ag[i];
        const s = spritesRef.current[i];
        if (!s) continue;
        dummy.position.set(a.x, s.position.y - SPRITE_SIZE * 0.45, a.z);
        dummy.rotation.set(-Math.PI/2, 0, 0);
        dummy.updateMatrix();
        shadowRef.current.setMatrixAt(i, dummy.matrix);
      }
      shadowRef.current.count = ag.length;
      shadowRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  if (agents.length === 0) return null;

  return (
    <group>
      {agents.map((a, i) => (
        <sprite
          key={`${a.speciesId}-${a.biomeId}-${i}`}
          ref={el => { spritesRef.current[i] = el; }}
          position={[a.x, a.baseY, a.z]}
          scale={[SPRITE_SIZE, SPRITE_SIZE, SPRITE_SIZE]}
        >
          <spriteMaterial
            map={getTexture(a.speciesId, basePath)}
            transparent alphaTest={0.1} depthWrite={false}
          />
        </sprite>
      ))}
      <instancedMesh ref={shadowRef} args={[shadowGeo, shadowMat, Math.max(agents.length, 100)]} frustumCulled={false} />
    </group>
  );
}
