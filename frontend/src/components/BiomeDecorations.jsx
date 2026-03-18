import { useMemo } from 'react';
import * as THREE from 'three';
import { getTerrainHeight, getBiomeBaseId, WATER_LEVEL, gridToHexWorld, isGridInsideHexWorld } from './TerrainMesh';

// Deterministic PRNG
function mulberry32(seed) {
  let t = seed + 0x6D2B79F5;
  return function () {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Decoration density per base biome type
const DECORATION_CONFIG = {
  2: { type: 'tree', density: 0.08, color: '#4a7c3f', color2: '#6b4c30' },     // forest
  3: { type: 'grass', density: 0.04, color: '#8ab060', color2: '#a0c068' },     // grassland
  4: { type: 'rock', density: 0.06, color: '#9a8e85', color2: '#b0a498' },      // mountain
  1: { type: 'crystal', density: 0.05, color: '#7a5c8a', color2: '#5a3c6a' },   // cave
  6: { type: 'rock', density: 0.04, color: '#8a7050', color2: '#a08868' },      // rough-terrain
  8: { type: 'building', density: 0.03, color: '#a090a8', color2: '#887898' },   // urban
  5: { type: 'crystal', density: 0.03, color: '#c8a030', color2: '#e0c040' },   // rare
  9: { type: 'reed', density: 0.03, color: '#5a8878', color2: '#78a898' },      // waters-edge
};

// Shared geometries (created once)
const TREE_TRUNK_GEO = new THREE.CylinderGeometry(0.15, 0.2, 1.2, 5);
const TREE_CROWN_GEO = new THREE.ConeGeometry(0.7, 1.8, 6);
const TREE_CROWN2_GEO = new THREE.ConeGeometry(0.55, 1.4, 6);
const ROCK_GEO = new THREE.IcosahedronGeometry(0.5, 0);
const CRYSTAL_GEO = new THREE.OctahedronGeometry(0.4, 0);
const BUILDING_GEO = new THREE.BoxGeometry(0.8, 1.2, 0.8);
const REED_GEO = new THREE.CylinderGeometry(0.04, 0.06, 1.0, 4);
const GRASS_GEO = new THREE.ConeGeometry(0.15, 0.6, 4);

export default function BiomeDecorations({ mapData }) {
  const { width, height, grid, elevation, biome_colors } = mapData;

  const decorations = useMemo(() => {
    const rng = mulberry32(123);
    const items = [];

    for (let iz = 0; iz < height; iz += 2) {
      for (let ix = 0; ix < width; ix += 2) {
        const rawElev = elevation[iz * width + ix] / 255;
        if (rawElev < WATER_LEVEL) continue;
        if (!isGridInsideHexWorld(ix, iz, width, height)) continue;

        const baseId = getBiomeBaseId(grid, biome_colors, ix, iz, width);
        const config = DECORATION_CONFIG[baseId];
        if (!config) continue;

        if (rng() > config.density) continue;

        const gx = ix + rng() * 1.5;
        const gz = iz + rng() * 1.5;
        const [wx, wz] = gridToHexWorld(gx, gz, width);
        const gy = getTerrainHeight(elevation, width, gx, gz);

        // Random scale variation
        const scale = 0.6 + rng() * 0.8;
        const rotation = rng() * Math.PI * 2;

        items.push({
          type: config.type,
          position: [wx, gy, wz],
          scale,
          rotation,
          color: config.color,
          color2: config.color2,
        });
      }
    }

    return items;
  }, [mapData]);

  // Group by type for instanced rendering
  const grouped = useMemo(() => {
    const groups = {};
    for (const item of decorations) {
      if (!groups[item.type]) groups[item.type] = [];
      groups[item.type].push(item);
    }
    return groups;
  }, [decorations]);

  return (
    <group>
      {/* Trees: trunk + two layered cones */}
      {grouped.tree && <TreeInstances items={grouped.tree} />}
      {/* Rocks */}
      {grouped.rock && <SimpleInstances items={grouped.rock} geometry={ROCK_GEO} />}
      {/* Crystals */}
      {grouped.crystal && <CrystalInstances items={grouped.crystal} />}
      {/* Buildings */}
      {grouped.building && <SimpleInstances items={grouped.building} geometry={BUILDING_GEO} yOffset={0.6} />}
      {/* Reeds */}
      {grouped.reed && <SimpleInstances items={grouped.reed} geometry={REED_GEO} yOffset={0.5} />}
      {/* Grass tufts */}
      {grouped.grass && <GrassInstances items={grouped.grass} />}
    </group>
  );
}

function TreeInstances({ items }) {
  const trunkMat = useMemo(() => new THREE.MeshLambertMaterial({ color: '#6b4c30' }), []);
  const crownMat = useMemo(() => new THREE.MeshLambertMaterial({ color: '#4a7c3f' }), []);
  const crownMat2 = useMemo(() => new THREE.MeshLambertMaterial({ color: '#5a8c4f' }), []);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Trunks
  const trunkRef = useMemo(() => {
    const mesh = new THREE.InstancedMesh(TREE_TRUNK_GEO, trunkMat, items.length);
    items.forEach((item, i) => {
      dummy.position.set(item.position[0], item.position[1] + 0.6 * item.scale, item.position[2]);
      dummy.scale.set(item.scale, item.scale, item.scale);
      dummy.rotation.set(0, item.rotation, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [items]);

  // Lower crown
  const crown1Ref = useMemo(() => {
    const mesh = new THREE.InstancedMesh(TREE_CROWN_GEO, crownMat, items.length);
    items.forEach((item, i) => {
      dummy.position.set(item.position[0], item.position[1] + 1.6 * item.scale, item.position[2]);
      dummy.scale.set(item.scale, item.scale, item.scale);
      dummy.rotation.set(0, item.rotation, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [items]);

  // Upper crown (smaller, offset)
  const crown2Ref = useMemo(() => {
    const mesh = new THREE.InstancedMesh(TREE_CROWN2_GEO, crownMat2, items.length);
    items.forEach((item, i) => {
      dummy.position.set(item.position[0], item.position[1] + 2.5 * item.scale, item.position[2]);
      dummy.scale.set(item.scale * 0.8, item.scale * 0.8, item.scale * 0.8);
      dummy.rotation.set(0, item.rotation + 0.5, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [items]);

  return (
    <group>
      <primitive object={trunkRef} />
      <primitive object={crown1Ref} />
      <primitive object={crown2Ref} />
    </group>
  );
}

function CrystalInstances({ items }) {
  const mat = useMemo(() => new THREE.MeshPhongMaterial({
    color: items[0]?.color || '#7a5c8a',
    shininess: 60,
    transparent: true,
    opacity: 0.8,
  }), [items]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(CRYSTAL_GEO, mat, items.length);
    items.forEach((item, i) => {
      dummy.position.set(item.position[0], item.position[1] + 0.4 * item.scale, item.position[2]);
      dummy.scale.set(item.scale * 0.8, item.scale * 1.4, item.scale * 0.8);
      dummy.rotation.set(0, item.rotation, 0.1 + item.rotation * 0.1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    return m;
  }, [items]);

  return <primitive object={mesh} />;
}

function SimpleInstances({ items, geometry, yOffset = 0 }) {
  const mat = useMemo(() => new THREE.MeshLambertMaterial({ color: items[0]?.color || '#888' }), [items]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, mat, items.length);
    items.forEach((item, i) => {
      dummy.position.set(item.position[0], item.position[1] + yOffset * item.scale, item.position[2]);
      dummy.scale.set(item.scale, item.scale, item.scale);
      dummy.rotation.set(0, item.rotation, 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    return m;
  }, [items]);

  return <primitive object={mesh} />;
}

function GrassInstances({ items }) {
  const mat = useMemo(() => new THREE.MeshLambertMaterial({ color: '#8ab060' }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Place 3 grass blades per item for a tufty look
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(GRASS_GEO, mat, items.length * 3);
    const rng = mulberry32(999);
    items.forEach((item, i) => {
      for (let j = 0; j < 3; j++) {
        const ox = (rng() - 0.5) * 0.4;
        const oz = (rng() - 0.5) * 0.4;
        dummy.position.set(
          item.position[0] + ox,
          item.position[1] + 0.25 * item.scale,
          item.position[2] + oz
        );
        dummy.scale.set(item.scale, item.scale * (0.8 + rng() * 0.5), item.scale);
        dummy.rotation.set(0, rng() * Math.PI, 0);
        dummy.updateMatrix();
        m.setMatrixAt(i * 3 + j, dummy.matrix);
      }
    });
    m.count = items.length * 3;
    m.instanceMatrix.needsUpdate = true;
    return m;
  }, [items]);

  return <primitive object={mesh} />;
}
