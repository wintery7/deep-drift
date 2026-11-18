import { useSyncExternalStore } from "react";
import { PUBLIC_SEA, WORLD, isValidSea } from "../../../shared/world.ts";
import { NAME_FIRST, NAME_SECOND, isValidNamePart, randomNameParts } from "../../../shared/names.ts";

export type Phase = "menu" | "playing";
export type NetStatus = "offline" | "connecting" | "online" | "reconnecting";

export interface GameState {
  phase: Phase;
  paused: boolean;
  /** 환경음 볼륨 0..1 */
  ambientVol: number;
  /** 효과음 볼륨 0..1 */
  sfxVol: number;
  muted: boolean;
  /** 해파리 외형 */
  variant: number;
  /** 익명 이름 (단어 두 개의 번호) */
  nameA: number;
  nameB: number;
  net: NetStatus;
  /** 같은 방에 있는 다른 해파리 수 */
  others: number;
  /** 들어갈 바다의 이름. 초대 링크(?sea=...)로 오면 그 바다, 아니면 모두의 바다 */
  sea: string;
  /** 화면 아래에 잠깐 떠오르는 안내 문구 */
  toast: string;
  /** 술래잡기: "" (안 함) · "it" (내가 술래) · "runner" (도망) */
  tag: "" | "it" | "runner";
  /** 술래잡기 상대의 이름 */
  tagPartner: string;
  /** 술래잡기가 끝나는 시각 (Date.now 기준) */
  tagEndsAt: number;
}

const STORAGE_KEY = "deep-drift:prefs";

function loadPrefs(): Partial<GameState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<GameState> = {};
    if (typeof p.ambientVol === "number") out.ambientVol = Math.min(1, Math.max(0, p.ambientVol));
    if (typeof p.sfxVol === "number") out.sfxVol = Math.min(1, Math.max(0, p.sfxVol));
    if (typeof p.muted === "boolean") out.muted = p.muted;
    if (typeof p.variant === "number" && Number.isInteger(p.variant) && p.variant >= 0 && p.variant < WORLD.variants) {
      out.variant = p.variant;
    }
    if (isValidNamePart(p.nameA, NAME_FIRST) && isValidNamePart(p.nameB, NAME_SECOND)) {
      out.nameA = p.nameA;
      out.nameB = p.nameB;
    }
    return out;
  } catch {
    return {};
  }
}

function seaFromUrl(): string {
  try {
    const v = new URLSearchParams(location.search).get("sea");
    return isValidSea(v) ? v : PUBLIC_SEA;
  } catch {
    return PUBLIC_SEA;
  }
}

const initialName = randomNameParts();

let state: GameState = {
  phase: "menu",
  paused: false,
  ambientVol: 0.7,
  sfxVol: 0.6,
  muted: false,
  // 첫 방문자는 외형을 자동 배정받는다.
  variant: Math.floor(Math.random() * WORLD.variants),
  // 이름도 처음 오면 자동으로 정해진다.
  nameA: initialName[0],
  nameB: initialName[1],
  net: "offline",
  others: 0,
  sea: seaFromUrl(),
  toast: "",
  tag: "",
  tagPartner: "",
  tagEndsAt: 0,
  ...loadPrefs(),
};

const listeners = new Set<() => void>();

function persist() {
  try {
    const { ambientVol, sfxVol, muted, variant, nameA, nameB } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ambientVol, sfxVol, muted, variant, nameA, nameB }));
  } catch {
    // 저장 불가(사생활 보호 모드 등)여도 플레이에는 지장 없음
  }
}
persist();

export const getState = () => state;

export function setState(patch: Partial<GameState>) {
  state = { ...state, ...patch };
  persist();
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 원시값을 돌려주는 selector만 사용한다. */
export function useGame<T>(selector: (s: GameState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}
