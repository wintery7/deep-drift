import { runtime } from "./runtime.ts";

/**
 * 해파리의 자람(0..1). 줄어들지 않고 쌓이기만 하며, 이 브라우저에 저장되어 다음에 와도 이어진다.
 * 점수처럼 보이지 않도록 숫자는 어디에도 표시하지 않고, 촉수와 꼬리빛의 길이로만 드러난다.
 */

const KEY = "deep-drift:growth";

function load(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  } catch {
    return 0;
  }
}

runtime.growth = load();
let lastSaved = runtime.growth;

export function saveGrowth() {
  if (Math.abs(runtime.growth - lastSaved) < 0.0005) return;
  lastSaved = runtime.growth;
  try {
    localStorage.setItem(KEY, runtime.growth.toFixed(4));
  } catch {
    // 저장할 수 없어도 이번 접속 동안은 계속 자란다
  }
}

/** 자랄수록 조금씩 더디게 자란다 — 다 자라려면 여러 번 들러야 한다 */
export function addGrowth(amount: number) {
  runtime.growth = Math.min(1, runtime.growth + amount * (1 - 0.7 * runtime.growth));
}

setInterval(saveGrowth, 4000);
window.addEventListener("pagehide", saveGrowth);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveGrowth();
});
