// 클라이언트와 서버가 함께 쓰는 심해 월드 정의.
// 서버는 이 값으로 이동 범위를 검증하고, 클라이언트는 같은 값으로 지형과 경계를 만든다.

export const WORLD = {
  /** 유영 가능한 수평 반경 (이 근처부터 부드러운 해류가 안쪽으로 밀어준다) */
  radius: 85,
  /** 서버가 허용하는 최대 수평 반경 */
  hardRadius: 96,
  /** 수면 쪽 상한 */
  ceiling: 32,
  /** 해저 지형에서 띄워 둘 최소 높이 */
  floorClearance: 1.4,
  /** 해파리 최대 속도 (units/s) */
  maxSpeed: 6,
  /** 방 하나의 최대 인원 */
  maxPlayers: 8,
  /** 해파리 외형(색상) 가짓수 */
  variants: 4,
} as const;

/** 해저 지형 높이. 가장자리로 갈수록 솟아올라 그릇 모양의 분지를 만든다. */
export function terrainHeight(x: number, z: number): number {
  let h =
    -18 +
    4.0 * Math.sin(x * 0.05) * Math.cos(z * 0.04) +
    2.5 * Math.sin(x * 0.11 + 1.3) * Math.sin(z * 0.09 + 0.5) +
    1.2 * Math.sin((x + z) * 0.21) +
    0.5 * Math.sin(x * 0.37 - z * 0.29);
  const r = Math.hypot(x, z);
  if (r > 70) {
    const t = (r - 70) / 30;
    h += t * t * 26;
  }
  return h;
}

export const MSG_MOVE = "move";
/** 빛으로 건네는 인사 */
export const MSG_GLOW = "glow";

/** 누구나 들어오는 기본 바다. 초대 링크는 별도의 이름을 가진 바다로 이어진다. */
export const PUBLIC_SEA = "public";
export function isValidSea(v: unknown): v is string {
  return typeof v === "string" && /^[a-z0-9]{4,16}$/.test(v);
}

export interface MoveMessage {
  x: number;
  y: number;
  z: number;
  /** 진행 방향 (라디안, +Z 기준) */
  yaw: number;
  /** 진행 방향으로 기운 정도 (라디안) */
  lean: number;
  /** 0..1 속도 비율 — 촉수/맥동 애니메이션에 사용 */
  speed: number;
  /** 0..1 자람 — 촉수와 꼬리빛의 길이 (보이기만 하는 값) */
  growth: number;
}
