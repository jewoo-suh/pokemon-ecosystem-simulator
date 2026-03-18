import { useMemo } from 'react';
import * as THREE from 'three';

const HEIGHT_SCALE = 15;
const WATER_LEVEL = 0.28;
const STEPS = 12; // number of discrete elevation terraces

// Monument Valley inspired palette — warm, muted, geometric
const BIOME_PALETTE = {
  7:  [0.35, 0.55, 0.72],   // sea — calm blue
  9:  [0.55, 0.72, 0.68],   // waters-edge — sage teal
  2:  [0.42, 0.62, 0.38],   // forest — muted green
  3:  [0.72, 0.78, 0.48],   // grassland — soft yellow-green
  6:  [0.68, 0.55, 0.42],   // rough-terrain — clay
  4:  [0.78, 0.72, 0.68],   // mountain — warm stone
  1:  [0.45, 0.35, 0.32],   // cave — deep brown
  8:  [0.72, 0.60, 0.70],   // urban — dusty mauve
  5:  [0.82, 0.72, 0.45],   // rare — amber
};

// Original biome colors for matching split biomes to their parent
const ORIG_COLORS = {
  7: [30, 100, 200], 9: [70, 170, 190], 2: [34, 120, 50],
  3: [140, 180, 60], 6: [150, 110, 70], 4: [160, 160, 170],
  1: [80, 60, 50], 8: [130, 100, 150], 5: [220, 190, 60],
};

function matchBaseId(rawColor) {
  let bestBase = 3;
  let bestDist = Infinity;
  for (const [baseId, baseRaw] of Object.entries(ORIG_COLORS)) {
    const d = Math.abs(rawColor[0] - baseRaw[0]) + Math.abs(rawColor[1] - baseRaw[1]) + Math.abs(rawColor[2] - baseRaw[2]);
    if (d < bestDist) { bestDist = d; bestBase = parseInt(baseId); }
  }
  return bestBase;
}

// Quantize elevation to discrete steps (terraced look)
function terraceElevation(elev) {
  if (elev < WATER_LEVEL) return WATER_LEVEL * 0.4;
  return Math.round(elev * STEPS) / STEPS;
}

export default function TerrainMesh({ mapData }) {
  const { width, height, grid, elevation, biome_colors } = mapData;

  const biomeColorMap = useMemo(() => {
    const map = {};
    for (const [idStr, rawColor] of Object.entries(biome_colors)) {
      const baseId = matchBaseId(rawColor);
      map[parseInt(idStr)] = BIOME_PALETTE[baseId] || [0.6, 0.6, 0.6];
    }
    return map;
  }, [biome_colors]);

  // Also export the base ID map for decoration placement
  const biomeBaseMap = useMemo(() => {
    const map = {};
    for (const [idStr, rawColor] of Object.entries(biome_colors)) {
      map[parseInt(idStr)] = matchBaseId(rawColor);
    }
    return map;
  }, [biome_colors]);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(width, height, width - 1, height - 1);
    const positions = geo.attributes.position.array;
    const colors = new Float32Array(positions.length);

    for (let iy = 0; iy < height; iy++) {
      for (let ix = 0; ix < width; ix++) {
        const vertIdx = iy * width + ix;
        const posIdx = vertIdx * 3;

        const rawElev = elevation[vertIdx] / 255;
        const elev = terraceElevation(rawElev);
        const y = elev * HEIGHT_SCALE;

        positions[posIdx] = ix;
        positions[posIdx + 1] = y;
        positions[posIdx + 2] = iy;

        const biomeId = grid[vertIdx];
        const base = biomeColorMap[biomeId] || [0.6, 0.6, 0.6];

        // Subtle face shading: slight variation by terrace level
        const terraceTone = 0.9 + (elev - 0.3) * 0.3;

        colors[posIdx] = Math.min(1, base[0] * terraceTone);
        colors[posIdx + 1] = Math.min(1, base[1] * terraceTone);
        colors[posIdx + 2] = Math.min(1, base[2] * terraceTone);
      }
    }

    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, [mapData, biomeColorMap]);

  return (
    <mesh geometry={geometry}>
      <meshPhongMaterial
        vertexColors
        side={THREE.DoubleSide}
        shininess={3}
        flatShading
      />
    </mesh>
  );
}

// Height lookup for placing objects on terrain
export function getTerrainHeight(elevation, width, gx, gz) {
  const ix = Math.floor(Math.max(0, Math.min(width - 1, gx)));
  const iz = Math.floor(Math.max(0, Math.min(width - 1, gz)));
  const rawElev = elevation[iz * width + ix] / 255;
  return terraceElevation(rawElev) * HEIGHT_SCALE;
}

export function getBiomeBaseId(grid, biome_colors, gx, gz, width) {
  const ix = Math.floor(Math.max(0, Math.min(width - 1, gx)));
  const iz = Math.floor(Math.max(0, Math.min(width - 1, gz)));
  const biomeId = grid[iz * width + ix];
  const rawColor = biome_colors[String(biomeId)] || [128, 128, 128];
  return matchBaseId(rawColor);
}

export { HEIGHT_SCALE, WATER_LEVEL, BIOME_PALETTE };
