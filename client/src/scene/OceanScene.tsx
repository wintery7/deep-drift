import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Environment } from "./Environment.tsx";
import { Life } from "./Life.tsx";
import { PlayerRig } from "./PlayerRig.tsx";
import { RemotePlayers } from "./RemotePlayers.tsx";

export function OceanScene() {
  return (
    <Canvas
      flat
      dpr={[1, 1.75]}
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
      <PlayerRig />
      <RemotePlayers />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.42} luminanceSmoothing={0.35} radius={0.75} />
        <Vignette eskil={false} offset={0.22} darkness={0.62} />
      </EffectComposer>
    </Canvas>
  );
}
