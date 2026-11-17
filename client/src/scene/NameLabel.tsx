import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { CanvasTexture, LinearFilter, SRGBColorSpace, SpriteMaterial, type Group, type Sprite } from "three";
import { runtime } from "../game/runtime.ts";

const W = 512;
const H = 112;
/** 이 거리 안으로 들어오면 이름이 떠오르기 시작한다 */
const SHOW_NEAR = 8;
const SHOW_FAR = 13;

/**
 * 다른 해파리 위에 떠오르는 이름표. 가까이 갔을 때만 은은하게 보이고, 멀어지면 사라진다.
 * 쉬는 중이면 이름 아래에 작게 "쉬는 중"이 붙는다.
 * 해파리가 기울어도 흔들리지 않도록 회전을 따르지 않고 위치만 따라간다.
 */
export function NameLabel({ target, name, resting }: { target: RefObject<Group | null>; name: string; resting: boolean }) {
  const sprite = useRef<Sprite>(null);
  const opacity = useRef(0);

  const { canvas, texture, material } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.generateMipmaps = false;
    const material = new SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0, fog: false });
    return { canvas, texture, material };
  }, []);

  useEffect(() => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const font = `"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif`;
    ctx.shadowColor = "rgba(5, 12, 40, 0.9)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "rgba(214, 224, 246, 0.95)";
    ctx.font = `500 40px ${font}`;
    ctx.fillText(name, W / 2, resting ? 38 : H / 2);
    if (resting) {
      ctx.fillStyle = "rgba(190, 204, 236, 0.75)";
      ctx.font = `400 28px ${font}`;
      ctx.fillText("쉬는 중", W / 2, 84);
    }
    texture.needsUpdate = true;
  }, [canvas, texture, name, resting]);

  useEffect(
    () => () => {
      texture.dispose();
      material.dispose();
    },
    [texture, material],
  );

  useFrame((_, rawDt) => {
    const s = sprite.current;
    const g = target.current;
    if (!s || !g) return;
    const dt = Math.min(rawDt, 0.05);
    s.position.copy(g.position);
    s.position.y += 1.9;
    const d = g.position.distanceTo(runtime.pos);
    const want = d < SHOW_NEAR ? 1 : d > SHOW_FAR ? 0 : 1 - (d - SHOW_NEAR) / (SHOW_FAR - SHOW_NEAR);
    opacity.current += (want - opacity.current) * (1 - Math.exp(-3 * dt));
    material.opacity = opacity.current * 0.85;
    s.visible = name !== "" && opacity.current > 0.01;
  });

  return <sprite ref={sprite} material={material} scale={[3.2, 0.7, 1]} visible={false} renderOrder={10} />;
}
