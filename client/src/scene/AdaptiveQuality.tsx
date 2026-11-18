import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

/**
 * 화질 단계 — 프레임이 떨어지면 낮추고, 여유가 생기면 천천히 되돌린다.
 *  2: 선명 (dpr 최대 1.75, 안티앨리어싱 4x)
 *  1: 보통 (dpr 최대 1.25, 안티앨리어싱 없음)
 *  0: 가볍게 (dpr 1, 안티앨리어싱 없음)
 */
export const QUALITY_DPR = [1, 1.25, 1.75] as const;
export const QUALITY_MSAA = [0, 0, 4] as const;

const WINDOW_S = 2;
const LOW_FPS = 48;
const HIGH_FPS = 58;
/** 화질을 올리기 전에 여유가 이어져야 하는 시간 */
const RAISE_AFTER_S = 12;

/**
 * 탭이 가려지거나 창이 화면에 없으면 브라우저가 프레임을 늦추는데, 그것을 느린 그래픽으로 착각하지 않도록
 * 100ms보다 긴 프레임은 셈에서 뺀다.
 */
export function AdaptiveQuality({ level, onChange }: { level: number; onChange: (next: number) => void }) {
  const { gl, scene, camera } = useThree();
  const acc = useRef({ time: 0, frames: 0, good: 0, settle: 3 });

  // 처음에 장면 전체의 셰이더를 미리 만들어, 처음 보는 물체 때문에 멈칫하지 않게 한다
  useEffect(() => {
    try {
      gl.compile(scene, camera);
    } catch {
      /* noop */
    }
  }, [gl, scene, camera]);

  useEffect(() => {
    acc.current = { time: 0, frames: 0, good: 0, settle: 3 };
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
    if (a.time < WINDOW_S) return;
    const fps = a.frames / a.time;
    a.time = 0;
    a.frames = 0;
    if (fps < LOW_FPS && level > 0) {
      onChange(level - 1);
    } else if (fps > HIGH_FPS && level < QUALITY_DPR.length - 1) {
      a.good += WINDOW_S;
      if (a.good >= RAISE_AFTER_S) onChange(level + 1);
    } else {
      a.good = 0;
    }
  });

  return null;
}
