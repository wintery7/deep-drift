import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { AdaptiveQuality, QUALITY_DPR, QUALITY_MSAA, initialQuality } from "./AdaptiveQuality.tsx";
import { Cave } from "./Cave.tsx";
import { Environment } from "./Environment.tsx";
import { Life } from "./Life.tsx";
import { Plankton } from "./Plankton.tsx";
import { SingingCoral } from "./SingingCoral.tsx";
import { Sleeper } from "./Sleeper.tsx";
import { PlayerRig } from "./PlayerRig.tsx";
import { RemotePlayers } from "./RemotePlayers.tsx";
import { TagDirector } from "./TagDirector.tsx";

/** ?quality=0|1|2 로 화질 단계를 고정한다 (자동 조절을 끈다) — 성능 확인용 */
function fixedQuality(): number | null {
  try {
    const v = new URLSearchParams(location.search).get("quality");
    if (v === null) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n < QUALITY_DPR.length ? n : null;
  } catch {
    return null;
  }
}

export function OceanScene() {
  const [fixed] = useState(fixedQuality);
  // 화면 크기에 맞춰 시작 단계를 고르고, 자동 조절은 그 단계 위로는 올리지 않는다
  const [quality, setQuality] = useState(() => fixed ?? initialQuality());
  const dpr = Math.min(QUALITY_DPR[quality], window.devicePixelRatio || 1);

  useEffect(() => {
    document.documentElement.dataset.quality = String(quality);
  }, [quality]);

  return (
    <Canvas
      flat
      dpr={Math.max(1, dpr)}
      gl={{
        antialias: false,
        powerPreference: "high-performance",
        // 개발 중 ?capture 로 열면 캔버스를 이미지로 떠서 확인할 수 있다.
        preserveDrawingBuffer: import.meta.env.DEV && location.search.includes("capture"),
      }}
      camera={{ fov: 58, near: 0.1, far: 700, position: [0, -2, 8] }}
    >
      <Environment />
      <Life />
      <Cave />
      <Plankton />
      <Sleeper />
      <SingingCoral />
      <PlayerRig />
      <RemotePlayers />
      <TagDirector />
      <EffectComposer multisampling={QUALITY_MSAA[quality]}>
        <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.42} luminanceSmoothing={0.35} radius={0.75} />
        <Vignette eskil={false} offset={0.22} darkness={0.62} />
      </EffectComposer>
      {fixed === null && <AdaptiveQuality level={quality} onChange={setQuality} />}
    </Canvas>
  );
}
