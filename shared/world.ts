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
/** 쉬는 중인지 (일시정지·다른 탭) — true/false */
export const MSG_REST = "rest";
/** 노래하는 산호를 울렸다 — { i: 관 번호 } */
export const MSG_NOTE = "note";

/**
 * 깊은 곳에 잠든 거대한 빛. 두 명 이상이 곁에서 함께 빛으로 인사하면 깨어난다.
 * reach: 이 수평 거리 안에서 건넨 인사만 닿는다.
 */
export const SLEEPER = {
  x: 40,
  z: 30,
  reach: 20,
  /** 함께 깨웠을 때 깨어 있는 시간 */
  awakeSeconds: 60,
  togetherWindowMs: 8000,
  /** 혼자 있어도 볼 수 있도록 스스로 잠시 눈을 뜨는 간격과 시간 */
  selfWakeEverySeconds: 360,
  selfWakeSeconds: 30,
} as const;

/** 깨어난 까닭 — 1: 함께 인사해서, 2: 스스로 */
export const WAKE_TOGETHER = 1;
export const WAKE_SELF = 2;

/**
 * 빛 술래잡기 — 서로 동의한 두 사람만 한다.
 * 곁의 해파리에게 E를 두 번 누르면 놀자는 빛이 가고, 상대도 두 번 누르면 시작한다.
 */
export const TAG = {
  /** 이 거리 안의 가장 가까운 해파리에게 청한다 */
  inviteRange: 12,
  /** 인사 두 번 사이 간격이 이보다 짧으면 "놀자" 신호 */
  doubleGlowMs: 1300,
  inviteExpireMs: 20000,
  /** 청한 사람과 이만큼 멀어지면 청이 사라진다 */
  inviteBreakDistance: 25,
  durationMs: 120000,
  /** 술래가 이 거리 안으로 닿으면 넘어간다 */
  tagRadius: 2.2,
  /** 넘겨받은 직후 바로 되잡을 수 없는 시간 */
  immuneMs: 3000,
  /** 둘이 이만큼 멀어지면 끝난다 */
  breakDistance: 40,
  /** 쉬는 중이거나 연결이 끊긴 상태가 이만큼 이어지면 끝난다 (잠깐 다른 탭에 다녀오는 건 괜찮다) */
  awayGraceMs: 8000,
} as const;

/** 노래하는 산호: 무리 수 × 무리당 관 수 */
export const SONG_CHOIRS = 5;
export const SONG_PIPES_PER_CHOIR = 6;
export const SONG_PIPES = SONG_CHOIRS * SONG_PIPES_PER_CHOIR;

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
  /** 보낸 쪽의 시각(ms, performance.now) — 받는 쪽 보간용 */
  t: number;
}
