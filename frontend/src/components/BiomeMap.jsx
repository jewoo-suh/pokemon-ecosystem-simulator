import { useRef, useEffect, useState, useCallback } from 'react';

const API = 'http://localhost:8000';
const SCALE = 3;
const MAX_DOTS_PER_SPECIES = 30;

const TROPHIC_COLORS = {
  producer: '#78C850',
  primary_consumer: '#6890F0',
  secondary_consumer: '#F08030',
  apex_predator: '#F85888',
  decomposer: '#A040A0',
};

export default function BiomeMap({ onSpeciesClick, onTickLoaded, animFrame }) {
  const canvasRef = useRef(null);
  const terrainRef = useRef(null); // cached terrain ImageData
  const [mapData, setMapData] = useState(null);
  const [biomeCells, setBiomeCells] = useState(null);
  const [dotSlots, setDotSlots] = useState(null); // pre-computed positions: Map<"pid-bid" -> [{x,y}, ...]>
  const [dots, setDots] = useState([]);
  const [tooltip, setTooltip] = useState(null);
  const [hoveredName, setHoveredName] = useState(null);

  // Load map + biome cell positions once
  useEffect(() => {
    fetch(`${API}/simulation/map`)
      .then(r => r.json())
      .then(data => {
        setMapData(data);
        const cells = {};
        for (let y = 0; y < data.height; y++) {
          for (let x = 0; x < data.width; x++) {
            const bid = data.grid[y * data.width + x];
            if (!cells[bid]) cells[bid] = [];
            cells[bid].push({ x, y });
          }
        }
        setBiomeCells(cells);
      });
  }, []);

  // Load current tick
  useEffect(() => {
    fetch(`${API}/simulation/status`)
      .then(r => r.json())
      .then(data => { if (onTickLoaded) onTickLoaded(data.current_tick); });
  }, []);

  // Pre-compute dot slot positions for all species-biome combos
  // Each gets MAX_DOTS_PER_SPECIES positions pre-assigned
  useEffect(() => {
    if (!biomeCells) return;

    fetch(`${API}/biomes`)
      .then(r => r.json())
      .then(biomes =>
        Promise.all(biomes.map(b => fetch(`${API}/biomes/${b.id}`).then(r => r.json())))
      )
      .then(biomeDetails => {
        const rng = mulberry32(42);
        const slots = {};

        for (const biome of biomeDetails) {
          const cells = biomeCells[biome.id];
          if (!cells || cells.length === 0) continue;

          for (const sp of biome.species) {
            const key = `${sp.pokemon_id}-${biome.id}`;
            slots[key] = {
              positions: [],
              name: sp.name,
              trophic: sp.trophic_level,
              id: sp.pokemon_id,
              biome: biome.name,
              biome_id: biome.id,
              color: TROPHIC_COLORS[sp.trophic_level] || '#A8A878',
            };

            for (let i = 0; i < MAX_DOTS_PER_SPECIES; i++) {
              const cell = cells[Math.floor(rng() * cells.length)];
              slots[key].positions.push({
                x: cell.x * SCALE + Math.floor(rng() * SCALE),
                y: cell.y * SCALE + Math.floor(rng() * SCALE),
              });
            }
          }
        }

        setDotSlots(slots);

        // Also build initial dots from current populations
        const initialDots = [];
        for (const biome of biomeDetails) {
          for (const sp of biome.species) {
            if (sp.population <= 0) continue;
            const key = `${sp.pokemon_id}-${biome.id}`;
            const slot = slots[key];
            if (!slot) continue;
            const numDots = Math.max(1, Math.min(MAX_DOTS_PER_SPECIES, Math.ceil(sp.population / 30)));
            for (let i = 0; i < numDots; i++) {
              initialDots.push({
                ...slot.positions[i],
                color: slot.color,
                name: slot.name,
                population: sp.population,
                trophic: slot.trophic,
                id: slot.id,
                biome: slot.biome,
              });
            }
          }
        }
        setDots(initialDots);
      });
  }, [biomeCells]);

  // When an animation frame arrives, rebuild dots from frame data
  useEffect(() => {
    if (!animFrame || !dotSlots) return;

    const newDots = [];
    for (const sp of animFrame.species) {
      const key = `${sp.id}-${sp.biome_id}`;
      const slot = dotSlots[key];
      if (!slot) continue;

      const numDots = Math.max(1, Math.min(MAX_DOTS_PER_SPECIES, Math.ceil(sp.population / 30)));
      for (let i = 0; i < numDots; i++) {
        newDots.push({
          ...slot.positions[i],
          color: slot.color,
          name: sp.name,
          population: sp.population,
          trophic: sp.trophic,
          id: sp.id,
          biome: sp.biome,
        });
      }
    }
    setDots(newDots);
  }, [animFrame, dotSlots]);

  // Cache terrain ImageData once
  useEffect(() => {
    if (!mapData) return;
    const { width, height, grid, biome_colors } = mapData;
    const imageData = new ImageData(width * SCALE, height * SCALE);
    const pixels = imageData.data;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const biomeId = grid[y * width + x];
        const color = biome_colors[String(biomeId)] || [0, 0, 0];
        for (let sy = 0; sy < SCALE; sy++) {
          for (let sx = 0; sx < SCALE; sx++) {
            const px = x * SCALE + sx;
            const py = y * SCALE + sy;
            const idx = (py * width * SCALE + px) * 4;
            pixels[idx] = color[0];
            pixels[idx + 1] = color[1];
            pixels[idx + 2] = color[2];
            pixels[idx + 3] = 255;
          }
        }
      }
    }
    terrainRef.current = imageData;
  }, [mapData]);

  // Draw terrain + dots (fast: just putImageData + draw circles)
  useEffect(() => {
    if (!terrainRef.current || !canvasRef.current || !mapData) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const w = mapData.width * SCALE;
    const h = mapData.height * SCALE;

    canvas.width = w;
    canvas.height = h;

    // Blit cached terrain
    ctx.putImageData(terrainRef.current, 0, 0);

    // Draw dots
    for (const dot of dots) {
      ctx.fillStyle = dot.color;
      ctx.globalAlpha = hoveredName && dot.name !== hoveredName ? 0.2 : 0.9;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // Highlight ring for hovered species
    if (hoveredName) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      for (const dot of dots) {
        if (dot.name === hoveredName) {
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, 3.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }, [mapData, dots, hoveredName]);

  // Mouse handling
  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    let closest = null;
    let closestDist = 64;
    for (const dot of dots) {
      const dx = dot.x - mx;
      const dy = dot.y - my;
      const dist = dx * dx + dy * dy;
      if (dist < closestDist) {
        closestDist = dist;
        closest = dot;
      }
    }

    if (closest) {
      setHoveredName(closest.name);
      setTooltip({ x: e.clientX, y: e.clientY, ...closest });
    } else {
      setHoveredName(null);
      setTooltip(null);
    }
  }, [dots]);

  const handleClick = useCallback(() => {
    if (hoveredName && onSpeciesClick) {
      const dot = dots.find(d => d.name === hoveredName);
      if (dot) onSpeciesClick(dot);
    }
  }, [hoveredName, dots, onSpeciesClick]);

  if (!mapData) {
    return <div style={{ color: '#888', padding: 40 }}>Loading map...</div>;
  }

  return (
    <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d1a' }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        style={{
          cursor: hoveredName ? 'pointer' : 'default',
          maxWidth: '100%',
          maxHeight: '100%',
          imageRendering: 'pixelated',
        }}
      />
      {tooltip && (
        <div style={{
          position: 'fixed',
          left: tooltip.x + 14,
          top: tooltip.y - 12,
          background: 'rgba(0,0,0,0.9)',
          color: '#fff',
          padding: '6px 10px',
          borderRadius: 6,
          fontSize: 12,
          pointerEvents: 'none',
          zIndex: 100,
          border: '1px solid #333',
        }}>
          <strong style={{ textTransform: 'capitalize' }}>{tooltip.name}</strong>
          <br />
          Pop: {tooltip.population} | {tooltip.biome}
          <br />
          <span style={{ color: '#9ca3af' }}>{tooltip.trophic?.replace('_', ' ')}</span>
        </div>
      )}

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 58, left: 10,
        background: 'rgba(0,0,0,0.7)', padding: '8px 12px',
        borderRadius: 6, fontSize: 11, lineHeight: '18px',
      }}>
        {Object.entries(TROPHIC_COLORS).map(([key, color]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
            {key.replace('_', ' ')}
          </div>
        ))}
      </div>
    </div>
  );
}

function mulberry32(seed) {
  let t = seed + 0x6D2B79F5;
  return function() {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
