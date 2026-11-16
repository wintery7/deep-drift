import { audio } from "../audio/AudioEngine.ts";
import { network } from "../net/network.ts";
import { clearInput } from "./input.ts";
import { getState, setState, subscribe } from "./store.ts";

/** 심해 입장 — 버튼 클릭(사용자 제스처) 안에서 호출되어 오디오를 깨운다. */
export function enterOcean() {
  const s = getState();
  if (s.phase === "playing") return;
  audio.setLevels(s.ambientVol, s.sfxVol, s.muted);
  audio.start();
  network.connect(s.variant);
  clearInput();
  setState({ phase: "playing", paused: false });
}

export function exitOcean() {
  network.leave();
  audio.stop();
  clearInput();
  setState({ phase: "menu", paused: false, others: 0 });
}

export function setPaused(paused: boolean) {
  if (getState().phase !== "playing") return;
  clearInput();
  setState({ paused });
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
