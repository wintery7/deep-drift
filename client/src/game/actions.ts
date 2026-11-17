import { PUBLIC_SEA } from "../../../shared/world.ts";
import { randomNameParts } from "../../../shared/names.ts";
import { audio } from "../audio/AudioEngine.ts";
import { network } from "../net/network.ts";
import { clearInput } from "./input.ts";
import { runtime } from "./runtime.ts";
import { getState, setState, subscribe } from "./store.ts";
import { toast } from "./toast.ts";

/** 심해 입장 — 버튼 클릭(사용자 제스처) 안에서 호출되어 오디오를 깨운다. */
export function enterOcean() {
  const s = getState();
  if (s.phase === "playing") return;
  audio.setLevels(s.ambientVol, s.sfxVol, s.muted);
  audio.start();
  network.connect(s.variant, s.sea);
  clearInput();
  setState({ phase: "playing", paused: false });
}

export function exitOcean() {
  network.leave();
  audio.stop();
  clearInput();
  setState({ phase: "menu", paused: false, others: 0, toast: "" });
}

export function setPaused(paused: boolean) {
  if (getState().phase !== "playing") return;
  clearInput();
  setState({ paused });
}

// ---------------------------------------------------------------------
// 안내 문구
// ---------------------------------------------------------------------

export { toast };

// ---------------------------------------------------------------------
// 익명 이름과 쉬는 중
// ---------------------------------------------------------------------

/** 메뉴에서 이름을 다시 뽑는다 (다음 입장부터 적용) */
export function rerollName() {
  const { nameA, nameB } = getState();
  let next = randomNameParts();
  while (next[0] === nameA && next[1] === nameB) next = randomNameParts();
  setState({ nameA: next[0], nameB: next[1] });
}

/** 일시정지했거나 다른 탭·창으로 가 있으면 다른 사람에게 "쉬는 중"으로 보인다 */
function syncResting() {
  const s = getState();
  network.sendRest(s.phase === "playing" && (s.paused || document.hidden));
}
document.addEventListener("visibilitychange", syncResting);
subscribe(syncResting);

// ---------------------------------------------------------------------
// 빛으로 건네는 인사
// ---------------------------------------------------------------------

let lastGlow = 0;

export function glow() {
  const s = getState();
  if (s.phase !== "playing" || s.paused) return;
  const now = performance.now();
  if (now - lastGlow < 1200) return;
  lastGlow = now;
  runtime.flash = true;
  network.sendGlow();
  audio.chime(runtime.pos);
}

// ---------------------------------------------------------------------
// 초대 — 링크를 가진 사람끼리만 만나는 바다
// ---------------------------------------------------------------------

function randomSea(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function setSeaInUrl(sea: string) {
  try {
    const url = new URL(location.href);
    if (sea === PUBLIC_SEA) url.searchParams.delete("sea");
    else url.searchParams.set("sea", sea);
    history.replaceState(null, "", url);
  } catch {
    /* noop */
  }
}

export async function invite() {
  let { sea } = getState();
  let moved = false;
  if (sea === PUBLIC_SEA) {
    // 모두의 바다에 있었다면, 초대용 바다를 새로 만들어 그곳으로 옮긴다.
    sea = randomSea();
    setSeaInUrl(sea);
    setState({ sea });
    if (getState().phase === "playing") {
      network.leave();
      network.connect(getState().variant, sea);
    }
    moved = true;
  }
  const link = `${location.origin}${location.pathname}?sea=${sea}`;
  try {
    await navigator.clipboard.writeText(link);
    toast(
      moved
        ? "초대용 바다로 옮기고 링크를 복사했어요. 이 링크로 들어온 사람과 여기서 만납니다."
        : "초대 링크를 복사했어요. 이 링크로 들어온 사람과 여기서 만납니다.",
      8000,
    );
  } catch {
    // 클립보드를 쓸 수 없으면 링크를 직접 보여 준다.
    toast(`초대 링크: ${link}`, 20000);
  }
}

/** 초대받은 바다를 떠나 모두의 바다로 (메뉴에서 사용) */
export function usePublicSea() {
  setSeaInUrl(PUBLIC_SEA);
  setState({ sea: PUBLIC_SEA });
}

// 볼륨·음소거 설정이 바뀌면 곧바로 오디오에 반영한다.
let last = "";
subscribe(() => {
  const { ambientVol, sfxVol, muted } = getState();
  const key = `${ambientVol}|${sfxVol}|${muted}`;
  if (key === last) return;
  last = key;
  audio.setLevels(ambientVol, sfxVol, muted);
});
