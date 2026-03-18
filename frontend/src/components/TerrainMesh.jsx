import { useMemo } from 'react';
import * as THREE from 'three';

const HEIGHT_SCALE = 10;
const WATER_LEVEL = 0.28;
const HEX_SIZE = 1.7;
const HEX_STEP = 2;
const HEX_THICKNESS = 0.35;
const ELEVATION_STEPS = 10;

// Bright pastel palette — saturated but soft, liquid glass aesthetic
const BIOME_PALETTE = {
  7:  [0.55, 0.78, 0.95],   // sea — bright sky blue
  9:  [0.60, 0.90, 0.85],   // waters-edge — vivid mint
  2:  [0.50, 0.85, 0.50],   // forest — bright green
  3:  [0.82, 0.92, 0.50],   // grassland — vivid lime
  6:  [0.88, 0.72, 0.55],   // rough-terrain — warm peach
  4:  [0.88, 0.82, 0.88],   // mountain — light lilac
  1:  [0.70, 0.55, 0.50],   // cave — rosy brown
  8:  [0.85, 0.75, 0.92],   // urban — bright lavender
  5:  [0.95, 0.88, 0.55],   // rare — bright gold
};

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

function terraceElevation(elev) {
  if (elev < WATER_LEVEL) return WATER_LEVEL * 0.35;
  return Math.round(elev * ELEVATION_STEPS) / ELEVATION_STEPS;
}

// Check if a hex (col, row) is inside a hexagonal world shape
function isInsideHexWorld(col, row, cols, rows) {
  // Map to centered coordinates
  const centerCol = cols / 2;
  const centerRow = rows / 2;
  const radius = Math.min(cols, rows) / 2;

  // Convert to hex axial coordinates
  const q = col - centerCol;
  const r = row - centerRow;
  const s = -q - r;

  // Hexagonal distance from center
  const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
  return dist <= radius * 0.92; // slight inset for clean edge
}

function buildHexTile(cx, cz, topY, radius, thickness) {
  const bottomY = topY - thickness;
  const positions = [];
  const normals = [];

  const corners = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    corners.push([
      cx + radius * Math.cos(angle),
      cz + radius * Math.sin(angle),
    ]);
  }

  // Top face
  for (let i = 0; i < 6; i++) {
    const next = (i + 1) % 6;
    positions.push(cx, topY, cz);
    positions.push(corners[i][0], topY, corners[i][1]);
    positions.push(corners[next][0], topY, corners[next][1]);
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }

  // Bottom face
  for (let i = 0; i < 6; i++) {
    const next = (i + 1) % 6;
    positions.push(cx, bottomY, cz);
    positions.push(corners[next][0], bottomY, corners[next][1]);
    positions.push(corners[i][0], bottomY, corners[i][1]);
    normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
  }

  // Sides
  for (let i = 0; i < 6; i++) {
    const next = (i + 1) % 6;
    const [x1, z1] = corners[i];
    const [x2, z2] = corners[next];
    const nmx = (x1 + x2) / 2 - cx;
    const nmz = (z1 + z2) / 2 - cz;
    const nmLen = Math.sqrt(nmx * nmx + nmz * nmz) || 1;
    const nx = nmx / nmLen;
    const nz = nmz / nmLen;

    positions.push(x1, topY, z1, x2, topY, z2, x1, bottomY, z1);
    normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz);
    positions.push(x2, topY, z2, x2, bottomY, z2, x1, bottomY, z1);
    normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz);
  }

  return { positions, normals };
}

export default function TerrainMesh({ mapData }) {
  const { width, height, grid, elevation, biome_colors } = mapData;

  const biomeColorMap = useMemo(() => {
    const map = {};
    for (const [idStr, rawColor] of Object.entries(biome_colors)) {
      map[parseInt(idStr)] = BIOME_PALETTE[matchBaseId(rawColor)] || [0.7, 0.7, 0.7];
    }
    return map;
  }, [biome_colors]);

  const geometry = useMemo(() => {
    const allPositions = [];
    const allNormals = [];
    const allColors = [];

    const hexColSpacing = HEX_SIZE * Math.sqrt(3);
    const hexRowSpacing = HEX_SIZE * 1.5;
    const cols = Math.floor(width / HEX_STEP);
    const rows = Math.floor(height / HEX_STEP);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Hex world boundary — only render inside hexagonal shape
        if (!isInsideHexWorld(col, row, cols, rows)) continue;

        const gx = col * HEX_STEP;
        const gz = row * HEX_STEP;
        if (gx >= width || gz >= height) continue;

        const worldX = col * hexColSpacing + (row % 2 === 1 ? hexColSpacing * 0.5 : 0);
        const worldZ = row * hexRowSpacing;

        const idx = Math.min(gz, height - 1) * width + Math.min(gx, width - 1);
        const rawElev = elevation[idx] / 255;
        const elev = terraceElevation(rawElev);
        const topY = elev * HEIGHT_SCALE;

        const biomeId = grid[idx];
        const baseColor = biomeColorMap[biomeId] || [0.7, 0.7, 0.7];

        // Bright pastel with elevation warmth
        const tone = 0.95 + elev * 0.08;
        const topColor = [
          Math.min(1, baseColor[0] * tone + 0.02),
          Math.min(1, baseColor[1] * tone + 0.02),
          Math.min(1, baseColor[2] * tone + 0.02),
        ];
        // Sides: slightly deeper + cooler for glass depth
        const sideColor = [
          Math.min(1, baseColor[0] * 0.80 + 0.08),
          Math.min(1, baseColor[1] * 0.80 + 0.08),
          Math.min(1, baseColor[2] * 0.80 + 0.12),
        ];
        const bottomColor = [
          Math.min(1, baseColor[0] * 0.70 + 0.10),
          Math.min(1, baseColor[1] * 0.70 + 0.10),
          Math.min(1, baseColor[2] * 0.70 + 0.14),
        ];

        const hex = buildHexTile(worldX, worldZ, topY, HEX_SIZE * 0.93, HEX_THICKNESS);

        for (let i = 0; i < hex.positions.length; i++) {
          allPositions.push(hex.positions[i]);
          allNormals.push(hex.normals[i]);
        }

        const topVerts = 6 * 3;
        const bottomVerts = 6 * 3;
        const totalVerts = hex.positions.length / 3;

        for (let v = 0; v < totalVerts; v++) {
          if (v < topVerts) {
            allColors.push(topColor[0], topColor[1], topColor[2]);
          } else if (v < topVerts + bottomVerts) {
            allColors.push(bottomColor[0], bottomColor[1], bottomColor[2]);
          } else {
            allColors.push(sideColor[0], sideColor[1], sideColor[2]);
          }
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(allNormals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(allColors, 3));
    return geo;
  }, [mapData, biomeColorMap]);

  return (
    <>
      {/* Main hex tiles — liquid glass material */}
      <mesh geometry={geometry}>
        <meshPhysicalMaterial
          vertexColors
          roughness={0.15}
          metalness={0.05}
          clearcoat={0.8}
          clearcoatRoughness={0.2}
          reflectivity={0.5}
          flatShading
        />
      </mesh>
      {/* Subtle glass overlay for sheen */}
      <mesh geometry={geometry}>
        <meshPhysicalMaterial
          color="#ffffff"
          transparent
          opacity={0.06}
          roughness={0.0}
          metalness={0.1}
          clearcoat={1.0}
          clearcoatRoughness={0.05}
          flatShading
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

// Height lookup
export function getTerrainHeight(elevation, width, gx, gz) {
  const ix = Math.floor(Math.max(0, Math.min(width - 1, gx)));
  const iz = Math.floor(Math.max(0, Math.min(width - 1, gz)));
  const rawElev = elevation[iz * width + ix] / 255;
  return terraceElevation(rawElev) * HEIGHT_SCALE;
}

// Grid to hex world coords
export function gridToHexWorld(gx, gz, width) {
  const col = gx / HEX_STEP;
  const row = gz / HEX_STEP;
  const hexColSpacing = HEX_SIZE * Math.sqrt(3);
  const hexRowSpacing = HEX_SIZE * 1.5;
  const worldX = col * hexColSpacing + (Math.floor(row) % 2 === 1 ? hexColSpacing * 0.5 : 0);
  const worldZ = row * hexRowSpacing;
  return [worldX, worldZ];
}

// Check if grid coords fall inside hex world
export function isGridInsideHexWorld(gx, gz, width, height) {
  const cols = Math.floor(width / HEX_STEP);
  const rows = Math.floor(height / HEX_STEP);
  const col = Math.floor(gx / HEX_STEP);
  const row = Math.floor(gz / HEX_STEP);
  return isInsideHexWorld(col, row, cols, rows);
}

export function getBiomeBaseId(grid, biome_colors, gx, gz, width) {
  const ix = Math.floor(Math.max(0, Math.min(width - 1, gx)));
  const iz = Math.floor(Math.max(0, Math.min(width - 1, gz)));
  const biomeId = grid[iz * width + ix];
  const rawColor = biome_colors[String(biomeId)] || [128, 128, 128];
  return matchBaseId(rawColor);
}

export function getHexWorldSize(width, height) {
  const hexColSpacing = HEX_SIZE * Math.sqrt(3);
  const hexRowSpacing = HEX_SIZE * 1.5;
  const cols = Math.floor(width / HEX_STEP);
  const rows = Math.floor(height / HEX_STEP);
  return [cols * hexColSpacing, rows * hexRowSpacing];
}

export { HEIGHT_SCALE, WATER_LEVEL, BIOME_PALETTE, HEX_SIZE, HEX_STEP };
