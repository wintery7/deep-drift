import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  type Mesh,
} from "three";
import { WORLD, terrainHeight } from "../../../shared/world.ts";
import { FOG_COLOR, FOG_DENSITY, mulberry32 } from "../game/runtime.ts";
import { CAVE, CAVE_OPENINGS } from "./cave.ts";

// ---------------------------------------------------------------------
// 수면 쪽으로 밝아지는 하늘(물) 돔
// ---------------------------------------------------------------------
function WaterDome() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uDeep: { value: new Color(FOG_COLOR) },
          uMid: { value: new Color("#0a3c74") },
          uTop: { value: new Color("#3aa6d8") },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 mv = viewMatrix * vec4(position + cameraPosition, 1.0);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uDeep;
          uniform vec3 uMid;
          uniform vec3 uTop;
          varying vec3 vDir;
          void main() {
            float h = normalize(vDir).y;
            vec3 col = mix(uDeep, uMid, smoothstep(-0.05, 0.75, h));
            // 머리 위에서 내려오는 빛
            col = mix(col, uTop, pow(smoothstep(0.55, 1.0, h), 2.0) * 0.55);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    [],
  );
  return (
    <mesh material={material} frustumCulled={false} renderOrder={-10}>
      <sphereGeometry args={[400, 32, 16]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------
// 해저 지형
// ---------------------------------------------------------------------
function Terrain() {
  const geometry = useMemo(() => {
    const size = 250;
    const seg = 170;
    const g = new PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const low = new Color("#081a40");
    const high = new Color("#1a4478");
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      const k = Math.min(1, Math.max(0, (h + 25) / 16));
      const grain = 0.92 + 0.16 * Math.sin(x * 1.7) * Math.cos(z * 1.3);
      c.copy(low).lerp(high, k).multiplyScalar(grain);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, []);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
    </mesh>
  );
}

// ---------------------------------------------------------------------
// 위에서 내려오는 빛줄기
// ---------------------------------------------------------------------
function LightShafts() {
  const { mesh, material } = useMemo(() => {
    const geometry = new CylinderGeometry(1.2, 6, 70, 20, 1, true);
    geometry.translate(0, -35, 0); // 꼭대기가 원점
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Color("#63c8ff") },
        uFogDensity: { value: FOG_DENSITY },
      },
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        varying float vH;
        varying float vDepth;
        varying float vSeed;
        void main() {
          mat4 m = modelMatrix * instanceMatrix;
          vec4 mv = viewMatrix * m * vec4(position, 1.0);
          vN = normalize(mat3(viewMatrix * m) * normal);
          vV = normalize(-mv.xyz);
          vH = uv.y;
          vDepth = -mv.z;
          vSeed = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uFogDensity;
        varying vec3 vN;
        varying vec3 vV;
        varying float vH;
        varying float vDepth;
        varying float vSeed;
        void main() {
          // 원뿔의 가운데는 밝고 윤곽은 사라지게
          float facing = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.2);
          float fall = smoothstep(0.0, 0.85, vH) * smoothstep(1.0, 0.9, vH);
          float flicker = 0.7 + 0.3 * sin(uTime * 0.35 + vSeed * 6.0);
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth * 0.5);
          float a = facing * fall * flicker * (1.0 - fog) * 0.14;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
    });

    const COUNT = 16;
    const mesh = new InstancedMesh(geometry, material, COUNT + 1);
    mesh.frustumCulled = false;
    const rng = mulberry32(42);
    const dummy = new Object3D();
    for (let i = 0; i < COUNT; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * 75;
      dummy.position.set(Math.cos(a) * r, WORLD.ceiling + 26, Math.sin(a) * r);
      dummy.rotation.set((rng() - 0.5) * 0.25, rng() * Math.PI, 0.12 + (rng() - 0.5) * 0.2);
      const s = 0.7 + rng() * 0.9;
      dummy.scale.set(s, 1, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    // 동굴 천장의 빛 구멍으로 떨어지는 한 줄기
    const sky = CAVE_OPENINGS[2].axis;
    dummy.position.set(CAVE.x + sky[0] * CAVE.radius, CAVE.y + 17, CAVE.z + sky[2] * CAVE.radius);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(0.6, 0.27, 0.6);
    dummy.updateMatrix();
    mesh.setMatrixAt(COUNT, dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
    return { mesh, material };
  }, []);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
  });

  return <primitive object={mesh} />;
}

// ---------------------------------------------------------------------
// 떠다니는 입자 — 카메라 주변 상자 안에서 끝없이 순환한다
// ---------------------------------------------------------------------
function Particles() {
  const ref = useRef<Mesh>(null);
  const { geometry, material } = useMemo(() => {
    const COUNT = 2600;
    const rng = mulberry32(99);
    const positions = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = rng();
      positions[i * 3 + 1] = rng();
      positions[i * 3 + 2] = rng();
      seeds[i * 2] = rng() * 6.283;
      seeds[i * 2 + 1] = 0.4 + rng() * 1.2;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new Float32BufferAttribute(seeds, 2));

    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uColor: { value: new Color("#9fdcff") },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uPixelRatio;
        attribute vec2 aSeed;
        varying float vAlpha;
        const vec3 BOX = vec3(64.0, 44.0, 64.0);
        void main() {
          vec3 p = position * BOX;
          // 아주 느리게 떠오르며 흔들린다
          p.x += sin(uTime * 0.11 + aSeed.x) * 1.4;
          p.y += uTime * 0.12 * aSeed.y;
          p.z += cos(uTime * 0.09 + aSeed.x * 1.7) * 1.4;
          p = mod(p - cameraPosition, BOX) - BOX * 0.5 + cameraPosition;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          float twinkle = 0.55 + 0.45 * sin(uTime * 0.9 + aSeed.x * 3.0);
          vAlpha = smoothstep(30.0, 14.0, length(p - cameraPosition)) * smoothstep(0.3, 2.5, dist) * twinkle;
          gl_PointSize = clamp(aSeed.y * 46.0 * uPixelRatio / max(dist, 0.1), 1.0, 14.0 * uPixelRatio);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * vAlpha * 0.5;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
    });
    return { geometry, material };
  }, []);

  useFrame(({ clock, gl }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uPixelRatio.value = gl.getPixelRatio();
  });

  return <points ref={ref as never} geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />;
}

export function Environment() {
  return (
    <>
      <color attach="background" args={[FOG_COLOR]} />
      <fogExp2 attach="fog" args={[FOG_COLOR, FOG_DENSITY]} />
      <hemisphereLight args={["#4aa8ff", "#0a0f3a", 0.9]} />
      <directionalLight position={[20, 80, 10]} color="#8fd8ff" intensity={0.9} />
      <WaterDome />
      <Terrain />
      <LightShafts />
      <Particles />
    </>
  );
}
