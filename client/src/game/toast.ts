import { setState } from "./store.ts";

/** 화면 아래에 잠깐 떠오르는 안내 문구 */
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(message: string, ms = 6000) {
  if (toastTimer) clearTimeout(toastTimer);
  setState({ toast: message });
  toastTimer = setTimeout(() => {
    toastTimer = null;
    setState({ toast: "" });
  }, ms);
}
