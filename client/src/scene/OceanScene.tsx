import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { AdaptiveQuality, QUALITY_DPR, QUALITY_MSAA } from "./AdaptiveQuality.tsx";
import { Cave } from "./Cave.tsx";
import { Environment } from "./Environment.tsx";
import { Life } from "./Life.tsx";
import { Plankton } from "./Plankton.tsx";
import { SingingCoral } from "./SingingCoral.tsx";
import { Sleeper } from "./Sleeper.tsx";
import { PlayerRig } from "./PlayerRig.tsx";
import { RemotePlayers } from "./RemotePlayers.tsx";

export function OceanScene() {
  const [quality, setQuality] = useState(2);
  const dpr = Math.min(QUALITY_DPR[quality], window.devicePixelRatio || 1);

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
      <EffectComposer multisampling={QUALITY_MSAA[quality]}>
        <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.42} luminanceSmoothing={0.35} radius={0.75} />
        <Vignette eskil={false} offset={0.22} darkness={0.62} />
      </EffectComposer>
      <AdaptiveQuality level={quality} onChange={setQuality} />
    </Canvas>
  );
}
