import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, type Mesh, type MeshBasicMaterial } from "three";
import { VARIANTS } from "../game/runtime.ts";
import { bellGeometry, createJellyMaterials, tentacleGeometry, type JellyMotion } from "./jelly.ts";

interface Props {
  variant: number;
  motion: JellyMotion;
  /** 주변을 은은하게 밝히는 빛 */
  light?: boolean;
}

/** 플레이어 해파리 한 마리. 위치·회전은 부모 group이 정하고, 여기서는 생김새와 맥동만 담당한다. */
export function Jellyfish({ variant, motion, light = false }: Props) {
  const mats = useMemo(createJellyMaterials, []);
  const core = useRef<Mesh>(null);
  const look = VARIANTS[variant % VARIANTS.length];

  useEffect(() => {
    for (const m of [mats.bell, mats.tentacle]) {
      m.uniforms.uColor.value.set(look.color);
      m.uniforms.uGlow.value.set(look.glow);
    }
  }, [mats, look]);

  useEffect(
    () => () => {
      mats.bell.dispose();
      mats.tentacle.dispose();
    },
    [mats],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    for (const m of [mats.bell, mats.tentacle]) {
      const u = m.uniforms;
      u.uPulse.value = motion.pulse;
      u.uSpeed.value = motion.speed;
      u.uTime.value = t;
      u.uOpacity.value = motion.opacity;
      u.uVelLocal.value.copy(motion.velLocal);
    }
    if (core.current) {
      const beat = Math.sin(motion.pulse) * 0.5 + 0.5;
      core.current.scale.setScalar(0.3 + beat * 0.05);
      (core.current.material as MeshBasicMaterial).opacity = (0.45 + beat * 0.3) * motion.opacity;
    }
  });

  return (
    <group scale={0.8}>
      <mesh ref={core} position={[0, 0.3, 0]} renderOrder={1}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color={look.glow} transparent opacity={0.6} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh geometry={tentacleGeometry} material={mats.tentacle} frustumCulled={false} renderOrder={2} />
      <mesh geometry={bellGeometry} material={mats.bell} renderOrder={3} />
      {light && <pointLight color={look.color} intensity={45} distance={18} decay={2} />}
    </group>
  );
}
