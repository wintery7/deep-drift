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
 * 이름 아래에는 상태가 한 줄 붙는다 (놀자고 청함 · 술래 · 쉬는 중).
 * far면 멀리서도 보인다 (함께 술래잡기 중인 상대).
 * 해파리가 기울어도 흔들리지 않도록 회전을 따르지 않고 위치만 따라간다.
 */
export function NameLabel({ target, name, sub, far = false }: { target: RefObject<Group | null>; name: string; sub: string; far?: boolean }) {
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
    ctx.fillText(name, W / 2, sub ? 38 : H / 2);
    if (sub) {
      ctx.fillStyle = sub === "술래" ? "rgba(255, 196, 140, 0.95)" : "rgba(190, 204, 236, 0.8)";
      ctx.font = `400 28px ${font}`;
      ctx.fillText(sub, W / 2, 84);
    }
    texture.needsUpdate = true;
  }, [canvas, texture, name, sub]);

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
    const near = far ? 40 : SHOW_NEAR;
    const fade = far ? 60 : SHOW_FAR;
    const want = d < near ? 1 : d > fade ? 0 : 1 - (d - near) / (fade - near);
    opacity.current += (want - opacity.current) * (1 - Math.exp(-3 * dt));
    material.opacity = opacity.current * 0.85;
    s.visible = name !== "" && opacity.current > 0.01;
  });

  return <sprite ref={sprite} material={material} scale={[3.2, 0.7, 1]} visible={false} renderOrder={10} />;
}
