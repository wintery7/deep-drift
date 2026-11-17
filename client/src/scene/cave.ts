import type { Vector3 } from "three";
import { terrainHeight } from "../../../shared/world.ts";

/**
 * 해저 동굴의 형태와 충돌 판정.
 * 동굴은 해저에 엎어 놓은 속 빈 바위 돔이다. 중심에서 본 방향(dir)마다 벽까지의 거리가 정해지고,
 * 몇 개의 "구멍"(입구·뒷문·천장의 빛 구멍)이 뚫려 있다. 메시와 충돌이 같은 함수를 쓴다.
 */

const CX = -40;
const CZ = -32;

export const CAVE = {
  x: CX,
  y: terrainHeight(CX, CZ) + 0.5,
  z: CZ,
  radius: 15,
  /** 세로로 눌린 정도 — 돔이 반구보다 납작하다 */
  squash: 0.75,
} as const;

const unit = (x: number, y: number, z: number) => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l] as const;
};

/** 구멍들: 축 방향과 각반경(라디안) */
export const CAVE_OPENINGS = [
  { axis: unit(0.78, 0.18, 0.62), half: 0.52 }, // 큰 입구 — 바다 중심 쪽을 향한다
  { axis: unit(-0.55, 0.28, -0.8), half: 0.36 }, // 작은 뒷문
  { axis: unit(0.1, 1, -0.15), half: 0.3 }, // 천장의 빛 구멍
] as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 가장 가까운 구멍 가장자리까지의 각거리. 음수면 구멍 안쪽. */
export function openingDepth(dx: number, dy: number, dz: number): number {
  let m = Infinity;
  for (const o of CAVE_OPENINGS) {
    const dot = dx * o.axis[0] + dy * o.axis[1] + dz * o.axis[2];
    const ang = Math.acos(Math.min(1, Math.max(-1, dot)));
    m = Math.min(m, ang - o.half);
  }
  return m;
}

/** 방향별 벽의 기준 반경 (울퉁불퉁한 바위 느낌) */
export function caveBase(dx: number, dy: number, dz: number): number {
  return (
    CAVE.radius +
    1.1 * Math.sin(dx * 4.1 + 1.3) * Math.cos(dz * 3.7 + 0.4) +
    0.6 * Math.sin(dy * 6.3 + dx * 3.1) +
    0.3 * Math.sin(dz * 9.7 + dy * 8.3 + 1.0)
  );
}

/** 구멍 가장자리에서 0, 벽 한가운데에서 1 — 가장자리로 갈수록 벽이 얇아져 안팎이 만난다 */
function wallness(dx: number, dy: number, dz: number): number {
  const e = clamp01(openingDepth(dx, dy, dz) / 0.25);
  return e * e * (3 - 2 * e);
}

/** 메시용: 바깥면/안쪽면의 반경 */
export function shellRadius(dx: number, dy: number, dz: number, outer: boolean): number {
  const base = caveBase(dx, dy, dz);
  const s = wallness(dx, dy, dz);
  const h = Math.sin(dx * 127.1 + dy * 311.7 + dz * 74.7) * 43758.5453;
  const jitter = (h - Math.floor(h) - 0.5) * 0.5;
  return outer ? base + (1.6 + jitter) * s : base - (0.6 + jitter * 0.6) * s;
}

// 판정 결과를 담아 두는 임시 값 (할당을 피하기 위해 모듈 변수 사용)
let _dx = 0;
let _dy = 0;
let _dz = 0;
let _d = 0;
let _inner = 0;
let _outer = 0;

function probe(x: number, y: number, z: number, margin: number): boolean {
  const qx = x - CAVE.x;
  const qy = (y - CAVE.y) / CAVE.squash;
  const qz = z - CAVE.z;
  const d = Math.hypot(qx, qy, qz);
  if (d < 1e-3 || d > CAVE.radius + 6 + margin || d < CAVE.radius - 5 - margin) return false;
  _dx = qx / d;
  _dy = qy / d;
  _dz = qz / d;
  _d = d;
  if (_dy < -0.6) return false;
  // 구멍 안쪽이면 지나갈 수 있다 (몸 크기만큼은 가장자리에서 떨어져야 한다)
  if (openingDepth(_dx, _dy, _dz) < -margin / CAVE.radius) return false;
  const base = caveBase(_dx, _dy, _dz);
  const s = wallness(_dx, _dy, _dz);
  _inner = base - 0.6 * s - 0.3 - margin;
  _outer = base + 1.6 * s + 0.25 + margin;
  return d > _inner && d < _outer;
}

/** 이 지점이 바위 속인가 */
export function caveSolid(x: number, y: number, z: number, margin = 0): boolean {
  return probe(x, y, z, margin);
}

/** 바위에 파고든 위치를 가까운 쪽 표면으로 밀어낸다. 밀어냈으면 true. */
export function caveResolve(p: Vector3, margin: number): boolean {
  if (!probe(p.x, p.y, p.z, margin)) return false;
  const target = _d < (_inner + _outer) / 2 ? _inner : _outer;
  p.set(CAVE.x + _dx * target, CAVE.y + _dy * target * CAVE.squash, CAVE.z + _dz * target);
  return true;
}

/** 동굴 안에 얼마나 깊이 들어와 있는가 (0 = 밖, 1 = 안쪽) — 음향에 사용 */
export function caveInsideness(x: number, y: number, z: number): number {
  const qx = x - CAVE.x;
  const qy = (y - CAVE.y) / CAVE.squash;
  const qz = z - CAVE.z;
  const d = Math.hypot(qx, qy, qz);
  if (d > CAVE.radius + 2) return 0;
  if (d < 1e-3) return 1;
  return clamp01((caveBase(qx / d, qy / d, qz / d) - d) / 4);
}
