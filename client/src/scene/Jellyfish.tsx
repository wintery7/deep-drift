import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, DoubleSide, type Mesh, type MeshBasicMaterial, type PointLight } from "three";
import { VARIANTS } from "../game/runtime.ts";
import { bellGeometry, createJellyMaterials, tentacleGeometry, type JellyMotion } from "./jelly.ts";

interface Props {
  variant: number;
  motion: JellyMotion;
  /** 주변을 은은하게 밝히는 빛 */
  light?: boolean;
}

const LIGHT_INTENSITY = 45;

/** 플레이어 해파리 한 마리. 위치·회전은 부모 group이 정하고, 여기서는 생김새와 맥동만 담당한다. */
export function Jellyfish({ variant, motion, light = false }: Props) {
  const mats = useMemo(createJellyMaterials, []);
  const core = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  const lamp = useRef<PointLight>(null);
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

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = clock.elapsedTime;
    // 인사의 빛은 천천히 사그라든다
    motion.flash = Math.max(0, motion.flash - dt * 0.7);
    const flash = motion.flash * motion.flash;

    for (const m of [mats.bell, mats.tentacle]) {
      const u = m.uniforms;
      u.uPulse.value = motion.pulse;
      u.uSpeed.value = motion.speed;
      u.uTime.value = t;
      u.uOpacity.value = motion.opacity;
      u.uFlash.value = flash;
      u.uBoost.value = motion.boost;
      u.uVelLocal.value.copy(motion.velLocal);
    }
    if (core.current) {
      const beat = Math.sin(motion.pulse) * 0.5 + 0.5;
      core.current.scale.setScalar(0.3 + beat * 0.05 + flash * 0.14 + motion.boost * 0.04);
      (core.current.material as MeshBasicMaterial).opacity = Math.min(1, 0.45 + beat * 0.3 + flash * 0.5) * motion.opacity;
    }
    if (ring.current) {
      // 인사할 때 퍼져 나가는 빛의 고리
      const visible = motion.flash > 0.01;
      ring.current.visible = visible;
      if (visible) {
        ring.current.scale.setScalar(1 + (1 - motion.flash) * 6);
        (ring.current.material as MeshBasicMaterial).opacity = flash * 0.5 * motion.opacity;
      }
    }
    if (lamp.current) {
      lamp.current.intensity = LIGHT_INTENSITY * (1 + motion.boost * 0.5 + flash * 1.4) * motion.opacity;
    }
  });

  return (
    <group scale={0.8}>
      <mesh ref={core} position={[0, 0.3, 0]} renderOrder={1}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color={look.glow} transparent opacity={0.6} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]} visible={false} renderOrder={4}>
        <ringGeometry args={[0.94, 1, 64]} />
        <meshBasicMaterial color={look.glow} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} side={DoubleSide} />
      </mesh>
      <mesh geometry={tentacleGeometry} material={mats.tentacle} frustumCulled={false} renderOrder={2} />
      <mesh geometry={bellGeometry} material={mats.bell} renderOrder={3} />
      {light && <pointLight ref={lamp} color={look.color} intensity={LIGHT_INTENSITY} distance={18} decay={2} />}
    </group>
  );
}
