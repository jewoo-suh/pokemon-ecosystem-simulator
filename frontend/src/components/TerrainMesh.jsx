import { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';

const HEIGHT_SCALE = 12;
const WATER_LEVEL = 0.28;
const STEPS = 10;

const BIOME_PALETTE = {
  7:  [0.50, 0.75, 0.92],
  9:  [0.58, 0.85, 0.80],
  2:  [0.45, 0.78, 0.45],
  3:  [0.75, 0.88, 0.48],
  6:  [0.82, 0.68, 0.52],
  4:  [0.82, 0.78, 0.82],
  1:  [0.55, 0.45, 0.40],
  8:  [0.78, 0.70, 0.85],
  5:  [0.90, 0.82, 0.50],
};

const ORIG_COLORS = {
  7: [30, 100, 200], 9: [70, 170, 190], 2: [34, 120, 50],
  3: [140, 180, 60], 6: [150, 110, 70], 4: [160, 160, 170],
  1: [80, 60, 50], 8: [130, 100, 150], 5: [220, 190, 60],
};

const SEASON_TINTS = {
  spring: [1.02, 1.08, 1.00],
  summer: [1.08, 1.02, 0.94],
  autumn: [1.14, 0.95, 0.80],
  winter: [0.90, 0.95, 1.10],
};

export function matchBaseId(rawColor) {
  let best = 3, bestD = Infinity;
  for (const [id, c] of Object.entries(ORIG_COLORS)) {
    const d = Math.abs(rawColor[0]-c[0]) + Math.abs(rawColor[1]-c[1]) + Math.abs(rawColor[2]-c[2]);
    if (d < bestD) { bestD = d; best = parseInt(id); }
  }
  return best;
}

function terraceElevation(elev) {
  if (elev < WATER_LEVEL) return WATER_LEVEL * 0.4;
  return Math.round(elev * STEPS) / STEPS;
}

export default function TerrainMesh({ mapData, season }) {
  const meshRef = useRef();
  const originalColorsRef = useRef(null);
  const { width, height, grid, elevation, biome_colors } = mapData;

  const biomeColorMap = useMemo(() => {
    const map = {};
    for (const [idStr, rawColor] of Object.entries(biome_colors)) {
      map[parseInt(idStr)] = BIOME_PALETTE[matchBaseId(rawColor)] || [0.6, 0.6, 0.6];
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
        const tone = 0.92 + elev * 0.12;

        colors[posIdx] = Math.min(1, base[0] * tone);
        colors[posIdx + 1] = Math.min(1, base[1] * tone);
        colors[posIdx + 2] = Math.min(1, base[2] * tone);
      }
    }

    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, [mapData, biomeColorMap]);

  // Store original colors once
  useEffect(() => {
    if (geometry) {
      const colors = geometry.attributes.color;
      if (colors && !originalColorsRef.current) {
        originalColorsRef.current = new Float32Array(colors.array);
      }
    }
  }, [geometry]);

  // Apply seasonal tint to vertex colors
  useEffect(() => {
    if (!originalColorsRef.current || !geometry) return;
    const colors = geometry.attributes.color;
    const orig = originalColorsRef.current;
    const tint = SEASON_TINTS[season] || SEASON_TINTS.spring;

    for (let i = 0; i < orig.length; i += 3) {
      colors.array[i]     = Math.min(1, orig[i]     * tint[0]);
      colors.array[i + 1] = Math.min(1, orig[i + 1] * tint[1]);
      colors.array[i + 2] = Math.min(1, orig[i + 2] * tint[2]);
    }
    colors.needsUpdate = true;
  }, [season, geometry]);

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshPhongMaterial vertexColors side={THREE.DoubleSide} shininess={5} flatShading />
    </mesh>
  );
}

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
