import { useState, useEffect, Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrthographicCamera, MapControls } from '@react-three/drei';
import * as THREE from 'three';
import TerrainMesh, { WATER_LEVEL, HEIGHT_SCALE } from './TerrainMesh';
import BiomeDecorations from './BiomeDecorations';
import PokemonSprites from './PokemonSprites';

const API = 'http://localhost:8000';

// Animated water with subtle wave motion
function WaterPlane({ width, height }) {
  const ref = useRef();
  const waterY = WATER_LEVEL * 0.4 * HEIGHT_SCALE;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.y = waterY + Math.sin(clock.elapsedTime * 0.4) * 0.06;
  });

  return (
    <mesh ref={ref} position={[width / 2, waterY, height / 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width + 4, height + 4]} />
      <meshPhongMaterial
        color="#6ba3c7"
        transparent
        opacity={0.6}
        shininess={90}
        specular={new THREE.Color(0.4, 0.45, 0.5)}
      />
    </mesh>
  );
}

export default function IsometricScene({ onSpeciesClick, onTickLoaded, animFrame }) {
  const [mapData, setMapData] = useState(null);
  const [biomeCells, setBiomeCells] = useState(null);

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

  useEffect(() => {
    fetch(`${API}/simulation/status`)
      .then(r => r.json())
      .then(data => { if (onTickLoaded) onTickLoaded(data.current_tick); });
  }, []);

  if (!mapData || !mapData.elevation) {
    return (
      <div style={{
        color: '#8a7a6a', padding: 40, flex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f0e6d8', fontSize: 16, fontFamily: 'Georgia, serif',
      }}>
        Loading world...
      </div>
    );
  }

  const cx = mapData.width / 2;
  const cz = mapData.height / 2;

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <Canvas
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
        }}
        style={{ width: '100%', height: '100%' }}
      >
        {/* Warm pastel sky */}
        <color attach="background" args={['#e8ddd0']} />
        <fog attach="fog" args={['#e8ddd0', 120, 320]} />

        <OrthographicCamera
          makeDefault
          zoom={4.5}
          position={[cx + 70, 70, cz + 70]}
          near={0.1}
          far={500}
        />
        <MapControls
          enableRotate={false}
          target={[cx, 4, cz]}
          minZoom={2}
          maxZoom={30}
          panSpeed={1.5}
        />

        {/* Monument Valley-style warm directional lighting */}
        <ambientLight intensity={0.55} color="#fff0e0" />
        <directionalLight
          position={[cx + 80, 100, cz - 50]}
          intensity={0.75}
          color="#fff5e8"
        />
        {/* Cool fill from opposite side */}
        <directionalLight
          position={[cx - 50, 30, cz + 50]}
          intensity={0.2}
          color="#b8c8e0"
        />
        <hemisphereLight args={['#dde8f0', '#5a6840', 0.3]} />

        <Suspense fallback={null}>
          <TerrainMesh mapData={mapData} />
          <WaterPlane width={mapData.width} height={mapData.height} />
          <BiomeDecorations mapData={mapData} />
          {biomeCells && (
            <PokemonSprites
              mapData={mapData}
              biomeCells={biomeCells}
              animFrame={animFrame}
              onSpeciesClick={onSpeciesClick}
            />
          )}
        </Suspense>
      </Canvas>

      {/* Elegant legend */}
      <div style={{
        position: 'absolute', bottom: 58, left: 12,
        background: 'rgba(255,252,248,0.9)', padding: '10px 14px',
        borderRadius: 10, fontSize: 11, lineHeight: '20px', color: '#5a5040',
        border: '1px solid rgba(180,170,155,0.4)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}>
        {[
          ['Producer', '#78C850'],
          ['Primary Consumer', '#6890F0'],
          ['Secondary Consumer', '#F08030'],
          ['Apex Predator', '#F85888'],
          ['Decomposer', '#A040A0'],
        ].map(([label, color]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: color,
              display: 'inline-block', boxShadow: `0 0 4px ${color}40`,
            }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
