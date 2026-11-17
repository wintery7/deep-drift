import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  FrontSide,
  IcosahedronGeometry,
  InstancedMesh,
  Object3D,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { terrainHeight } from "../../../shared/world.ts";
import { mulberry32 } from "../game/runtime.ts";
import { CAVE, CAVE_OPENINGS, caveBase, openingDepth, shellRadius } from "./cave.ts";
import { createGlowMaterial } from "./Life.tsx";

// ---------------------------------------------------------------------
// 바위 돔 — 바깥면과 안쪽면 두 겹이 구멍 가장자리에서 만난다
// ---------------------------------------------------------------------

function buildShell(outer: boolean): BufferGeometry {
  const base = new IcosahedronGeometry(1, 16);
  const ico = base.index ? base.toNonIndexed() : base;
  const src = ico.attributes.position;
  const pos: number[] = [];
  const col: number[] = [];
  const d = [new Vector3(), new Vector3(), new Vector3()];
  const dark = new Color(outer ? "#0b1a40" : "#14184c");
  const lit = new Color(outer ? "#1f3d70" : "#2f2c80");
  const c = new Color();

  for (let i = 0; i < src.count; i += 3) {
    let allOpen = true;
    let cy = 0;
    for (let k = 0; k < 3; k++) {
      d[k].fromBufferAttribute(src, i + k).normalize();
      cy += d[k].y;
      if (openingDepth(d[k].x, d[k].y, d[k].z) >= 0) allOpen = false;
    }
    // 땅속에 묻히는 아랫부분과 구멍 자리는 만들지 않는다
    if (cy / 3 < -0.5 || allOpen) continue;
    for (let k = 0; k < 3; k++) {
      const v = d[k];
      const r = shellRadius(v.x, v.y, v.z, outer);
      pos.push(CAVE.x + v.x * r, CAVE.y + v.y * r * CAVE.squash, CAVE.z + v.z * r);
      const n = 0.5 + 0.5 * Math.sin(v.x * 17 + v.y * 13 + v.z * 19);
      c.copy(dark).lerp(lit, n * 0.7 + 0.3 * Math.max(0, v.y));
      col.push(c.r, c.g, c.b);
    }
  }
  base.dispose();

  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function Rock() {
  const { outer, inner } = useMemo(() => ({ outer: buildShell(true), inner: buildShell(false) }), []);
  return (
    <>
      <mesh geometry={outer}>
        <meshStandardMaterial vertexColors flatShading roughness={1} side={FrontSide} />
      </mesh>
      <mesh geometry={inner}>
        <meshStandardMaterial vertexColors flatShading roughness={1} side={BackSide} emissive="#1c1560" emissiveIntensity={0.35} />
      </mesh>
    </>
  );
}

// ---------------------------------------------------------------------
// 발광 수정 (벽·천장·바닥) 과 입구까지 이어지는 등불 산호
// ---------------------------------------------------------------------

const CRYSTAL_COLORS = ["#7fe9ff", "#7fe9ff", "#b08cff", "#b08cff", "#ff9fd8", "#9fb4ff"];
const UP = new Vector3(0, 1, 0);

function Glows() {
  const { meshes, materials } = useMemo(() => {
    const rng = mulberry32(8080);
    const dummy = new Object3D();
    const color = new Color();
    const dir = new Vector3();
    const inward = new Vector3();

    const crystalGeo = new ConeGeometry(0.28, 1, 5);
    crystalGeo.translate(0, 0.5, 0);
    const crystalMat = createGlowMaterial({ base: 0.22, tip: 1.5, sway: 0 });

    type Item = { p: Vector3; up: Vector3; len: number; wide: number; c: string };
    const crystals: Item[] = [];

    // 벽과 천장에서 안쪽으로 자라는 수정 무리
    let guard = 0;
    while (crystals.length < 110 && guard++ < 600) {
      dir.set(rng() * 2 - 1, 0.05 + rng() * 0.95, rng() * 2 - 1).normalize();
      if (openingDepth(dir.x, dir.y, dir.z) < 0.16) continue;
      const c = CRYSTAL_COLORS[Math.floor(rng() * CRYSTAL_COLORS.length)];
      const n = 2 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const v = dir
          .clone()
          .add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.09))
          .normalize();
        if (openingDepth(v.x, v.y, v.z) < 0.12) continue;
        const r = caveBase(v.x, v.y, v.z) - 0.45;
        inward
          .set(-v.x, -v.y / CAVE.squash, -v.z)
          .add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.7))
          .normalize();
        crystals.push({
          p: new Vector3(CAVE.x + v.x * r, CAVE.y + v.y * r * CAVE.squash, CAVE.z + v.z * r),
          up: inward.clone(),
          len: 0.7 + rng() * 2.4,
          wide: 0.6 + rng() * 0.9,
          c,
        });
      }
    }
    // 바닥에서 솟은 수정 무리
    for (let k = 0; k < 9; k++) {
      const a = rng() * Math.PI * 2;
      const rad = 4 + rng() * 6.5;
      const cx = CAVE.x + Math.cos(a) * rad;
      const cz = CAVE.z + Math.sin(a) * rad;
      const c = CRYSTAL_COLORS[Math.floor(rng() * CRYSTAL_COLORS.length)];
      const n = 3 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const x = cx + (rng() - 0.5) * 1.4;
        const z = cz + (rng() - 0.5) * 1.4;
        crystals.push({
          p: new Vector3(x, terrainHeight(x, z) - 0.15, z),
          up: new Vector3((rng() - 0.5) * 0.7, 1, (rng() - 0.5) * 0.7).normalize(),
          len: 0.8 + rng() * 2.6,
          wide: 0.7 + rng() * 1.0,
          c,
        });
      }
    }

    const crystalMesh = new InstancedMesh(crystalGeo, crystalMat, crystals.length);
    crystals.forEach((it, i) => {
      dummy.position.copy(it.p);
      dummy.quaternion.setFromUnitVectors(UP, it.up);
      dummy.scale.set(it.wide, it.len, it.wide);
      dummy.updateMatrix();
      crystalMesh.setMatrixAt(i, dummy.matrix);
      crystalMesh.setColorAt(i, color.set(it.c));
    });
    crystalMesh.frustumCulled = false;

    // 바다 한가운데에서 입구까지, 해저에 띄엄띄엄 놓인 등불
    const lanternGeo = new SphereGeometry(0.5, 12, 8);
    lanternGeo.translate(0, 0.5, 0);
    const lanternMat = createGlowMaterial({ base: 0.55, tip: 1.1, sway: 0 });
    const ax = CAVE_OPENINGS[0].axis;
    const hl = Math.hypot(ax[0], ax[2]);
    const ex = CAVE.x + (ax[0] / hl) * (CAVE.radius + 1);
    const ez = CAVE.z + (ax[2] / hl) * (CAVE.radius + 1);
    const sx = 5;
    const sz = 4;
    const len = Math.hypot(ex - sx, ez - sz);
    const px = -(ez - sz) / len;
    const pz = (ex - sx) / len;
    const lanterns: { x: number; z: number; s: number }[] = [];
    const STEPS = 13;
    for (let i = 0; i < STEPS; i++) {
      const t = i / (STEPS - 1);
      const wobble = Math.sin(t * Math.PI * 2) * 3;
      const x = sx + (ex - sx) * t + px * wobble;
      const z = sz + (ez - sz) * t + pz * wobble;
      lanterns.push({ x, z, s: 0.75 });
      // 곁에 작은 것 하나씩
      lanterns.push({ x: x + (rng() - 0.5) * 1.6, z: z + (rng() - 0.5) * 1.6, s: 0.35 });
    }
    const lanternMesh = new InstancedMesh(lanternGeo, lanternMat, lanterns.length);
    lanterns.forEach((it, i) => {
      dummy.position.set(it.x, terrainHeight(it.x, it.z) - 0.1, it.z);
      dummy.quaternion.identity();
      dummy.scale.set(it.s, it.s * 0.85, it.s);
      dummy.updateMatrix();
      lanternMesh.setMatrixAt(i, dummy.matrix);
      lanternMesh.setColorAt(i, color.set("#a8ecff").multiplyScalar(0.85));
    });
    lanternMesh.frustumCulled = false;

    for (const m of [crystalMesh, lanternMesh]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    return { meshes: [crystalMesh, lanternMesh], materials: [crystalMat, lanternMat] };
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
// 동굴 안을 떠다니는 반딧불 같은 빛
// ---------------------------------------------------------------------

function Fireflies() {
  const { geometry, material } = useMemo(() => {
    const COUNT = 150;
    const rng = mulberry32(31337);
    const positions: number[] = [];
    const seeds: number[] = [];
    while (seeds.length < COUNT) {
      const x = rng() * 2 - 1;
      const y = rng();
      const z = rng() * 2 - 1;
      const l = Math.hypot(x, y, z);
      if (l > 1 || l < 0.05) continue;
      const r = CAVE.radius - 3;
      const wx = CAVE.x + x * r;
      const wz = CAVE.z + z * r;
      const wy = Math.max(CAVE.y + y * r * CAVE.squash, terrainHeight(wx, wz) + 0.8);
      positions.push(wx, wy, wz);
      seeds.push(rng());
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new Float32BufferAttribute(seeds, 1));

    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uColor: { value: new Color("#c4ecff") },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uPixelRatio;
        attribute float aSeed;
        varying float vA;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.3 + aSeed * 6.0) * 0.8;
          p.y += sin(uTime * 0.22 + aSeed * 11.0) * 0.9;
          p.z += cos(uTime * 0.27 + aSeed * 4.0) * 0.8;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          float twinkle = 0.45 + 0.55 * sin(uTime * 1.3 + aSeed * 20.0);
          vA = twinkle * smoothstep(0.3, 2.0, dist) * exp(-dist * dist * 0.0003);
          gl_PointSize = clamp(70.0 * uPixelRatio / max(dist, 0.1), 1.0, 18.0 * uPixelRatio);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          a = a * a * vA * 0.8;
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

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />;
}

/** 해저 동굴 — 조용히 머물 수 있는 곳 */
export function Cave() {
  const sky = CAVE_OPENINGS[2].axis;
  return (
    <>
      <Rock />
      <Glows />
      <Fireflies />
      {/* 동굴 안을 물들이는 빛: 가운데의 보랏빛, 빛 구멍 아래의 푸른빛 */}
      <pointLight position={[CAVE.x - 2, CAVE.y + 4.5, CAVE.z + 1]} color="#8f78ff" intensity={230} distance={30} decay={2} />
      <pointLight
        position={[CAVE.x + sky[0] * 5, CAVE.y + 2.2, CAVE.z + sky[2] * 5]}
        color="#6fdcff"
        intensity={90}
        distance={16}
        decay={2}
      />
    </>
  );
}
