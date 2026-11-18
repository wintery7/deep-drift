import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FOG_COLOR, FOG_DENSITY, mulberry32 } from "../game/runtime.ts";

/** 해파리 한 마리의 애니메이션 입력값 */
export interface JellyMotion {
  /** 맥동 위상 (라디안, 계속 누적) */
  pulse: number;
  /** 0..1 속도 비율 */
  speed: number;
  /** 해파리 로컬 좌표계에서의 속도 (최대 속도로 정규화) — 촉수가 뒤로 끌리는 방향 */
  velLocal: Vector3;
  opacity: number;
  /** 인사의 빛 1 → 0 */
  flash: number;
  /** 곁에 누군가 머물 때 은은히 밝아지는 정도 0..1 */
  boost: number;
  /** 0..1 자람 — 촉수가 길어지고 조금 더 밝아진다 */
  grow: number;
  /** 0..1 술래의 주황빛 */
  it: number;
}

export const createMotion = (): JellyMotion => ({
  pulse: Math.random() * Math.PI * 2,
  speed: 0,
  velLocal: new Vector3(),
  opacity: 1,
  flash: 0,
  boost: 0,
  grow: 0,
  it: 0,
});

// ---------------------------------------------------------------------
// Geometry (모든 해파리가 공유)
// ---------------------------------------------------------------------

/** 머리(우산): 위쪽이 +Y인 살짝 납작한 돔 */
export const bellGeometry: BufferGeometry = (() => {
  const g = new SphereGeometry(1, 40, 22, 0, Math.PI * 2, 0, Math.PI * 0.56);
  g.scale(1, 0.82, 1);
  return g;
})();

/** 촉수: 가장자리의 가는 촉수 + 가운데의 굵은 구완. aT = 뿌리(0)→끝(1) */
/**
 * 촉수 묶음. radial: 단면의 각 수 (크게 키울 것이라면 둥글게),
 * rim: 가장자리 촉수 수, armThick: 가운데 굵은 구완의 굵기 배율.
 */
export function createTentacleGeometry(radial = 4, rim = 12, armThick = 1): BufferGeometry {
  const rng = mulberry32(7);
  const parts: BufferGeometry[] = [];

  const add = (angle: number, radius: number, length: number, thick: number, baseY: number) => {
    const g = new CylinderGeometry(thick, thick * 0.12, length, radial, 16, true);
    g.translate(0, -length / 2, 0);
    const pos = g.attributes.position;
    const aT = new Float32Array(pos.count);
    const aPhase = new Float32Array(pos.count);
    const phase = rng() * Math.PI * 2;
    for (let i = 0; i < pos.count; i++) {
      aT[i] = Math.min(1, Math.max(0, -pos.getY(i) / length));
      aPhase[i] = phase;
    }
    g.setAttribute("aT", new BufferAttribute(aT, 1));
    g.setAttribute("aPhase", new BufferAttribute(aPhase, 1));
    g.translate(Math.cos(angle) * radius, baseY, Math.sin(angle) * radius);
    parts.push(g);
  };

  for (let i = 0; i < rim; i++) {
    add((i / rim) * Math.PI * 2 + rng() * 0.2, 0.88, 2.3 + rng() * 1.5, 0.03, -0.1);
  }
  const ARMS = 5;
  for (let i = 0; i < ARMS; i++) {
    add((i / ARMS) * Math.PI * 2 + 0.3, 0.2, 1.5 + rng() * 0.7, 0.1 * armThick, 0.05);
  }

  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged!;
}

export const tentacleGeometry: BufferGeometry = createTentacleGeometry();

// ---------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------

const COMMON_VERT = /* glsl */ `
  uniform float uPulse;
  uniform float uSpeed;
  uniform float uGrow;
  uniform vec3 uColor;
  uniform vec3 uGlow;
  #ifdef USE_INSTANCING
    attribute float aSeed;
  #endif
  varying vec3 vColor;
  varying vec3 vGlow;
  varying float vDepth;
`;

const COMMON_FRAG = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uOpacity;
  uniform float uFlash;
  uniform float uBoost;
  uniform float uGrow;
  varying vec3 vColor;
  varying vec3 vGlow;
  varying float vDepth;
  float fogFactor() {
    return 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  }
`;

// seed / 인스턴스 행렬 / 색을 정리하는 공통 도입부
const VERT_SETUP = /* glsl */ `
  float seed = 0.0;
  mat4 m = modelMatrix;
  vColor = uColor;
  vGlow = uGlow;
  #ifdef USE_INSTANCING
    seed = aSeed;
    m = modelMatrix * instanceMatrix;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
    vGlow = mix(instanceColor, vec3(1.0), 0.55);
  #endif
  float contract = sin(uPulse + seed) * 0.5 + 0.5;
  float amp = 0.10 + 0.12 * uSpeed;
`;

const BELL_VERT = /* glsl */ `
  ${COMMON_VERT}
  varying vec3 vN;
  varying vec3 vV;
  varying float vT;
  varying float vAng;

  void main() {
    ${VERT_SETUP}
    float t = 1.0 - uv.y;               // 0 = 정수리, 1 = 가장자리
    vec3 p = position;
    p.xz *= 1.0 - amp * contract * t * t; // 가장자리가 오므라든다
    p.y += contract * 0.07 * (1.0 - t);
    float ang = atan(position.z, position.x);
    p.y += sin(ang * 8.0 + uPulse * 0.5 + seed) * 0.025 * t * t;

    vec4 mv = viewMatrix * m * vec4(p, 1.0);
    vN = normalize(mat3(viewMatrix * m) * normal);
    vV = normalize(-mv.xyz);
    vT = t;
    vAng = ang;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const BELL_FRAG = /* glsl */ `
  ${COMMON_FRAG}
  varying vec3 vN;
  varying vec3 vV;
  varying float vT;
  varying float vAng;

  void main() {
    float fres = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.0);
    vec3 col = mix(vColor * 0.6, vGlow, fres);
    // 방사형 줄무늬와 가장자리의 빛 띠
    col += vGlow * (0.5 + 0.5 * sin(vAng * 16.0)) * 0.14 * vT;
    float rim = smoothstep(0.78, 1.0, vT);
    col += vGlow * rim * 0.55;
    // 정수리 안쪽에서 비치는 빛
    col += vGlow * (1.0 - smoothstep(0.0, 0.5, vT)) * 0.22;

    col *= 1.0 + uBoost * 0.35 + uGrow * 0.2;
    col += vGlow * uFlash * 0.5;
    float alpha = 0.2 + 0.6 * fres + 0.3 * rim + uFlash * 0.25;
    float fog = fogFactor();
    col = mix(col, uFogColor, fog);
    alpha *= (1.0 - fog * 0.65) * uOpacity;
    gl_FragColor = vec4(col, alpha);
  }
`;

const TENTACLE_VERT = /* glsl */ `
  ${COMMON_VERT}
  uniform float uTime;
  uniform vec3 uVelLocal;
  attribute float aT;
  attribute float aPhase;
  varying float vAT;
  varying float vPh;

  void main() {
    ${VERT_SETUP}
    vec3 p = position;
    p.xz *= 1.0 - amp * contract * (1.0 - aT);
    p.y *= 1.0 + uGrow * 0.9; // 자랄수록 길어진다 (다 자라면 약 1.9배)

    float sway = aT * aT * (1.0 + uGrow * 0.9);
    float w = uTime * 1.3 + aPhase + seed;
    p.x += sin(w - aT * 5.0) * 0.22 * sway + sin(w * 0.6 + aT * 3.0) * 0.08 * aT;
    p.z += cos(w * 0.9 - aT * 4.0) * 0.22 * sway;
    // 움직이는 반대쪽으로 끌려간다
    p -= uVelLocal * sway * 1.5;
    // 맥동할 때 살짝 늘어난다
    p.y -= contract * 0.14 * aT;

    vec4 mv = viewMatrix * m * vec4(p, 1.0);
    vAT = aT;
    vPh = aPhase + seed;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const TENTACLE_FRAG = /* glsl */ `
  ${COMMON_FRAG}
  uniform float uTime;
  varying float vAT;
  varying float vPh;

  void main() {
    vec3 col = mix(vGlow, vColor, smoothstep(0.0, 0.6, vAT));
    // 촉수를 따라 흘러내리는 빛
    float band = pow(clamp(0.5 + 0.5 * sin(vAT * 9.0 - uTime * 1.8 + vPh), 0.0, 1.0), 5.0);
    col *= 0.55 + 0.9 * band;
    col *= 1.0 + uBoost * 0.45 + uFlash * 1.0 + uGrow * 0.55;
    float alpha = pow(clamp(1.0 - vAT, 0.0, 1.0), 0.8) * 0.55 * uOpacity;
    float fog = fogFactor();
    gl_FragColor = vec4(col * (1.0 - fog), alpha * (1.0 - fog));
  }
`;

function baseUniforms() {
  return {
    uPulse: { value: 0 },
    uSpeed: { value: 0 },
    uTime: { value: 0 },
    uOpacity: { value: 1 },
    uFlash: { value: 0 },
    uBoost: { value: 0 },
    uGrow: { value: 0 },
    uColor: { value: new Color("#8a66ff") },
    uGlow: { value: new Color("#dccdff") },
    uVelLocal: { value: new Vector3() },
    uFogColor: { value: new Color(FOG_COLOR) },
    uFogDensity: { value: FOG_DENSITY },
  };
}

export interface JellyMaterials {
  bell: ShaderMaterial;
  tentacle: ShaderMaterial;
}

export function createJellyMaterials(): JellyMaterials {
  const bell = new ShaderMaterial({
    uniforms: baseUniforms(),
    vertexShader: BELL_VERT,
    fragmentShader: BELL_FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const tentacle = new ShaderMaterial({
    uniforms: baseUniforms(),
    vertexShader: TENTACLE_VERT,
    fragmentShader: TENTACLE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  return { bell, tentacle };
}
