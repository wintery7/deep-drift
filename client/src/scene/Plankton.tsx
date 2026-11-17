import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, ShaderMaterial, type BufferAttribute } from "three";
import { WORLD, terrainHeight } from "../../../shared/world.ts";
import { audio } from "../audio/AudioEngine.ts";
import { toast } from "../game/actions.ts";
import { addGrowth } from "../game/growth.ts";
import { mulberry32, runtime } from "../game/runtime.ts";
import { getState } from "../game/store.ts";
import { CAVE, caveSolid } from "./cave.ts";

/**
 * 빛 플랑크톤 — 지나가며 머금으면 촉수와 꼬리빛이 자란다.
 * 배치는 모두에게 같지만 머금은 상태는 각자의 바다에만 반영되어, 누군가와 나눠 가질 필요가 없다.
 */

const COUNT = 720;
const ABSORB_TIME = 0.5;
const BASE_GAIN = 0.006;
const HINT_KEY = "deep-drift:plankton-hint";

const IDLE = 0;
const ABSORBING = 1;
const GONE = 2;

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

export function Plankton() {
  const sim = useMemo(() => {
    const rng = mulberry32(4242);
    const base = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT);

    // 플랑크톤이 모여 있는 곳들 — 여기저기 둘러볼 이유가 된다. 동굴 안에도 한 무리.
    const clusters: [number, number, number][] = [[CAVE.x, CAVE.z, 7]];
    for (let i = 0; i < 13; i++) {
      const a = rng() * Math.PI * 2;
      const r = 12 + rng() * 58;
      clusters.push([Math.cos(a) * r, Math.sin(a) * r, 7 + rng() * 5]);
    }

    for (let i = 0; i < COUNT; i++) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (let tries = 0; tries < 10; tries++) {
        if (rng() < 0.6) {
          const c = clusters[Math.floor(rng() * clusters.length)];
          const a = rng() * Math.PI * 2;
          const r = Math.sqrt(rng()) * c[2];
          x = c[0] + Math.cos(a) * r;
          z = c[1] + Math.sin(a) * r;
        } else {
          const a = rng() * Math.PI * 2;
          const r = Math.sqrt(rng()) * (WORLD.radius - 6);
          x = Math.cos(a) * r;
          z = Math.sin(a) * r;
        }
        y = terrainHeight(x, z) + 1.5 + rng() * 14;
        if (!caveSolid(x, y, z, 1.2)) break;
      }
      base[i * 3] = x;
      base[i * 3 + 1] = y;
      base[i * 3 + 2] = z;
      seed[i] = rng();
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(base.slice(), 3));
    geometry.setAttribute("aAlpha", new Float32BufferAttribute(new Float32Array(COUNT).fill(1), 1));
    geometry.setAttribute("aSeed", new Float32BufferAttribute(seed, 1));

    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uColor: { value: new Color("#b4fff2") },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uPixelRatio;
        attribute float aAlpha;
        attribute float aSeed;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float dist = max(-mv.z, 0.1);
          float twinkle = 0.7 + 0.3 * sin(uTime * 1.6 + aSeed * 40.0);
          vA = aAlpha * twinkle * (1.0 - smoothstep(45.0, 70.0, dist));
          gl_PointSize = clamp(95.0 * uPixelRatio / dist, 1.5, 22.0 * uPixelRatio) * (0.75 + 0.25 * twinkle);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float halo = smoothstep(0.5, 0.0, d);
          float core = smoothstep(0.13, 0.0, d);
          float a = (halo * halo * 0.55 + core * 0.8) * vA;
          gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.6) * a, a);
        }
      `,
    });

    return {
      base,
      seed,
      state: new Uint8Array(COUNT),
      timer: new Float32Array(COUNT),
      from: new Float32Array(COUNT * 3),
      geometry,
      material,
      hinted: hintSeen(),
    };
  }, []);

  useEffect(
    () => () => {
      sim.geometry.dispose();
      sim.material.dispose();
    },
    [sim],
  );

  useFrame(({ clock, gl }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = clock.elapsedTime;
    const { base, seed, state, timer, from } = sim;
    const posAttr = sim.geometry.attributes.position as BufferAttribute;
    const alphaAttr = sim.geometry.attributes.aAlpha as BufferAttribute;
    const pos = posAttr.array as Float32Array;
    const alpha = alphaAttr.array as Float32Array;

    const canAbsorb = getState().phase === "playing";
    const p = runtime.pos;
    // 촉수가 길어질수록 조금 더 멀리 있는 플랑크톤까지 머금는다
    const reach = 1.8 + runtime.growth * 1.5;
    const reach2 = reach * reach;

    for (let i = 0; i < COUNT; i++) {
      const i3 = i * 3;
      const s = seed[i];

      if (state[i] === ABSORBING) {
        timer[i] += dt;
        const k = Math.min(1, timer[i] / ABSORB_TIME);
        const e = k * k;
        pos[i3] = from[i3] + (p.x - from[i3]) * e;
        pos[i3 + 1] = from[i3 + 1] + (p.y + 0.3 - from[i3 + 1]) * e;
        pos[i3 + 2] = from[i3 + 2] + (p.z - from[i3 + 2]) * e;
        alpha[i] = 1 - k * 0.6;
        if (k >= 1) {
          state[i] = GONE;
          timer[i] = 45 + s * 45; // 잠시 뒤 다시 피어난다
          alpha[i] = 0;
          // 누군가와 함께, 혹은 뒤따라 유영하면 더 많이 자란다
          addGrowth(BASE_GAIN * (1 + runtime.bond + (runtime.following ? 0.5 : 0)));
          audio.sparkle(0.6 + 0.4 * Math.min(1, runtime.bond + 0.3));
          if (!sim.hinted) {
            sim.hinted = true;
            markHintSeen();
            toast("빛 플랑크톤을 머금으면 촉수와 꼬리빛이 자라요. 누군가와 함께 다니면 더 빨리 자라요.", 9000);
          }
        }
        continue;
      }

      // 제자리 근처를 천천히 떠다닌다
      const x = base[i3] + Math.sin(t * 0.21 + s * 6.283) * 0.9;
      const y = base[i3 + 1] + Math.sin(t * 0.37 + s * 12.0) * 0.6;
      const z = base[i3 + 2] + Math.cos(t * 0.18 + s * 9.0) * 0.9;
      pos[i3] = x;
      pos[i3 + 1] = y;
      pos[i3 + 2] = z;

      if (state[i] === GONE) {
        timer[i] -= dt;
        if (timer[i] <= 0) state[i] = IDLE;
        continue;
      }

      alpha[i] = Math.min(1, alpha[i] + dt * 0.5); // 다시 피어날 때는 서서히
      if (canAbsorb && alpha[i] > 0.6) {
        const dx = x - p.x;
        const dy = y - p.y;
        const dz = z - p.z;
        if (dx * dx + dy * dy + dz * dz < reach2) {
          state[i] = ABSORBING;
          timer[i] = 0;
          from[i3] = x;
          from[i3 + 1] = y;
          from[i3 + 2] = z;
        }
      }
    }
    posAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    sim.material.uniforms.uTime.value = t;
    sim.material.uniforms.uPixelRatio.value = gl.getPixelRatio();
  });

  return <points geometry={sim.geometry} material={sim.material} frustumCulled={false} renderOrder={5} />;
}
