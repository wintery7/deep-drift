import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Group,
} from "three";
import { WORLD } from "../../../shared/world.ts";
import { audio } from "../audio/AudioEngine.ts";
import { clamp, lerpAngle, runtime } from "../game/runtime.ts";
import { network, ocean, type Snapshot } from "../net/network.ts";
import { Jellyfish } from "./Jellyfish.tsx";
import { Trail } from "./Trail.tsx";
import { NameLabel } from "./NameLabel.tsx";
import { createMotion } from "./jelly.ts";

/** 수신한 상태를 이만큼 과거 시점으로 재생해 지연·끊김을 보간으로 흡수한다. */
const INTERP_DELAY_MS = 120;
/** 이 거리 안에서 함께 머물면 교감이 깊어진다 */
const BOND_NEAR = 7;
const BOND_FAR = 11;
/** 이 거리 안에서 뒤를 따라 유영하면 행렬이 된다 */
const FOLLOW_RANGE = 12;
const THREAD_POINTS = 18;

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

/** 나란히 머무는 두 해파리 사이에 이어지는 빛의 실 */
function createThread() {
  const geometry = new BufferGeometry();
  const t = new Float32Array(THREAD_POINTS);
  for (let i = 0; i < THREAD_POINTS; i++) t[i] = (i + 0.5) / THREAD_POINTS;
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(THREAD_POINTS * 3), 3));
  geometry.setAttribute("aT", new Float32BufferAttribute(t, 1));
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uColor: { value: new Color("#e2dcff") },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aT;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float dist = max(-mv.z, 0.1);
        // 가운데가 가장 밝고, 빛이 실을 따라 천천히 흐른다
        vA = sin(aT * 3.14159) * (0.55 + 0.45 * sin(aT * 14.0 - uTime * 2.2));
        gl_PointSize = clamp(34.0 * uPixelRatio / dist, 1.0, 10.0 * uPixelRatio);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vA * uOpacity * 0.7;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
  return { geometry, material };
}

function RemoteJellyfish({ id }: { id: string }) {
  const group = useRef<Group>(null);
  const motion = useMemo(() => ({ ...createMotion(), opacity: 0 }), []);
  const thread = useMemo(createThread, []);
  const local = useRef({
    ready: false,
    yaw: 0,
    near: false,
    lastChime: -100,
    bob: Math.random() * 10,
    bond: 0,
    glowSeen: -1,
    rest: 0,
  });
  const [sub, setSub] = useState("");
  const [far, setFar] = useState(false);
  const remote = network.remotes.get(id);
  const variant = remote?.variant ?? 0;

  useEffect(
    () => () => {
      thread.geometry.dispose();
      thread.material.dispose();
    },
    [thread],
  );

  useFrame(({ clock, gl }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const r = network.remotes.get(id);
    const g = group.current;
    if (!r || !g) return;
    if (!sample(r.buffer, performance.now() - (r.offset ?? 0) - INTERP_DELAY_MS, _sample)) return;

    const st = local.current;
    const t = clock.elapsedTime + st.bob;
    _pos.set(_sample.x, _sample.y, _sample.z);
    // 쉬는 중이면 조금 가라앉아 졸듯이 천천히 맥동한다
    // 이름표 아래 한 줄: 나에게 놀자고 청함 > 술래 > 쉬는 중
    const invitingMe = !!ocean.myId && r.inviteTo === ocean.myId && !ocean.tagWith;
    const nextSub = invitingMe ? "같이 놀자고 해요 · E 두 번" : r.tagWith && r.it ? "술래" : r.resting ? "쉬는 중" : "";
    if (nextSub !== sub) setSub(nextSub);
    // 함께 술래잡기 중인 상대의 이름은 멀리서도 보인다
    const nextFar = !!ocean.tagWith && ocean.tagWith === id;
    if (nextFar !== far) setFar(nextFar);
    motion.it += ((r.tagWith && r.it ? 1 : 0) - motion.it) * (1 - Math.exp(-4 * dt));
    st.rest += ((r.resting ? 1 : 0) - st.rest) * (1 - Math.exp(-0.8 * dt));
    _pos.y -= st.rest * 1.2;

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
    motion.pulse += dt * (1.4 + 2.2 * motion.speed) * (1 - 0.55 * st.rest);
    // 새로 들어온 해파리는 서서히 나타나고, 연결이 끊긴 해파리는 흐려진다.
    const targetOpacity = r.connected ? 1 - 0.2 * st.rest : 0.25;
    motion.opacity += (targetOpacity - motion.opacity) * (1 - Math.exp(-2 * dt));
    motion.grow += (r.growth - motion.grow) * (1 - Math.exp(-1.5 * dt));

    // ---------------- 빛으로 건네는 인사 ----------------
    if (st.glowSeen === -1) {
      st.glowSeen = r.glow;
    } else if (r.glow !== st.glowSeen) {
      st.glowSeen = r.glow;
      motion.flash = 1;
      audio.chime(g.position);
    }

    // ---------------- 교감: 곁에 머물수록 깊어지고, 멀어지면 조용히 옅어진다 ----------------
    const d = g.position.distanceTo(runtime.pos);
    // 뒤를 따라 유영하는가: 상대의 뒤쪽에서, 같은 방향으로 함께 움직일 때
    const fx = Math.sin(_sample.yaw);
    const fz = Math.cos(_sample.yaw);
    const behind = (runtime.pos.x - g.position.x) * fx + (runtime.pos.z - g.position.z) * fz;
    const mySpeed = Math.hypot(runtime.vel.x, runtime.vel.z);
    const following =
      r.connected &&
      d < FOLLOW_RANGE &&
      behind < -1 &&
      _sample.speed > 0.12 &&
      mySpeed > 0.8 &&
      (runtime.vel.x * fx + runtime.vel.z * fz) / mySpeed > 0.6;
    if (following) runtime.followAccum = 1;
    if ((d < BOND_NEAR || following) && r.connected) st.bond = Math.min(1, st.bond + dt / (following ? 2 : 4));
    else if ((d > BOND_FAR && !following) || !r.connected) st.bond = Math.max(0, st.bond - dt / 2.5);
    const bond = st.bond * st.bond * (3 - 2 * st.bond);
    motion.boost = bond;
    runtime.bondAccum = Math.max(runtime.bondAccum, bond);
    if (bond > 0) {
      // 내 맥동에 상대의 맥동이 서서히 맞춰진다
      const diff = Math.atan2(Math.sin(runtime.pulse - motion.pulse), Math.cos(runtime.pulse - motion.pulse));
      motion.pulse += diff * (1 - Math.exp(-1.6 * bond * dt));
    }

    const tu = thread.material.uniforms;
    const threadOpacity = bond * clamp((FOLLOW_RANGE + 1 - d) / 4, 0, 1) * motion.opacity;
    tu.uOpacity.value = threadOpacity;
    if (threadOpacity > 0.005) {
      tu.uTime.value = clock.elapsedTime;
      tu.uPixelRatio.value = gl.getPixelRatio();
      const attr = thread.geometry.attributes.position;
      const a = runtime.pos;
      const b = g.position;
      for (let i = 0; i < THREAD_POINTS; i++) {
        const k = (i + 0.5) / THREAD_POINTS;
        const sag = Math.sin(k * Math.PI);
        const w = clock.elapsedTime * 0.9 + k * 6 + st.bob;
        attr.setXYZ(
          i,
          a.x + (b.x - a.x) * k + Math.sin(w) * 0.22 * sag,
          a.y + (b.y - a.y) * k + 0.25 + Math.cos(w * 1.3) * 0.22 * sag - sag * 0.35,
          a.z + (b.z - a.z) * k + Math.cos(w * 0.8) * 0.22 * sag,
        );
      }
      attr.needsUpdate = true;
    }

    // 가까이 다가오면 그쪽에서 잔잔한 울림이 한 번 들린다.
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
    <>
      <group ref={group} position={[0, -1000, 0]}>
        <Jellyfish variant={variant} motion={motion} />
      </group>
      <Trail target={group} motion={motion} variant={variant} />
      <NameLabel target={group} name={remote?.name ?? ""} sub={sub} far={far} />
      <points geometry={thread.geometry} material={thread.material} frustumCulled={false} renderOrder={6} />
    </>
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
