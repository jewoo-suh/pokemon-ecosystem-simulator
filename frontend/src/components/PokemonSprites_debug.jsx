// Quick debug test - minimal sprite render
import { useState, useEffect } from 'react';
import * as THREE from 'three';
import { getTerrainHeight, WATER_LEVEL, HEIGHT_SCALE, gridToHexWorld, isGridInsideHexWorld } from './TerrainMesh';

const API = 'http://localhost:8000';

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
  const tex = loader.load(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemonId}.png`);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache[pokemonId] = tex;
  return tex;
}

export default function PokemonSprites({ mapData, biomeCells, animFrame }) {
  const [dots, setDots] = useState([]);

  const { width, height: mapHeight, elevation } = mapData;

  useEffect(() => {
    if (!biomeCells) return;

    console.log('[PokemonSprites] Loading biomes...');

    fetch(`${API}/biomes`)
      .then(r => r.json())
      .then(biomes => {
        console.log(`[PokemonSprites] Got ${biomes.length} biomes`);
        return Promise.all(biomes.map(b => fetch(`${API}/biomes/${b.id}`).then(r => r.json())));
      })
      .then(biomeDetails => {
        console.log(`[PokemonSprites] Got details for ${biomeDetails.length} biomes`);
        const rng = mulberry32(42);
        const allDots = [];

        for (const biome of biomeDetails) {
          const cells = biomeCells[biome.id];
          if (!cells || cells.length === 0) continue;

          for (const sp of biome.species) {
            if (sp.population <= 0) continue;

            const numDots = Math.max(1, Math.min(5, Math.ceil(sp.population / 80)));

            for (let i = 0; i < numDots; i++) {
              let placed = false;
              for (let attempt = 0; attempt < 10; attempt++) {
                const cell = cells[Math.floor(rng() * cells.length)];
                const gx = cell.x + rng() * 0.8;
                const gz = cell.y + rng() * 0.8;

                if (!isGridInsideHexWorld(gx, gz, width, mapHeight)) continue;

                const [wx, wz] = gridToHexWorld(gx, gz, width);
                const ix = Math.floor(gx);
                const iz = Math.floor(gz);
                const rawElev = elevation[iz * width + ix] / 255;
                const gy = rawElev < WATER_LEVEL
                  ? WATER_LEVEL * 0.35 * HEIGHT_SCALE + 1.5
                  : getTerrainHeight(elevation, width, gx, gz) + 1.2;

                allDots.push({
                  x: wx, y: gy, z: wz,
                  id: sp.pokemon_id,
                });
                placed = true;
                break;
              }
            }
          }
        }

        // Cap at 500
        const capped = allDots.length > 500
          ? allDots.filter((_, i) => i % Math.ceil(allDots.length / 500) === 0)
          : allDots;

        console.log(`[PokemonSprites] ${allDots.length} dots total, showing ${capped.length}`);
        setDots(capped);
      });
  }, [biomeCells]);

  console.log(`[PokemonSprites] Rendering ${dots.length} dots`);

  if (dots.length === 0) return null;

  return (
    <group>
      {dots.map((dot, i) => {
        const tex = getTexture(dot.id);
        return (
          <sprite key={i} position={[dot.x, dot.y, dot.z]} scale={[1.6, 1.6, 1.6]}>
            <spriteMaterial map={tex} transparent alphaTest={0.1} depthWrite={false} />
          </sprite>
        );
      })}
    </group>
  );
}
