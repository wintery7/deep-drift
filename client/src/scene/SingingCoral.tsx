import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import {
  Color,
  CylinderGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Object3D,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SONG_CHOIRS, SONG_PIPES, SONG_PIPES_PER_CHOIR, terrainHeight } from "../../../shared/world.ts";
import { audio } from "../audio/AudioEngine.ts";
import { FOG_COLOR, FOG_DENSITY, runtime } from "../game/runtime.ts";
import { getState } from "../game/store.ts";
import { toast } from "../game/toast.ts";
import { network, onRemoteNote } from "../net/network.ts";

/**
 * 노래하는 산호 — 스치면 음이 하나 울리는 빛나는 관.
 * 다섯 군데에 여섯 개씩 모여 있고, 어떤 순서로 울려도 어울리는 음계(D 단조 펜타토닉 계열)다.
 * 누군가 울리면 같은 바다의 다른 사람에게도 그 자리에서 들리므로, 여럿이 함께 울리면 화음이 된다.
 */

/** 무리의 자리 [x, z, 바라보는 방향] — 동굴·잠든 빛과 겹치지 않게 */
const CHOIRS: [number, number, number][] = [
  [12, 20, 0.6],
  [-26, 4, 2.4],
  [26, -26, -1.2],
  [-6, 42, 1.9],
  [-50, 30, -0.4],
];
/** 무리마다 음역을 조금씩 다르게 */
const OCTAVE = [1, 0.5, 2, 1, 0.5];
const SCALE = [587.33, 523.25, 440.0, 392.0, 349.23, 293.66]; // 짧은 관이 높은 음
const COLORS = ["#4fb8ff", "#9a78ff", "#ff74b8", "#3fd8b0", "#ffb860"];
const HINT_KEY = "deep-drift:coral-hint";

const ENTER = 1.2;
const LEAVE = 1.6;
const COOLDOWN = 0.35;

interface Pipe {
  x: number;
  z: number;
  base: number;
  top: number;
  freq: number;
  tip: Vector3;
}

function buildPipes(): Pipe[] {
  if (CHOIRS.length !== SONG_CHOIRS) throw new Error("choir count mismatch");
  const pipes: Pipe[] = [];
  CHOIRS.forEach(([cx, cz, facing], c) => {
    for (let k = 0; k < SONG_PIPES_PER_CHOIR; k++) {
      // 바라보는 방향을 중심으로 부채꼴로 늘어선다
      const ang = facing + (k - (SONG_PIPES_PER_CHOIR - 1) / 2) * 0.4;
      const x = cx + Math.cos(ang) * 5.6;
      const z = cz + Math.sin(ang) * 5.6;
      const base = terrainHeight(x, z) - 0.3;
      const height = 2.2 + k * 0.8;
      pipes.push({
        x,
        z,
        base,
        top: base + height,
        freq: SCALE[k] * OCTAVE[c],
        tip: new Vector3(x, base + height, z),
      });
    }
  });
  if (pipes.length !== SONG_PIPES) throw new Error("pipe count mismatch");
  return pipes;
}

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true;
  }
}

export function SingingCoral() {
  const sim = useMemo(() => {
    const pipes = buildPipes();

    // 관: 아래로 갈수록 굵어지는 원통 + 꼭대기의 둥근 입
    const tube = new CylinderGeometry(0.26, 0.34, 1, 12, 6, true);
    tube.translate(0, 0.5, 0);
    const lip = new SphereGeometry(0.3, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
    lip.scale(1, 0.35, 1);
    lip.translate(0, 1, 0);
    const geometry = mergeGeometries([tube.toNonIndexed(), lip.toNonIndexed()])!;
    tube.dispose();
    lip.dispose();

    const material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFogColor: { value: new Color(FOG_COLOR) },
        uFogDensity: { value: FOG_DENSITY },
      },
      vertexShader: /* glsl */ `
        attribute float aFlash;
        varying float vH;
        varying float vFlash;
        varying vec3 vColor;
        varying float vDepth;
        varying float vFacing;
        varying float vSeed;
        void main() {
          vH = clamp(position.y, 0.0, 1.0);
          vFlash = aFlash;
          vColor = instanceColor;
          vSeed = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.17;
          // 울리면 살짝 부풀었다가 돌아온다
          vec3 p = position;
          p.xz *= 1.0 + aFlash * 0.18 * vH;
          vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
          vec3 n = normalize(mat3(viewMatrix * modelMatrix * instanceMatrix) * normal);
          vFacing = abs(dot(n, normalize(-mv.xyz)));
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        varying float vH;
        varying float vFlash;
        varying vec3 vColor;
        varying float vDepth;
        varying float vFacing;
        varying float vSeed;
        void main() {
          // 관을 따라 천천히 오르는 빛의 띠
          float band = 0.5 + 0.5 * sin(vH * 10.0 - uTime * 1.4 + vSeed * 6.0);
          // pow()에 음수가 들어가면 NaN이 되고, 빛 번짐이 그 한 점을 화면 전체로 번지게 해 화면이 깜빡인다.
          // 오차로 범위를 아주 조금만 벗어나도 그렇게 되므로 모든 pow 입력을 0..1로 묶는다.
          float h = clamp(vH, 0.0, 1.0);
          float glow = 0.12 + 0.42 * pow(h, 2.2) + 0.1 * band * h;
          vec3 col = vColor * glow * (0.7 + 0.3 * vFacing);
          col += vColor * pow(clamp(1.0 - vFacing, 0.0, 1.0), 2.0) * 0.35 * h;
          // 울린 순간에는 관 전체가 밝아지고, 빛이 위로 솟는다
          float rise = smoothstep(vH - 0.25, vH, 1.0 - vFlash);
          col += mix(vColor, vec3(1.0), 0.15) * vFlash * (0.45 + 1.1 * vH) * (0.6 + 0.4 * rise);
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
          gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
        }
      `,
    });

    const mesh = new InstancedMesh(geometry, material, pipes.length);
    const flash = new Float32Array(pipes.length);
    geometry.setAttribute("aFlash", new InstancedBufferAttribute(flash, 1));
    const dummy = new Object3D();
    const color = new Color();
    pipes.forEach((p, i) => {
      dummy.position.set(p.x, p.base, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, p.top - p.base, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.set(COLORS[Math.floor(i / SONG_PIPES_PER_CHOIR)]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;

    return {
      pipes,
      mesh,
      geometry,
      material,
      flash,
      inside: new Uint8Array(pipes.length),
      lastPlayed: new Float32Array(pipes.length).fill(-10),
      hinted: hintSeen(),
      clock: 0,
      seenGlows: runtime.glows,
      /** 아르페지오로 예약된 음 [울릴 시각, 관 번호] */
      queue: [] as [number, number][],
    };
  }, []);

  // 다른 사람이 울린 음은 그 자리에서 들린다
  useEffect(
    () =>
      onRemoteNote((i) => {
        const p = sim.pipes[i];
        if (!p) return;
        sim.flash[i] = 1;
        audio.note(p.freq, p.tip, 0.85);
      }),
    [sim],
  );

  useEffect(
    () => () => {
      sim.geometry.dispose();
      sim.material.dispose();
    },
    [sim],
  );

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    sim.clock = clock.elapsedTime;
    const playing = getState().phase === "playing";
    const pos = runtime.pos;
    const { pipes, flash, inside, lastPlayed } = sim;

    // 무리 곁에서 인사하면 여섯 관이 차례로 울린다 (아르페지오)
    if (runtime.glows !== sim.seenGlows) {
      sim.seenGlows = runtime.glows;
      if (playing) {
        CHOIRS.forEach(([cx, cz], c) => {
          if (Math.hypot(pos.x - cx, pos.z - cz) > 10) return;
          const up = Math.random() < 0.5;
          for (let k = 0; k < SONG_PIPES_PER_CHOIR; k++) {
            const i = c * SONG_PIPES_PER_CHOIR + (up ? SONG_PIPES_PER_CHOIR - 1 - k : k);
            sim.queue.push([sim.clock + 0.15 + k * 0.16, i]);
          }
        });
      }
    }
    for (let q = sim.queue.length - 1; q >= 0; q--) {
      const [at, i] = sim.queue[q];
      if (sim.clock < at) continue;
      sim.queue.splice(q, 1);
      lastPlayed[i] = sim.clock;
      flash[i] = 1;
      audio.note(pipes[i].freq, pipes[i].tip, 0.8);
      network.sendNote(i);
    }

    for (let i = 0; i < pipes.length; i++) {
      const p = pipes[i];
      const hd = Math.hypot(pos.x - p.x, pos.z - p.z);
      const within = pos.y > p.base - 0.5 && pos.y < p.top + 1.6;
      if (!inside[i] && within && hd < ENTER) {
        inside[i] = 1;
        if (playing && sim.clock - lastPlayed[i] > COOLDOWN) {
          lastPlayed[i] = sim.clock;
          flash[i] = 1;
          audio.note(p.freq, p.tip, 1);
          network.sendNote(i);
        }
      } else if (inside[i] && (!within || hd > LEAVE)) {
        inside[i] = 0;
      }
      flash[i] = Math.max(0, flash[i] - dt * 0.9);
    }
    (sim.geometry.attributes.aFlash as InstancedBufferAttribute).needsUpdate = true;
    sim.material.uniforms.uTime.value = clock.elapsedTime;

    // 처음 무리 가까이 왔을 때 한 번만 알려 준다
    if (playing && !sim.hinted) {
      for (const [cx, cz] of CHOIRS) {
        if (Math.hypot(pos.x - cx, pos.z - cz) < 10) {
          sim.hinted = true;
          try {
            localStorage.setItem(HINT_KEY, "1");
          } catch {
            /* noop */
          }
          toast("빛나는 관을 스치면 노래해요. 곁에서 인사(E)하면 한꺼번에 울리고, 여럿이 함께 울리면 화음이 돼요.", 9000);
          break;
        }
      }
    }
  });

  return <primitive object={sim.mesh} />;
}
