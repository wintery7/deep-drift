import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

/**
 * 화질 단계
 *  2: 선명 (dpr 최대 1.75, 안티앨리어싱 4x) — 작은 창에서만
 *  1: 보통 (dpr 최대 1.25, 안티앨리어싱 없음)
 *  0: 가볍게 (dpr 1, 안티앨리어싱 없음)
 *
 * 측정(AMD Radeon 820M, 전체화면 1920×1080): 2단계 17~18.5ms, 1단계 약 10ms.
 * 예산(16.7ms)을 살짝만 넘어도 프레임이 가끔 33ms로 밀려 뚝뚝 끊겨 보이므로,
 * 안티앨리어싱은 화면이 작을 때만 쓴다.
 */
export const QUALITY_DPR = [1, 1.25, 1.75] as const;
export const QUALITY_MSAA = [0, 0, 4] as const;

/** 이보다 픽셀이 많은 화면은 처음부터 1단계로 시작한다 */
const MSAA_MAX_PIXELS = 1_000_000;

export function initialQuality(): number {
  const dpr = Math.min(window.devicePixelRatio || 1, QUALITY_DPR[2]);
  const pixels = window.innerWidth * window.innerHeight * dpr * dpr;
  return pixels <= MSAA_MAX_PIXELS ? 2 : 1;
}

const WINDOW_S = 2;
/** 20ms를 넘긴 프레임 — 60Hz 화면에서 한 번 건너뛴 프레임 */
const SLOW_FRAME = 0.021;
const DROP_FPS = 50;
const DROP_SLOW_RATIO = 0.12;
const RAISE_FPS = 58;
const RAISE_SLOW_RATIO = 0.02;
/** 화질을 올리기 전에 여유가 이어져야 하는 시간 */
const RAISE_AFTER_S = 12;

/**
 * 프레임이 자주 밀리면 화질을 한 단계 낮춘다. 한 번 낮춘 단계로는 다시 올라가지 않아서
 * 올라갔다 내려갔다 하며 주기적으로 끊기는 일이 없다.
 * 탭이 가려지거나 창이 화면에 없으면 브라우저가 프레임을 늦추는데, 그것을 느린 그래픽으로 착각하지 않도록
 * 100ms보다 긴 프레임은 셈에서 뺀다.
 */
export function AdaptiveQuality({ level, onChange }: { level: number; onChange: (next: number) => void }) {
  const { gl, scene, camera } = useThree();
  const ceiling = useRef(level);
  const acc = useRef({ time: 0, frames: 0, slow: 0, good: 0, settle: 3 });

  // 처음에 장면 전체의 셰이더를 미리 만들어, 처음 보는 물체 때문에 멈칫하지 않게 한다
  useEffect(() => {
    try {
      gl.compile(scene, camera);
    } catch {
      /* noop */
    }
  }, [gl, scene, camera]);

  useEffect(() => {
    acc.current = { time: 0, frames: 0, slow: 0, good: 0, settle: 3 };
  }, [level]);

  useFrame((_, dt) => {
    const a = acc.current;
    if (document.hidden || dt > 0.1) return;
    if (a.settle > 0) {
      a.settle -= dt; // 단계를 바꾼 직후는 재지 않는다
      return;
    }
    a.time += dt;
    a.frames++;
    if (dt > SLOW_FRAME) a.slow++;
    if (a.time < WINDOW_S) return;

    const fps = a.frames / a.time;
    const slowRatio = a.slow / a.frames;
    a.time = 0;
    a.frames = 0;
    a.slow = 0;

    if ((fps < DROP_FPS || slowRatio > DROP_SLOW_RATIO) && level > 0) {
      ceiling.current = level - 1;
      onChange(level - 1);
    } else if (fps > RAISE_FPS && slowRatio < RAISE_SLOW_RATIO && level < ceiling.current) {
      a.good += WINDOW_S;
      if (a.good >= RAISE_AFTER_S) onChange(level + 1);
    } else {
      a.good = 0;
    }
  });

  return null;
}
