import { useState, useEffect, Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrthographicCamera, MapControls } from '@react-three/drei';
import * as THREE from 'three';
import TerrainMesh, { WATER_LEVEL, HEIGHT_SCALE } from './TerrainMesh';
import BiomeDecorations from './BiomeDecorations';
import PokemonSprites3D from './PokemonSprites3D';
import { getMap, getStatus } from '../data';

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
      <meshPhongMaterial color="#5b9bd5" transparent opacity={0.55} shininess={80}
        specular={new THREE.Color(0.3, 0.4, 0.5)} />
    </mesh>
  );
}

export default function IsometricScene({ onSpeciesClick, onTickLoaded, animFrame }) {
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

  if (!mapData || !mapData.elevation) {
    return (
      <div style={{
        color: '#8a8a8a', padding: 40, flex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f0eef5', fontSize: 16,
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
          <TerrainMesh mapData={mapData} />
          <WaterPlane width={mapData.width} height={mapData.height} />
          <BiomeDecorations mapData={mapData} />
          {biomeCells && (
            <PokemonSprites3D mapData={mapData} biomeCells={biomeCells} />
          )}
        </Suspense>
      </Canvas>
    </div>
  );
}
