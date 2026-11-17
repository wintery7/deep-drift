import { Vector3 } from "three";

/** 매 프레임 바뀌는 값들. React 상태를 거치지 않고 직접 읽고 쓴다. */
export const runtime = {
  pos: new Vector3(0, -4, 0),
  vel: new Vector3(),
  yaw: 0,
  lean: 0,
  /** 0..1 속도 비율 */
  speed: 0,
  whalePos: new Vector3(60, 14, 0),
  /** 내 해파리의 맥동 위상 — 곁에 머무는 해파리가 여기에 맞춰진다 */
  pulse: 0,
  /** true가 되면 다음 프레임에 내 해파리가 인사의 빛을 낸다 */
  flash: false,
  /** 곁에 머무는 해파리와의 교감 0..1 (가장 깊은 값) */
  bond: 0,
  bondAccum: 0,
};

/** 내 해파리의 위치를 셰이더에 전하는 공용 uniform — 지나가면 산호가 은은히 밝아진다 */
export const playerUniform = { value: new Vector3(0, -1000, 0) };

/** 모든 클라이언트가 공유하는 시계(초). 고래·물고기 떼가 모두에게 같은 자리에 보이게 한다. */
export function worldTime(): number {
  return (Date.now() / 1000) % 100000;
}

/** 재현 가능한 난수 — 환경 배치가 모든 사용자에게 동일하도록. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const FOG_COLOR = "#051534";
export const FOG_DENSITY = 0.016;

export const VARIANTS = [
  { name: "라벤더", color: "#8a66ff", glow: "#dccdff" },
  { name: "아쿠아", color: "#2aa4ff", glow: "#b9ecff" },
  { name: "코랄 핑크", color: "#ff5aa8", glow: "#ffd2e8" },
  { name: "민트", color: "#22cfa2", glow: "#c6ffea" },
] as const;
