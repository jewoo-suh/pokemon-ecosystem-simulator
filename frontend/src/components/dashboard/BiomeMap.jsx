import { useRef, useEffect, useState, useCallback, useMemo } from 'react';

const SCALE = 14;
const MAX_DOTS_PER_ENTRY = 8;
const SPRITE_SIZE = 18;
const SPRITE_BASE = import.meta.env.BASE_URL + 'data/sprites/';

const zoomBtnStyle = {
  width: 26, height: 26, padding: 0,
  background: 'rgba(255,255,255,0.08)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4,
  cursor: 'pointer', fontSize: 16, fontWeight: 700, lineHeight: 1,
};

const COLOR_MODES = [
  { key: 'biome', label: 'Biome' },
  { key: 'population', label: 'Population' },
  { key: 'food', label: 'Food' },
  { key: 'diversity', label: 'Diversity' },
];

const TROPHIC_COLORS_RGB = {
  producer: [106, 191, 105],
  primary_consumer: [91, 155, 213],
  secondary_consumer: [232, 148, 74],
  apex_predator: [232, 107, 138],
  decomposer: [139, 107, 191],
};

function lerp(a, b, t) { return a + (b - a) * t; }

function colorLerp(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}

function popColor(value, max) {
  const t = max > 0 ? Math.min(value / max, 1) : 0;
  return colorLerp([245, 240, 255], [106, 50, 180], t);
}

function foodColor(value) {
  if (value >= 0.7) return colorLerp([255, 220, 50], [80, 180, 80], (value - 0.7) / 0.3);
  if (value >= 0.4) return colorLerp([220, 80, 60], [255, 220, 50], (value - 0.4) / 0.3);
  return colorLerp([180, 40, 40], [220, 80, 60], value / 0.4);
}

function diversityColor(value, max) {
  const t = max > 0 ? Math.min(value / max, 1) : 0;
  return colorLerp([240, 245, 255], [40, 80, 180], t);
}

// Seeded RNG for consistent dot positions
function mulberry32(seed) {
  let t = seed + 0x6D2B79F5;
  return function () {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function BiomeMap({
  mapData,
  biomeTimeseries,
  currentBiomeData,
  tickIdx,
  colorMode,
  onColorModeChange,
  selectedBiomeId,
  onSelectBiome,
  hoveredBiomeId,
  onHoverBiome,
  biomeDetails,
  events,
  animFrame,
  selectedSpeciesId,
}) {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const terrainCacheRef = useRef(null);
  const spriteCacheRef = useRef({}); // { [pokemonId]: { img, loaded, failed } }
  const [spriteTick, setSpriteTick] = useState(0); // bump to re-render when sprites load
  const [tooltip, setTooltip] = useState(null);
  const [flashBiomes, setFlashBiomes] = useState(new Set());
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const dragRef = useRef({ active: false, startX: 0, startY: 0, panX: 0, panY: 0, moved: false });
  const [animT, setAnimT] = useState(0); // ms timestamp for sprite bob

  // Build biome cell lookup from mapData
  const biomeCells = useMemo(() => {
    if (!mapData) return null;
    const cells = {};
    for (let y = 0; y < mapData.height; y++) {
      for (let x = 0; x < mapData.width; x++) {
        const bid = mapData.grid[y * mapData.width + x];
        if (!cells[bid]) cells[bid] = [];
        cells[bid].push({ x, y });
      }
    }
    return cells;
  }, [mapData]);

  // Pre-compute dot slot positions per species-biome combo
  // Each gets MAX_DOTS_PER_ENTRY random positions within the biome's cells
  const dotSlots = useMemo(() => {
    if (!biomeCells || !biomeDetails) return null;
    const rng = mulberry32(42);
    const slots = {};

    for (const [bidStr, detail] of Object.entries(biomeDetails)) {
      const bid = Number(bidStr);
      const cells = biomeCells[bid];
      if (!cells || cells.length === 0) continue;

      if (!detail.species) continue;
      for (const sp of detail.species) {
        const key = `${sp.pokemon_id}-${bid}`;
        const positions = [];
        for (let i = 0; i < MAX_DOTS_PER_ENTRY; i++) {
          const cell = cells[Math.floor(rng() * cells.length)];
          positions.push({
            x: cell.x * SCALE + Math.floor(rng() * SCALE),
            y: cell.y * SCALE + Math.floor(rng() * SCALE),
          });
        }
        slots[key] = {
          positions,
          trophic: sp.trophic_level,
        };
      }
    }
    return slots;
  }, [biomeCells, biomeDetails]);

  // Build current dots from animFrame species data
  const dots = useMemo(() => {
    if (!animFrame?.species || !dotSlots) return [];
    const result = [];
    const tracking = selectedSpeciesId != null;
    for (const sp of animFrame.species) {
      const key = `${sp.id}-${sp.biome_id}`;
      const slot = dotSlots[key];
      if (!slot) continue;

      const isTracked = tracking && sp.id === selectedSpeciesId;
      if (tracking && !isTracked) continue;

      const numDots = Math.max(1, Math.min(MAX_DOTS_PER_ENTRY, Math.ceil(sp.population / 80)));
      const rgb = TROPHIC_COLORS_RGB[sp.trophic] || TROPHIC_COLORS_RGB.producer;
      for (let i = 0; i < numDots; i++) {
        result.push({
          x: slot.positions[i].x,
          y: slot.positions[i].y,
          rgb,
          pokemonId: sp.id,
          tracked: isTracked,
        });
      }
    }
    return result;
  }, [animFrame?.species, dotSlots, selectedSpeciesId]);

  // rAF-driven time ticker for sprite bob (only when sim is active)
  useEffect(() => {
    if (!animFrame) return;
    let rafId;
    let lastSet = 0;
    const step = (now) => {
      if (now - lastSet > 50) { // ~20fps is plenty for bob
        setAnimT(now);
        lastSet = now;
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [animFrame]);

  // Preload sprite images for currently-visible pokemon
  useEffect(() => {
    if (!dots || dots.length === 0) return;
    const cache = spriteCacheRef.current;
    const unique = new Set(dots.map(d => d.pokemonId));
    let pending = 0;
    for (const id of unique) {
      if (cache[id]) continue;
      const entry = { img: new Image(), loaded: false, failed: false };
      cache[id] = entry;
      pending++;
      entry.img.onload = () => { entry.loaded = true; setSpriteTick(t => t + 1); };
      entry.img.onerror = () => { entry.failed = true; setSpriteTick(t => t + 1); };
      entry.img.src = `${SPRITE_BASE}${id}.png`;
    }
    // avoid unused var warning
    void pending;
  }, [dots]);

  // Biome ID to timeseries index lookup
  const biomeIdxMap = useMemo(() => {
    if (!biomeTimeseries) return {};
    const map = {};
    biomeTimeseries.biome_ids.forEach((id, idx) => { map[id] = idx; });
    return map;
  }, [biomeTimeseries]);

  // Get current values for all biomes at current tick
  const currentValues = useMemo(() => {
    if (!biomeTimeseries || tickIdx < 0) return null;
    const vals = {};
    for (let i = 0; i < biomeTimeseries.biome_ids.length; i++) {
      const bid = biomeTimeseries.biome_ids[i];
      vals[bid] = {
        population: biomeTimeseries.population[i]?.[tickIdx] || 0,
        food: biomeTimeseries.avg_food[i]?.[tickIdx] || 0.5,
        diversity: biomeTimeseries.species_count[i]?.[tickIdx] || 0,
      };
    }
    return vals;
  }, [biomeTimeseries, tickIdx]);

  const maxPop = useMemo(() => {
    if (!currentValues) return 1;
    return Math.max(1, ...Object.values(currentValues).map(v => v.population));
  }, [currentValues]);

  const maxDiversity = useMemo(() => {
    if (!currentValues) return 1;
    return Math.max(1, ...Object.values(currentValues).map(v => v.diversity));
  }, [currentValues]);

  // Flash biomes on events
  useEffect(() => {
    if (!events || events.length === 0) return;
    const biomeIds = new Set();
    for (const e of events) {
      if (e.biome_id) biomeIds.add(e.biome_id);
    }
    if (biomeIds.size === 0) return;
    setFlashBiomes(biomeIds);
    const timer = setTimeout(() => setFlashBiomes(new Set()), 500);
    return () => clearTimeout(timer);
  }, [events]);

  // Cache terrain ImageData
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
    terrainCacheRef.current = imageData;
  }, [mapData]);

  // Main render
  useEffect(() => {
    if (!mapData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const w = mapData.width * SCALE;
    const h = mapData.height * SCALE;
    canvas.width = w;
    canvas.height = h;

    const { width, height, grid, biome_colors } = mapData;

    if (colorMode === 'biome' && terrainCacheRef.current) {
      ctx.putImageData(terrainCacheRef.current, 0, 0);
    } else if (currentValues) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const biomeId = grid[y * width + x];
          const vals = currentValues[biomeId];
          let color;
          if (!vals) {
            color = biome_colors[String(biomeId)] || [0, 0, 0];
          } else if (colorMode === 'population') {
            color = popColor(vals.population, maxPop);
          } else if (colorMode === 'food') {
            color = foodColor(vals.food);
          } else if (colorMode === 'diversity') {
            color = diversityColor(vals.diversity, maxDiversity);
          } else {
            color = biome_colors[String(biomeId)] || [0, 0, 0];
          }
          ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
          ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
        }
      }
    } else if (terrainCacheRef.current) {
      ctx.putImageData(terrainCacheRef.current, 0, 0);
    }

    // Draw population sprites (fallback to colored dot if sprite not loaded)
    if (dots.length > 0) {
      const cache = spriteCacheRef.current;
      ctx.imageSmoothingEnabled = false;
      const tSec = animT / 1000;
      for (let i = 0; i < dots.length; i++) {
        const dot = dots[i];
        const entry = cache[dot.pokemonId];
        const size = dot.tracked ? SPRITE_SIZE + 4 : SPRITE_SIZE;
        // Bob: seeded phase per sprite (pokemonId + index) so they bob out-of-sync
        const phase = (dot.pokemonId * 0.73) + i * 0.41;
        const bobY = Math.sin(tSec * 2.2 + phase) * 2;
        const driftX = Math.sin(tSec * 0.9 + phase * 1.7) * 1.2;
        const x = dot.x - size / 2 + driftX;
        const y = dot.y - size / 2 + bobY;
        if (entry && entry.loaded) {
          if (dot.tracked) {
            ctx.save();
            ctx.shadowColor = 'rgba(255,255,255,0.9)';
            ctx.shadowBlur = 4;
            ctx.drawImage(entry.img, x, y, size, size);
            ctx.restore();
          } else {
            ctx.drawImage(entry.img, x, y, size, size);
          }
        } else {
          // Fallback: small trophic-colored circle
          ctx.fillStyle = `rgba(${dot.rgb[0]},${dot.rgb[1]},${dot.rgb[2]},0.85)`;
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Highlight selected biome
    if (selectedBiomeId != null && biomeCells) {
      const cells = biomeCells[selectedBiomeId];
      if (cells) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 1;
        for (const { x, y } of cells) {
          ctx.strokeRect(x * SCALE, y * SCALE, SCALE, SCALE);
        }
      }
    }

    // Highlight hovered biome
    if (hoveredBiomeId != null && hoveredBiomeId !== selectedBiomeId && biomeCells) {
      const cells = biomeCells[hoveredBiomeId];
      if (cells) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        for (const { x, y } of cells) {
          ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
        }
      }
    }

    // Flash biomes on events
    if (flashBiomes.size > 0 && biomeCells) {
      for (const bid of flashBiomes) {
        const cells = biomeCells[bid];
        if (cells) {
          ctx.fillStyle = 'rgba(232, 107, 138, 0.35)';
          for (const { x, y } of cells) {
            ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
          }
        }
      }
    }
  }, [mapData, colorMode, currentValues, maxPop, maxDiversity, selectedBiomeId, hoveredBiomeId, flashBiomes, biomeCells, dots, selectedSpeciesId, spriteTick, animT]);

  // Mouse handling
  const handleMouseMove = useCallback((e) => {
    // Drag-to-pan takes priority
    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (!dragRef.current.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        dragRef.current.moved = true;
      }
      if (dragRef.current.moved) {
        setView(v => ({ ...v, panX: dragRef.current.panX + dx, panY: dragRef.current.panY + dy }));
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas || !mapData) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = Math.floor((e.clientX - rect.left) * scaleX / SCALE);
    const my = Math.floor((e.clientY - rect.top) * scaleY / SCALE);

    if (mx < 0 || mx >= mapData.width || my < 0 || my >= mapData.height) {
      onHoverBiome(null);
      setTooltip(null);
      return;
    }

    const biomeId = mapData.grid[my * mapData.width + mx];
    onHoverBiome(biomeId);

    const biomeName = biomeTimeseries?.biome_names[biomeIdxMap[biomeId]] || `Biome ${biomeId}`;
    const vals = currentValues?.[biomeId];
    const bd = currentBiomeData?.[biomeId];

    setTooltip({
      x: e.clientX,
      y: e.clientY,
      biomeId,
      name: biomeName,
      population: bd?.population ?? vals?.population ?? 0,
      species: bd?.speciesCount ?? vals?.diversity ?? 0,
      food: vals?.food ?? 0.5,
    });
  }, [mapData, biomeTimeseries, biomeIdxMap, currentValues, currentBiomeData, onHoverBiome]);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragRef.current = {
      active: true, moved: false,
      startX: e.clientX, startY: e.clientY,
      panX: view.panX, panY: view.panY,
    };
  }, [view.panX, view.panY]);

  const handleMouseUp = useCallback(() => {
    dragRef.current.active = false;
  }, []);

  const handleClick = useCallback(() => {
    if (dragRef.current.moved) { dragRef.current.moved = false; return; }
    if (hoveredBiomeId != null) {
      onSelectBiome(hoveredBiomeId === selectedBiomeId ? null : hoveredBiomeId);
    }
  }, [hoveredBiomeId, selectedBiomeId, onSelectBiome]);

  const handleMouseLeave = useCallback(() => {
    onHoverBiome(null);
    setTooltip(null);
  }, [onHoverBiome]);

  // Wheel to zoom, anchored at cursor
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = wrapper.getBoundingClientRect();
      const cx = e.clientX - (rect.left + rect.width / 2);
      const cy = e.clientY - (rect.top + rect.height / 2);
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      setView(v => {
        const newZoom = Math.max(1, Math.min(6, v.zoom * factor));
        if (newZoom === v.zoom) return v;
        const ratio = newZoom / v.zoom;
        return {
          zoom: newZoom,
          panX: cx * (1 - ratio) + v.panX * ratio,
          panY: cy * (1 - ratio) + v.panY * ratio,
        };
      });
    };
    wrapper.addEventListener('wheel', onWheel, { passive: false });
    return () => wrapper.removeEventListener('wheel', onWheel);
  }, []);

  // Release drag if mouse is released outside canvas
  useEffect(() => {
    const onUp = () => { dragRef.current.active = false; };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  const zoomByButton = useCallback((factor) => {
    setView(v => {
      const newZoom = Math.max(1, Math.min(6, v.zoom * factor));
      if (newZoom === v.zoom) return v;
      const ratio = newZoom / v.zoom;
      return { zoom: newZoom, panX: v.panX * ratio, panY: v.panY * ratio };
    });
  }, []);
  const resetView = useCallback(() => setView({ zoom: 1, panX: 0, panY: 0 }), []);

  if (!mapData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
        Loading map...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Color mode buttons */}
      <div className="map-color-modes">
        {COLOR_MODES.map(mode => (
          <button
            key={mode.key}
            onClick={() => onColorModeChange(mode.key)}
            className={`map-color-mode-btn ${colorMode === mode.key ? 'active' : ''}`}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <div
        ref={wrapperRef}
        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}
      >
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
          onMouseLeave={handleMouseLeave}
          style={{
            cursor: dragRef.current.active ? 'grabbing' : (view.zoom > 1 ? 'grab' : (hoveredBiomeId != null ? 'pointer' : 'default')),
            maxWidth: '100%',
            maxHeight: '100%',
            imageRendering: 'pixelated',
            borderRadius: 'var(--radius-sm)',
            transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
            transformOrigin: 'center center',
            transition: dragRef.current.active ? 'none' : 'transform 0.08s ease-out',
          }}
        />

        {/* Zoom controls */}
        <div style={{
          position: 'absolute', bottom: 10, right: 10, zIndex: 5,
          display: 'flex', flexDirection: 'column', gap: 4,
          background: 'rgba(26,26,46,0.85)', padding: 4, borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <button onClick={() => zoomByButton(1.3)} title="Zoom in" style={zoomBtnStyle}>+</button>
          <button onClick={() => zoomByButton(1 / 1.3)} title="Zoom out" style={zoomBtnStyle}>−</button>
          <button onClick={resetView} title="Reset view" style={{ ...zoomBtnStyle, fontSize: 10 }}>⟲</button>
        </div>

        {/* Tooltip */}
        {tooltip && (
          <div style={{
            position: 'fixed',
            left: tooltip.x + 14,
            top: tooltip.y - 12,
            background: 'rgba(26, 26, 46, 0.95)',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            pointerEvents: 'none',
            zIndex: 100,
            border: '1px solid rgba(255,255,255,0.1)',
            minWidth: 140,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4, textTransform: 'capitalize' }}>
              {tooltip.name}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
              <span>Population: {tooltip.population.toLocaleString()}</span>
              <span>Species: {tooltip.species}</span>
              <span>Food: {Math.round(tooltip.food * 100)}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
