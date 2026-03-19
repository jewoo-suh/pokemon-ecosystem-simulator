import { useState, useEffect, Suspense, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrthographicCamera, MapControls } from '@react-three/drei';
import * as THREE from 'three';
import TerrainMesh, { WATER_LEVEL, HEIGHT_SCALE } from './TerrainMesh';
import BiomeDecorations from './BiomeDecorations';
import PokemonSprites3D from './PokemonSprites3D';
import { getMap, getStatus } from '../data';

const WATER_SEASON_COLORS = {
  spring: '#5b9bd5',
  summer: '#6ba5c5',
  autumn: '#7a9db0',
  winter: '#8bb8de',
};

function getSeason(tick) {
  const t = tick % 100;
  if (t < 25) return 'spring';
  if (t < 50) return 'summer';
  if (t < 75) return 'autumn';
  return 'winter';
}

const EVENT_PULSE_COLORS = {
  extinction: '#e86b8a',
  fire: '#e8944a',
  drought: '#e8944a',
  flood: '#5b9bd5',
  bloom: '#5cb85c',
  disease: '#8b6bbf',
  disaster: '#e86b8a',
};

function WaterPlane({ width, height, season }) {
  const ref = useRef();
  const matRef = useRef();
  const waterY = WATER_LEVEL * 0.4 * HEIGHT_SCALE;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.y = waterY + Math.sin(clock.elapsedTime * 0.4) * 0.06;
  });

  // Update water color on season change
  useEffect(() => {
    if (matRef.current) {
      matRef.current.color.set(WATER_SEASON_COLORS[season] || WATER_SEASON_COLORS.spring);
    }
  }, [season]);

  return (
    <mesh ref={ref} position={[width / 2, waterY, height / 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width + 4, height + 4]} />
      <meshPhongMaterial
        ref={matRef}
        color={WATER_SEASON_COLORS[season] || '#5b9bd5'}
        transparent opacity={0.55} shininess={80}
        specular={new THREE.Color(0.3, 0.4, 0.5)}
      />
    </mesh>
  );
}

function BiomePulse({ biomeCells, events }) {
  const MAX_PULSES = 8;
  const meshRefs = useRef([]);
  const pulsesRef = useRef([]);
  const prevEventsRef = useRef(null);

  // Add new pulses when events change
  useEffect(() => {
    if (!events || events.length === 0 || events === prevEventsRef.current) return;
    prevEventsRef.current = events;

    const now = performance.now();
    for (const ev of events) {
      const biomeId = ev.biome_id;
      if (!biomeId || !biomeCells[biomeId]) continue;

      const cells = biomeCells[biomeId];
      const cx = cells.reduce((s, c) => s + c.x, 0) / cells.length;
      const cz = cells.reduce((s, c) => s + c.y, 0) / cells.length;

      // Find bounds for sizing
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const c of cells) {
        minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
        minZ = Math.min(minZ, c.y); maxZ = Math.max(maxZ, c.y);
      }
      const sx = Math.max(3, (maxX - minX) * 0.6);
      const sz = Math.max(3, (maxZ - minZ) * 0.6);

      pulsesRef.current.push({
        x: cx, z: cz, sx, sz,
        color: EVENT_PULSE_COLORS[ev.type] || '#ffffff',
        startTime: now,
      });

      // Cap
      if (pulsesRef.current.length > MAX_PULSES) {
        pulsesRef.current = pulsesRef.current.slice(-MAX_PULSES);
      }
    }
  }, [events, biomeCells]);

  useFrame(() => {
    const now = performance.now();
    const DURATION = 1500;

    for (let i = 0; i < MAX_PULSES; i++) {
      const mesh = meshRefs.current[i];
      if (!mesh) continue;

      const pulse = pulsesRef.current[i];
      if (!pulse) {
        mesh.visible = false;
        continue;
      }

      const elapsed = now - pulse.startTime;
      if (elapsed > DURATION) {
        mesh.visible = false;
        continue;
      }

      const t = elapsed / DURATION;
      mesh.visible = true;
      mesh.position.set(pulse.x, WATER_LEVEL * 0.4 * HEIGHT_SCALE + 6, pulse.z);
      mesh.scale.set(pulse.sx * (1 + t * 0.3), 1, pulse.sz * (1 + t * 0.3));
      mesh.material.color.set(pulse.color);
      mesh.material.opacity = 0.3 * (1 - t);
    }

    // Clean expired
    pulsesRef.current = pulsesRef.current.filter(p => (now - p.startTime) < DURATION);
  });

  return (
    <group>
      {Array.from({ length: MAX_PULSES }, (_, i) => (
        <mesh
          key={i}
          ref={el => { meshRefs.current[i] = el; }}
          visible={false}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

export default function IsometricScene({ onSpeciesClick, onTickLoaded, animFrame, frozen, events }) {
  const [mapData, setMapData] = useState(null);
  const [biomeCells, setBiomeCells] = useState(null);

  useEffect(() => {
    getMap().then(data => {
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

  useEffect(() => {
    getStatus().then(data => { if (onTickLoaded) onTickLoaded(data.current_tick); });
  }, []);

  // Extract season from animFrame or default
  const season = animFrame?.season || 'spring';

  if (!mapData || !mapData.elevation) {
    return (
      <div style={{
        color: 'var(--text-muted)', padding: 40,
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-primary)', fontSize: 16,
      }}>
        Loading world...
      </div>
    );
  }

  const cx = mapData.width / 2;
  const cz = mapData.height / 2;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 }}
        style={{ width: '100%', height: '100%' }}
      >
        <color attach="background" args={['#e8edf5']} />
        <fog attach="fog" args={['#e8edf5', 120, 350]} />

        <OrthographicCamera
          makeDefault zoom={3.5}
          position={[cx + 80, 80, cz + 80]}
          near={0.1} far={600}
        />
        <MapControls
          enableRotate={false}
          target={[cx, 4, cz]}
          minZoom={1} maxZoom={25} panSpeed={1.5}
        />

        <ambientLight intensity={0.65} color="#fff5ee" />
        <directionalLight position={[cx + 80, 100, cz - 50]} intensity={0.75} color="#fff5e8" />
        <directionalLight position={[cx - 50, 40, cz + 60]} intensity={0.25} color="#c0d8ff" />
        <hemisphereLight args={['#dde8f0', '#5a6840', 0.3]} />

        <Suspense fallback={null}>
          <TerrainMesh mapData={mapData} season={season} />
          <WaterPlane width={mapData.width} height={mapData.height} season={season} />
          <BiomeDecorations mapData={mapData} />
          {biomeCells && (
            <>
              <PokemonSprites3D
                mapData={mapData}
                biomeCells={biomeCells}
                animFrame={animFrame}
                frozen={frozen}
              />
              <BiomePulse biomeCells={biomeCells} events={events} />
            </>
          )}
        </Suspense>
      </Canvas>
    </div>
  );
}
