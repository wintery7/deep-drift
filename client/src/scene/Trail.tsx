import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, ShaderMaterial, type BufferAttribute, type Group } from "three";
import { WORLD } from "../../../shared/world.ts";
import { VARIANTS } from "../game/runtime.ts";
import type { JellyMotion } from "./jelly.ts";
import { IT_GLOW } from "./Jellyfish.tsx";

/** 꼬리빛을 이루는 점의 최대 개수와 기록 간격(초). 다 자라면 최고 속도에서 약 27 units 길이가 된다. */
const MAX = 64;
const SAMPLE = 0.07;
const MIN_LEN = 6;

/**
 * 해파리가 지나간 자리에 남는 빛의 꼬리. 자랄수록 길어진다.
 * 누군가의 뒤를 따라가면 앞 해파리의 꼬리빛 위를 지나게 되어 자연스럽게 행렬처럼 보인다.
 */
export function Trail({ target, motion, variant }: { target: RefObject<Group | null>; motion: JellyMotion; variant: number }) {
  const { geometry, material } = useMemo(() => {
    const geometry = new BufferGeometry();
    const index = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) index[i] = i;
    geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(MAX * 3), 3));
    geometry.setAttribute("aI", new Float32BufferAttribute(index, 1));

    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uLen: { value: MIN_LEN },
        uOpacity: { value: 1 },
        uGrow: { value: 0 },
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uColor: { value: new Color("#dccdff") },
      },
      vertexShader: /* glsl */ `
        uniform float uLen;
        uniform float uGrow;
        uniform float uTime;
        uniform float uPixelRatio;
        attribute float aI;
        varying float vA;
        void main() {
          vec3 p = position;
          // 오래된 빛일수록 천천히 떠오르며 흩어진다 (멈춰 있으면 가느다란 빛줄기가 된다)
          p.y += aI * 0.01;
          p.x += sin(uTime * 0.7 + aI * 0.35) * aI * 0.006;
          p.z += cos(uTime * 0.6 + aI * 0.3) * aI * 0.006;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = max(-mv.z, 0.1);
          float k = aI / max(uLen, 1.0);
          float live = step(aI, uLen);
          vA = live * smoothstep(0.0, 2.0, aI) * pow(clamp(1.0 - k, 0.0, 1.0), 1.4)
             * (0.6 + 0.4 * sin(uTime * 2.0 - aI * 0.5));
          gl_PointSize = live * clamp((34.0 + 26.0 * uGrow) * (1.0 - k * 0.55) * uPixelRatio / dist, 1.0, 16.0 * uPixelRatio);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          a = a * a * vA * uOpacity;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
    });
    return { geometry, material };
  }, []);

  const acc = useRef(0);
  const primed = useRef(false);

  useEffect(() => {
    material.uniforms.uColor.value.set(VARIANTS[variant % VARIANTS.length].glow);
  }, [material, variant]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(({ clock, gl }, rawDt) => {
    const g = target.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.05);
    const attr = geometry.attributes.position as BufferAttribute;
    const arr = attr.array as Float32Array;
    const x = g.position.x;
    const y = g.position.y - 0.35;
    const z = g.position.z;

    // 처음이거나 순간 이동(스폰·재접속)했으면 꼬리를 새로 시작한다.
    // 프레임이 늦게 와도 헤엄쳐서 갈 수 있는 거리는 순간 이동으로 보지 않는다.
    const teleport = 8 + WORLD.maxSpeed * 1.5 * rawDt;
    if (!primed.current || Math.hypot(arr[0] - x, arr[1] - y, arr[2] - z) > teleport) {
      primed.current = true;
      for (let i = 0; i < MAX; i++) {
        arr[i * 3] = x;
        arr[i * 3 + 1] = y;
        arr[i * 3 + 2] = z;
      }
    }
    acc.current += dt;
    if (acc.current >= SAMPLE) {
      acc.current %= SAMPLE;
      arr.copyWithin(3, 0, (MAX - 1) * 3);
    }
    arr[0] = x;
    arr[1] = y;
    arr[2] = z;
    attr.needsUpdate = true;

    const u = material.uniforms;
    u.uLen.value = MIN_LEN + motion.grow * (MAX - MIN_LEN);
    u.uGrow.value = motion.grow;
    if (motion.it > 0.001) u.uColor.value.set(VARIANTS[variant % VARIANTS.length].glow).lerp(IT_GLOW, motion.it);
    else u.uColor.value.set(VARIANTS[variant % VARIANTS.length].glow);
    u.uOpacity.value = motion.opacity * (0.55 + 0.35 * motion.grow + 0.3 * motion.boost);
    u.uTime.value = clock.elapsedTime;
    u.uPixelRatio.value = gl.getPixelRatio();
  });

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />;
}
