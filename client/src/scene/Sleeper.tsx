import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  Object3D,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type AmbientLight,
  type Group,
  type PointLight,
} from "three";
import { SLEEPER, WAKE_SELF, terrainHeight } from "../../../shared/world.ts";
import { audio } from "../audio/AudioEngine.ts";
import { FOG_DENSITY, mulberry32, runtime } from "../game/runtime.ts";
import { getState } from "../game/store.ts";
import { toast } from "../game/toast.ts";
import { ocean } from "../net/network.ts";
import { addGrowth } from "../game/growth.ts";
import { bellGeometry, createJellyMaterials, createTentacleGeometry } from "./jelly.ts";
import { createGlowMaterial } from "./Life.tsx";

/**
 * 잠든 빛 — 깊은 곳에 잠든 거대한 고대 해파리.
 * 혼자 인사하면 뒤척이기만 하고, 두 명 이상이 곁에서 함께 인사하면 깨어나 바다 전체가 한동안 환해진다.
 * 깨어나는 판정은 서버가 하므로 같은 바다의 모두가 같은 순간을 본다.
 */

const BASE_Y = terrainHeight(SLEEPER.x, SLEEPER.z) + 8;
const SCALE = 8;
const CENTER = new Vector3(SLEEPER.x, BASE_Y, SLEEPER.z);
const HINT_KEY = "deep-drift:sleeper-hint";
/** 크게 키워도 각지지 않게 둥글고, 촉수가 더 많고, 구완은 가는 거대 생물 전용 촉수 */
const giantTentacles = createTentacleGeometry(10, 28, 0.45);

const DORMANT = new Color("#2b5f8f");
const DORMANT_GLOW = new Color("#7fc8ff");
const AWAKE = new Color("#58e3ff");
const AWAKE_GLOW = new Color("#f0fcff");

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true;
  }
}

function markHintSeen() {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    /* noop */
  }
}

/** 깨어 있을 때 둘레에서 피어오르는 빛 */
function createMotes() {
  const COUNT = 260;
  const rng = mulberry32(777);
  const positions = new Float32Array(COUNT * 3);
  const seeds = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const a = rng() * Math.PI * 2;
    const r = 3 + Math.sqrt(rng()) * 15;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = rng();
    positions[i * 3 + 2] = Math.sin(a) * r;
    seeds[i] = rng();
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
      uAwake: { value: 0 },
      uPixelRatio: { value: 1 },
      uCenter: { value: new Vector3(SLEEPER.x, terrainHeight(SLEEPER.x, SLEEPER.z), SLEEPER.z) },
      uColor: { value: new Color("#bff4ff") },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uAwake;
      uniform float uPixelRatio;
      uniform vec3 uCenter;
      attribute float aSeed;
      varying float vA;
      const float RISE = 34.0;
      void main() {
        float h = mod(position.y * RISE + uTime * (1.2 + aSeed * 1.6), RISE);
        vec3 p = uCenter + vec3(
          position.x + sin(uTime * 0.4 + aSeed * 20.0) * 0.8,
          h,
          position.z + cos(uTime * 0.35 + aSeed * 13.0) * 0.8
        );
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float dist = max(-mv.z, 0.1);
        vA = uAwake * smoothstep(0.0, 3.0, h) * (1.0 - h / RISE) * (0.6 + 0.4 * sin(uTime * 2.0 + aSeed * 30.0));
        gl_PointSize = clamp(110.0 * uPixelRatio / dist, 1.5, 26.0 * uPixelRatio);
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
}

/** 바다 가운데에서 잠든 빛까지 해저에 띄엄띄엄 놓인 등불 */
function createLanterns() {
  const rng = mulberry32(4040);
  const geo = new SphereGeometry(0.5, 12, 8);
  geo.translate(0, 0.5, 0);
  const mat = createGlowMaterial({ base: 0.55, tip: 1.1, sway: 0 });
  const sx = 6;
  const sz = 7;
  const ex = SLEEPER.x - 12;
  const ez = SLEEPER.z - 10;
  const len = Math.hypot(ex - sx, ez - sz);
  const px = -(ez - sz) / len;
  const pz = (ex - sx) / len;
  const items: { x: number; z: number; s: number }[] = [];
  const STEPS = 11;
  for (let i = 0; i < STEPS; i++) {
    const k = i / (STEPS - 1);
    const wobble = Math.sin(k * Math.PI * 2 + 1) * 3;
    const x = sx + (ex - sx) * k + px * wobble;
    const z = sz + (ez - sz) * k + pz * wobble;
    items.push({ x, z, s: 0.75 });
    items.push({ x: x + (rng() - 0.5) * 1.6, z: z + (rng() - 0.5) * 1.6, s: 0.35 });
  }
  const mesh = new InstancedMesh(geo, mat, items.length);
  const dummy = new Object3D();
  const c = new Color();
  items.forEach((it, i) => {
    dummy.position.set(it.x, terrainHeight(it.x, it.z) - 0.1, it.z);
    dummy.scale.set(it.s, it.s * 0.85, it.s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, c.set("#9fe8ff").multiplyScalar(0.8));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return { mesh, mat };
}

export function Sleeper() {
  const group = useRef<Group>(null);
  const lamp = useRef<PointLight>(null);
  const wash = useRef<AmbientLight>(null);

  const mats = useMemo(() => {
    const m = createJellyMaterials();
    for (const x of [m.bell, m.tentacle]) {
      x.uniforms.uFogDensity.value = FOG_DENSITY * 0.6; // 멀리서도 희미하게 보이도록
    }
    return m;
  }, []);
  const motes = useMemo(createMotes, []);
  const lanterns = useMemo(createLanterns, []);

  const st = useRef({
    awake: 0,
    stir: 0,
    pulse: 0,
    seenStirs: -1,
    seenWakes: -1,
    hinted: hintSeen(),
    stirHinted: false,
  });

  useEffect(
    () => () => {
      mats.bell.dispose();
      mats.tentacle.dispose();
      motes.geometry.dispose();
      motes.material.dispose();
    },
    [mats, motes],
  );

  useFrame(({ clock, gl }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = clock.elapsedTime;
    const s = st.current;
    const playing = getState().phase === "playing";
    const dist = Math.hypot(runtime.pos.x - SLEEPER.x, runtime.pos.z - SLEEPER.z);

    // ---------------- 바다에 일어난 일 ----------------
    if (!ocean.synced) {
      s.seenStirs = -1;
      s.seenWakes = -1;
    } else {
      if (s.seenStirs < 0) {
        // 들어왔을 때 이미 일어난 일은 연출하지 않는다
        s.seenStirs = ocean.sleeperStirs;
        s.seenWakes = ocean.sleeperWakes;
      }
      if (ocean.sleeperStirs !== s.seenStirs) {
        s.seenStirs = ocean.sleeperStirs;
        s.stir = 1;
        audio.stir(CENTER);
        if (dist < SLEEPER.reach + 4 && !s.stirHinted) {
          s.stirHinted = true;
          toast("잠든 빛이 뒤척였어요. 누군가와 함께 빛을 건네면 깨어날지도 몰라요.", 8000);
        }
      }
      if (ocean.sleeperWakes !== s.seenWakes) {
        s.seenWakes = ocean.sleeperWakes;
        audio.awaken();
        toast(
          ocean.sleeperWakeKind === WAKE_SELF
            ? "잠든 빛이 잠시 스스로 눈을 떴어요. 곁에 가면 꼬리빛이 자라요."
            : "함께 건넨 빛에 잠든 빛이 깨어났어요. 바다가 환해져요.",
          7000,
        );
      }
    }

    // 처음 가까이 왔을 때 한 번만 알려 준다
    if (playing && !s.hinted && dist < SLEEPER.reach + 8) {
      s.hinted = true;
      markHintSeen();
      toast("깊은 곳에 거대한 무언가가 잠들어 있어요. 곁에서 빛으로 인사해 보세요 (E)", 9000);
    }

    // ---------------- 모습 ----------------
    const want = ocean.synced && ocean.sleeperAwake ? 1 : 0;
    s.awake += (want - s.awake) * (1 - Math.exp(-(want ? 0.7 : 0.25) * dt));
    s.stir = Math.max(0, s.stir - dt * 0.35);
    const a = s.awake;
    const stir = s.stir * s.stir;
    s.pulse += dt * (0.22 + 0.75 * a + 0.9 * stir);

    const g = group.current;
    if (g) {
      g.position.set(SLEEPER.x, BASE_Y + a * 3.5 + Math.sin(t * 0.18) * 0.5 + stir * 0.6, SLEEPER.z);
      g.rotation.set(Math.sin(t * 0.11) * 0.05 + stir * 0.06 * Math.sin(t * 3), t * 0.01, Math.cos(t * 0.09) * 0.05);
    }

    for (const m of [mats.bell, mats.tentacle]) {
      const u = m.uniforms;
      u.uPulse.value = s.pulse;
      u.uSpeed.value = 0.15 + 0.35 * a;
      u.uTime.value = t * (0.35 + 0.65 * a);
      u.uOpacity.value = Math.min(1, 0.5 + 0.5 * a + 0.25 * stir);
      u.uBoost.value = a;
      u.uFlash.value = stir * 0.5 + a * 0.25 + Math.pow(Math.max(0, Math.sin(t * 0.45)), 6) * 0.18;
      u.uColor.value.copy(DORMANT).lerp(AWAKE, a);
      u.uGlow.value.copy(DORMANT_GLOW).lerp(AWAKE_GLOW, a);
    }
    if (lamp.current) {
      const breath = Math.pow(Math.max(0, Math.sin(t * 0.45)), 6); // 몇 초에 한 번 숨 쉬듯
      lamp.current.intensity = 60 + 260 * breath + 400 * stir + 2200 * a;
      lamp.current.distance = 34 + 56 * a;
    }
    if (wash.current) wash.current.intensity = 0.7 * a;
    if (playing && a > 0.5 && dist < 32) addGrowth(0.0025 * dt);

    const mu = motes.material.uniforms;
    mu.uTime.value = t;
    lanterns.mat.uniforms.uTime.value = t;
    mu.uAwake.value = a;
    mu.uPixelRatio.value = gl.getPixelRatio();
  });

  return (
    <>
      <group ref={group}>
        <mesh geometry={giantTentacles} material={mats.tentacle} scale={[SCALE, SCALE * 0.3, SCALE]} frustumCulled={false} renderOrder={2} />
        <mesh geometry={bellGeometry} material={mats.bell} scale={SCALE} renderOrder={3} />
        <pointLight ref={lamp} position={[0, 2, 0]} color="#6fdcff" intensity={60} distance={34} decay={1.6} />
      </group>
      <ambientLight ref={wash} color="#5fd4ff" intensity={0} />
      <primitive object={lanterns.mesh} />
      <points geometry={motes.geometry} material={motes.material} frustumCulled={false} renderOrder={5} />
    </>
  );
}
