import { useMemo, useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import { Quaternion, Vector3, type Group } from "three";
import { WORLD } from "../../../shared/world.ts";
import { audio } from "../audio/AudioEngine.ts";
import { lerpAngle, runtime } from "../game/runtime.ts";
import { network, type Snapshot } from "../net/network.ts";
import { Jellyfish } from "./Jellyfish.tsx";
import { createMotion } from "./jelly.ts";

/** 수신한 상태를 이만큼 과거 시점으로 재생해 지연·끊김을 보간으로 흡수한다. */
const INTERP_DELAY_MS = 120;

const _sample: Snapshot = { t: 0, x: 0, y: 0, z: 0, yaw: 0, lean: 0, speed: 0 };
const _pos = new Vector3();
const _vel = new Vector3();
const _q = new Quaternion();

function sample(buffer: Snapshot[], time: number, out: Snapshot): boolean {
  const n = buffer.length;
  if (n === 0) return false;
  if (time <= buffer[0].t) {
    Object.assign(out, buffer[0]);
    return true;
  }
  if (time >= buffer[n - 1].t) {
    Object.assign(out, buffer[n - 1]);
    return true;
  }
  for (let i = n - 2; i >= 0; i--) {
    const a = buffer[i];
    if (a.t > time) continue;
    const b = buffer[i + 1];
    const k = (time - a.t) / Math.max(1, b.t - a.t);
    out.x = a.x + (b.x - a.x) * k;
    out.y = a.y + (b.y - a.y) * k;
    out.z = a.z + (b.z - a.z) * k;
    out.yaw = lerpAngle(a.yaw, b.yaw, k);
    out.lean = a.lean + (b.lean - a.lean) * k;
    out.speed = a.speed + (b.speed - a.speed) * k;
    return true;
  }
  return false;
}

function RemoteJellyfish({ id }: { id: string }) {
  const group = useRef<Group>(null);
  const motion = useMemo(() => ({ ...createMotion(), opacity: 0 }), []);
  const local = useRef({ ready: false, yaw: 0, near: false, lastChime: -100, bob: Math.random() * 10 });
  const remote = network.remotes.get(id);
  const variant = remote?.variant ?? 0;

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const r = network.remotes.get(id);
    const g = group.current;
    if (!r || !g) return;
    if (!sample(r.buffer, performance.now() - INTERP_DELAY_MS, _sample)) return;

    const st = local.current;
    const t = clock.elapsedTime + st.bob;
    _pos.set(_sample.x, _sample.y, _sample.z);

    if (!st.ready) {
      st.ready = true;
      st.yaw = _sample.yaw;
      g.position.copy(_pos);
    }
    const before = _vel.copy(g.position);
    g.position.lerp(_pos, 1 - Math.exp(-14 * dt));
    // 화면에서 실제로 움직인 양으로 촉수가 끌리는 방향을 구한다.
    _vel.subVectors(g.position, before).divideScalar(Math.max(dt, 1e-3) * WORLD.maxSpeed);
    if (_vel.lengthSq() > 1) _vel.normalize();

    st.yaw = lerpAngle(st.yaw, _sample.yaw, 1 - Math.exp(-10 * dt));
    g.rotation.set(_sample.lean + Math.sin(t * 0.6) * 0.04, st.yaw, Math.sin(t * 0.5) * 0.05, "YXZ");

    _q.copy(g.quaternion).invert();
    motion.velLocal.lerp(_vel.applyQuaternion(_q), 1 - Math.exp(-3 * dt));
    motion.speed += (_sample.speed - motion.speed) * (1 - Math.exp(-4 * dt));
    motion.pulse += dt * (1.4 + 2.2 * motion.speed);
    // 새로 들어온 해파리는 서서히 나타나고, 연결이 끊긴 해파리는 흐려진다.
    const targetOpacity = r.connected ? 1 : 0.25;
    motion.opacity += (targetOpacity - motion.opacity) * (1 - Math.exp(-2 * dt));

    // 가까이 다가오면 그쪽에서 잔잔한 울림이 한 번 들린다.
    const d = g.position.distanceTo(runtime.pos);
    if (!st.near && d < 9) {
      st.near = true;
      if (clock.elapsedTime - st.lastChime > 20) {
        st.lastChime = clock.elapsedTime;
        audio.chime(g.position);
      }
    } else if (st.near && d > 14) {
      st.near = false;
    }
  });

  return (
    <group ref={group} position={[0, -1000, 0]}>
      <Jellyfish variant={variant} motion={motion} light />
    </group>
  );
}

export function RemotePlayers() {
  const ids = useSyncExternalStore(network.subscribe, network.getIds);
  return (
    <>
      {ids.map((id) => (
        <RemoteJellyfish key={id} id={id} />
      ))}
    </>
  );
}
