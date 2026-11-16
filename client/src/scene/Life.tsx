import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  type Group,
  type Side,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { terrainHeight } from "../../../shared/world.ts";
import { audio } from "../audio/AudioEngine.ts";
import { FOG_COLOR, FOG_DENSITY, mulberry32, runtime, worldTime } from "../game/runtime.ts";
import { bellGeometry, createJellyMaterials, tentacleGeometry } from "./jelly.ts";

// ---------------------------------------------------------------------
// 발광 산호 정원
// ---------------------------------------------------------------------

/** 높이에 따라 빛이 짙어지는 발광 식물용 material (geometry는 y 0..1 기준) */
function createGlowMaterial(opts: { base: number; tip: number; sway: number; side?: Side }) {
  return new ShaderMaterial({
    side: opts.side ?? FrontSide,
    uniforms: {
      uTime: { value: 0 },
      uBase: { value: opts.base },
      uTip: { value: opts.tip },
      uSway: { value: opts.sway },
      uFogColor: { value: new Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSway;
      varying vec3 vColor;
      varying float vH;
      varying float vDepth;
      varying float vSeed;
      varying float vFacing;
      void main() {
        vH = clamp(position.y, 0.0, 1.0);
        mat4 m = modelMatrix * instanceMatrix;
        vec4 wp = m * vec4(position, 1.0);
        float seed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.71;
        wp.x += sin(uTime * 0.8 + seed + wp.y * 0.3) * uSway * vH * vH;
        wp.z += cos(uTime * 0.6 + seed * 1.3) * uSway * vH * vH * 0.6;
        vec4 mv = viewMatrix * wp;
        vec3 n = normalize(mat3(viewMatrix * m) * normal);
        vFacing = abs(dot(n, normalize(-mv.xyz)));
        vColor = instanceColor;
        vSeed = seed;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uBase;
      uniform float uTip;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying vec3 vColor;
      varying float vH;
      varying float vDepth;
      varying float vSeed;
      varying float vFacing;
      void main() {
        float pulse = 0.78 + 0.22 * sin(uTime * 0.7 + vSeed * 5.0);
        vec3 col = vColor * (uBase + uTip * pow(clamp(vH, 0.0, 1.0), 1.6)) * pulse;
        col *= 0.75 + 0.25 * vFacing;
        col += vColor * pow(clamp(1.0 - vFacing, 0.0, 1.0), 2.0) * 0.25 * vH;
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
        gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
      }
    `,
  });
}

const CORAL_PALETTE = ["#ff8fc7", "#ff8fc7", "#ffa6d6", "#b58cff", "#8f9bff", "#6fe3ff"];

function Corals() {
  const { meshes, materials } = useMemo(() => {
    const rng = mulberry32(2024);
    const dummy = new Object3D();
    const color = new Color();

    // 가지: 끝에 작은 구슬이 달린 줄기
    const stalkGeo = (() => {
      const cyl = new CylinderGeometry(0.06, 0.13, 1, 6, 4);
      cyl.translate(0, 0.5, 0);
      const tip = new SphereGeometry(0.1, 8, 6);
      tip.translate(0, 1, 0);
      const merged = mergeGeometries([cyl, tip])!;
      cyl.dispose();
      tip.dispose();
      return merged;
    })();
    const bulbGeo = new SphereGeometry(0.5, 12, 8);
    bulbGeo.translate(0, 0.5, 0);
    const kelpGeo = new PlaneGeometry(0.36, 1, 1, 8);
    kelpGeo.translate(0, 0.5, 0);
    {
      // 끝으로 갈수록 가늘어지는 잎 모양
      const p = kelpGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        p.setX(i, p.getX(i) * (1 - 0.85 * y * y) * (0.55 + 0.9 * Math.sin(Math.min(1, y * 2.2) * Math.PI * 0.5) * 0.5));
      }
    }

    const stalkMat = createGlowMaterial({ base: 0.12, tip: 1.35, sway: 0.06 });
    const bulbMat = createGlowMaterial({ base: 0.25, tip: 0.9, sway: 0 });
    const kelpMat = createGlowMaterial({ base: 0.1, tip: 0.55, sway: 0.55, side: DoubleSide });

    type Item = { x: number; z: number; sx: number; sy: number; sz: number; rx: number; ry: number; rz: number; c: string; dim: number };
    const stalks: Item[] = [];
    const bulbs: Item[] = [];
    const kelp: Item[] = [];

    const GARDENS = 11;
    for (let g = 0; g < GARDENS; g++) {
      const ga = rng() * Math.PI * 2;
      const gr = g === 0 ? 14 : 10 + rng() * 62;
      const gx = Math.cos(ga) * gr;
      const gz = Math.sin(ga) * gr;

      const clusters = 8 + Math.floor(rng() * 6);
      for (let c = 0; c < clusters; c++) {
        const ca = rng() * Math.PI * 2;
        const cr = Math.sqrt(rng()) * 11;
        const cx = gx + Math.cos(ca) * cr;
        const cz = gz + Math.sin(ca) * cr;
        const col = CORAL_PALETTE[Math.floor(rng() * CORAL_PALETTE.length)];
        const n = 5 + Math.floor(rng() * 7);
        const tall = 0.9 + rng() * 2.4;
        for (let i = 0; i < n; i++) {
          const a = rng() * Math.PI * 2;
          const d = rng() * 0.6;
          const w = 0.7 + rng() * 1.1;
          stalks.push({
            x: cx + Math.cos(a) * d,
            z: cz + Math.sin(a) * d,
            sx: w,
            sy: tall * (0.5 + rng() * 0.7),
            sz: w,
            rx: Math.sin(a) * (0.15 + rng() * 0.4),
            ry: rng() * Math.PI,
            rz: -Math.cos(a) * (0.15 + rng() * 0.4),
            c: col,
            dim: 0.8 + rng() * 0.4,
          });
        }
      }
      for (let i = 0; i < 26; i++) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * 13;
        const s = 0.25 + rng() * 0.8;
        bulbs.push({
          x: gx + Math.cos(a) * d,
          z: gz + Math.sin(a) * d,
          sx: s,
          sy: s * (0.55 + rng() * 0.3),
          sz: s,
          rx: 0,
          ry: 0,
          rz: 0,
          c: CORAL_PALETTE[Math.floor(rng() * CORAL_PALETTE.length)],
          dim: 0.55 + rng() * 0.4,
        });
      }
      for (let i = 0; i < 34; i++) {
        const a = rng() * Math.PI * 2;
        const d = 3 + Math.sqrt(rng()) * 14;
        kelp.push({
          x: gx + Math.cos(a) * d,
          z: gz + Math.sin(a) * d,
          sx: 1 + rng() * 1.2,
          sy: 2.5 + rng() * 5,
          sz: 1,
          rx: 0,
          ry: rng() * Math.PI,
          rz: 0,
          c: rng() < 0.75 ? "#2bbfae" : "#5a8cff",
          dim: 0.7 + rng() * 0.5,
        });
      }
    }
    // 정원 사이사이에 드문드문 흩어진 것들
    for (let i = 0; i < 170; i++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * 78;
      kelp.push({
        x: Math.cos(a) * d,
        z: Math.sin(a) * d,
        sx: 0.8 + rng(),
        sy: 1.5 + rng() * 4,
        sz: 1,
        rx: 0,
        ry: rng() * Math.PI,
        rz: 0,
        c: "#2bbfae",
        dim: 0.5 + rng() * 0.4,
      });
    }

    const build = (geo: BufferGeometry, mat: ShaderMaterial, items: Item[]) => {
      const mesh = new InstancedMesh(geo, mat, items.length);
      items.forEach((it, i) => {
        dummy.position.set(it.x, terrainHeight(it.x, it.z) - 0.12, it.z);
        dummy.rotation.set(it.rx, it.ry, it.rz);
        dummy.scale.set(it.sx, it.sy, it.sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, color.set(it.c).multiplyScalar(it.dim));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      return mesh;
    };

    return {
      meshes: [build(stalkGeo, stalkMat, stalks), build(bulbGeo, bulbMat, bulbs), build(kelpGeo, kelpMat, kelp)],
      materials: [stalkMat, bulbMat, kelpMat],
    };
  }, []);

  useFrame(({ clock }) => {
    for (const m of materials) m.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------
// 작은 물고기 떼
// ---------------------------------------------------------------------

const _p0 = new Vector3();
const _p1 = new Vector3();

function FishSchool({ seed, count, radius, height, color }: { seed: number; count: number; radius: number; height: number; color: string }) {
  const { mesh, fish } = useMemo(() => {
    const geo = new ConeGeometry(0.11, 0.55, 5);
    geo.rotateX(Math.PI / 2); // 머리가 +Z
    geo.scale(0.45, 1, 1);
    const mat = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5 });
    const mesh = new InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;
    const rng = mulberry32(seed);
    const fish = Array.from({ length: count }, () => {
      const a = rng() * Math.PI * 2;
      const b = Math.acos(rng() * 2 - 1);
      const r = 0.8 + Math.cbrt(rng()) * 3.6;
      return {
        ox: Math.sin(b) * Math.cos(a) * r * 1.6,
        oy: Math.cos(b) * r * 0.6,
        oz: Math.sin(b) * Math.sin(a) * r * 1.6,
        lag: rng() * 1.6,
        phase: rng() * 6.28,
        scale: 0.7 + rng() * 0.7,
      };
    });
    return { mesh, fish };
  }, [seed, count, color]);

  const dummy = useMemo(() => new Object3D(), []);
  const phase = seed * 1.37;

  /** 떼의 중심이 지나가는 길 */
  const path = (t: number, out: Vector3) => {
    const a = t * 0.045 + phase;
    out.set(
      Math.cos(a) * radius + Math.sin(t * 0.021 + phase) * 9,
      height + Math.sin(t * 0.07 + phase) * 4,
      Math.sin(a * 1.0) * radius * 0.8 + Math.cos(t * 0.017 + phase * 2.0) * 9,
    );
    out.y = Math.max(out.y, terrainHeight(out.x, out.z) + 4);
    return out;
  };

  useFrame(() => {
    const t = worldTime();
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      const ft = t - f.lag;
      const wob = Math.sin(ft * 1.3 + f.phase);
      path(ft, _p0);
      path(ft + 0.4, _p1);
      _p0.x += f.ox + wob * 0.25;
      _p0.y += f.oy + Math.cos(ft * 0.9 + f.phase) * 0.2;
      _p0.z += f.oz;
      _p1.x += f.ox;
      _p1.y += f.oy;
      _p1.z += f.oz;
      dummy.position.copy(_p0);
      dummy.lookAt(_p1);
      dummy.rotateY(Math.sin(ft * 9 + f.phase) * 0.18); // 꼬리치기
      dummy.scale.setScalar(f.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}

// ---------------------------------------------------------------------
// 멀리서 천천히 도는 고래
// ---------------------------------------------------------------------

function Whale() {
  const group = useRef<Group>(null);
  const tail = useRef<Group>(null);
  const bodyGeo = useMemo(() => {
    const profile: [number, number][] = [
      [0, -1],
      [0.05, -0.92],
      [0.09, -0.7],
      [0.17, -0.4],
      [0.26, -0.05],
      [0.3, 0.3],
      [0.29, 0.6],
      [0.22, 0.85],
      [0.1, 0.97],
      [0, 1],
    ];
    const g = new LatheGeometry(
      profile.map(([r, y]) => new Vector2(r, y)),
      20,
    );
    g.rotateX(Math.PI / 2); // 머리가 +Z
    g.scale(11, 11, 11);
    return g;
  }, []);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = worldTime();
    const a = t * 0.018;
    const R = 58;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const y = 15 + Math.sin(t * 0.05) * 4;
    g.position.set(x, y, z);
    // 원의 접선 방향을 바라본다
    g.rotation.set(Math.sin(t * 0.4) * 0.05 - Math.cos(t * 0.05) * 0.06, Math.atan2(-Math.sin(a), Math.cos(a)), 0, "YXZ");
    if (tail.current) tail.current.rotation.x = Math.sin(t * 0.8) * 0.28;
    runtime.whalePos.set(x, y, z);
    audio.setWhalePosition(runtime.whalePos);
  });

  return (
    <group ref={group}>
      <mesh geometry={bodyGeo}>
        <meshStandardMaterial color="#1a3a6e" roughness={0.85} />
      </mesh>
      {/* 가슴지느러미 */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 3.6, -1.6, 3.2]} rotation={[0.2, side * -0.5, side * -0.5]} scale={[2.6, 0.18, 1.1]}>
          <sphereGeometry args={[1, 12, 8]} />
          <meshStandardMaterial color="#17335f" roughness={0.85} />
        </mesh>
      ))}
      {/* 꼬리 */}
      <group ref={tail} position={[0, 0, -10.2]}>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 1.9, 0, -0.9]} rotation={[0, side * 0.5, 0]} scale={[2.3, 0.16, 1.1]}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshStandardMaterial color="#17335f" roughness={0.85} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------
// 빛나는 해파리 군락 (플레이어가 아닌 배경 생명체)
// ---------------------------------------------------------------------

const SWARM_COLORS = ["#8a66ff", "#a98bff", "#6f8cff", "#5fc6ff", "#c58bff"];

function AmbientJellies() {
  const { bell, tentacles, materials, items } = useMemo(() => {
    const rng = mulberry32(555);
    const centers = [
      [26, 6, -18],
      [-34, 2, 22],
      [8, 12, 44],
      [-20, -4, -46],
    ];
    const items: { x: number; y: number; z: number; s: number; ph: number; drift: number }[] = [];
    for (const [cx, cy, cz] of centers) {
      const n = 11;
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * 11;
        items.push({
          x: cx + Math.cos(a) * d,
          y: cy + (rng() - 0.5) * 12,
          z: cz + Math.sin(a) * d,
          s: 0.45 + rng() * 0.9,
          ph: rng() * 6.28,
          drift: 0.6 + rng() * 0.8,
        });
      }
    }
    const count = items.length;
    const seeds = new Float32Array(count);
    items.forEach((it, i) => (seeds[i] = it.ph));

    const materials = createJellyMaterials();
    for (const m of [materials.bell, materials.tentacle]) {
      m.uniforms.uSpeed.value = 0.25;
      m.uniforms.uOpacity.value = 0.85;
    }

    const withSeed = (src: BufferGeometry) => {
      const g = src.clone();
      g.setAttribute("aSeed", new InstancedBufferAttribute(seeds, 1));
      return g;
    };
    const bell = new InstancedMesh(withSeed(bellGeometry), materials.bell, count);
    const tentacles = new InstancedMesh(withSeed(tentacleGeometry), materials.tentacle, count);
    const c = new Color();
    for (let i = 0; i < count; i++) {
      c.set(SWARM_COLORS[Math.floor(rng() * SWARM_COLORS.length)]);
      bell.setColorAt(i, c);
      tentacles.setColorAt(i, c);
    }
    bell.instanceColor!.needsUpdate = true;
    tentacles.instanceColor!.needsUpdate = true;
    bell.frustumCulled = false;
    tentacles.frustumCulled = false;
    bell.renderOrder = 3;
    tentacles.renderOrder = 2;
    return { bell, tentacles, materials, items };
  }, []);

  const dummy = useMemo(() => new Object3D(), []);

  useFrame(({ clock }) => {
    const t = worldTime();
    for (const m of [materials.bell, materials.tentacle]) {
      m.uniforms.uTime.value = clock.elapsedTime;
      m.uniforms.uPulse.value = clock.elapsedTime * 1.5;
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const w = t * 0.12 * it.drift + it.ph;
      dummy.position.set(it.x + Math.sin(w) * 2.2, it.y + Math.sin(w * 1.7 + it.ph) * 1.8, it.z + Math.cos(w * 0.8) * 2.2);
      dummy.rotation.set(Math.sin(w * 1.3) * 0.18, it.ph, Math.cos(w * 1.1) * 0.18);
      dummy.scale.setScalar(it.s);
      dummy.updateMatrix();
      bell.setMatrixAt(i, dummy.matrix);
      tentacles.setMatrixAt(i, dummy.matrix);
    }
    bell.instanceMatrix.needsUpdate = true;
    tentacles.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <primitive object={tentacles} />
      <primitive object={bell} />
    </>
  );
}

export function Life() {
  return (
    <>
      <Corals />
      <AmbientJellies />
      <FishSchool seed={3} count={46} radius={30} height={-6} color="#9fe6ff" />
      <FishSchool seed={8} count={38} radius={48} height={2} color="#ffc2e4" />
      <FishSchool seed={13} count={30} radius={18} height={8} color="#c7b8ff" />
      <Whale />
    </>
  );
}
