import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Quaternion, Vector3, type Group } from "three";
import { WORLD, terrainHeight } from "../../../shared/world.ts";
import { audio } from "../audio/AudioEngine.ts";
import { addGrowth } from "../game/growth.ts";
import { readInput } from "../game/input.ts";
import { clamp, lerpAngle, playerUniform, runtime } from "../game/runtime.ts";
import { getState, useGame } from "../game/store.ts";
import { network } from "../net/network.ts";
import { CAVE, caveInsideness, caveResolve, caveSolid } from "./cave.ts";
import { Jellyfish } from "./Jellyfish.tsx";
import { Trail } from "./Trail.tsx";
import { createMotion } from "./jelly.ts";

const CAM_DISTANCE = 7.5;
const SEND_INTERVAL = 0.05; // 20Hz

const _wish = new Vector3();
const _target = new Vector3();
const _desired = new Vector3();
const _look = new Vector3();
const _local = new Vector3();
const _q = new Quaternion();

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** 내 해파리: 입력 → 관성 있는 유영 → 3인칭 추적 카메라 → 서버 전송 */
export function PlayerRig() {
  const group = useRef<Group>(null);
  const motion = useMemo(createMotion, []);
  const variant = useGame((s) => s.variant);
  const { camera, gl } = useThree();

  const cam = useRef({
    yaw: 0,
    pitch: 0.26,
    lastDrag: -100,
    look: new Vector3(),
    ready: false,
  });
  const sendTimer = useRef(0);
  const lastBeat = useRef(0);
  const lastEnclosure = useRef(0);

  // 마우스 드래그로 시점을 둘러볼 수 있다 (선택 사항 — 키보드만으로도 충분하다).
  useEffect(() => {
    const el = gl.domElement;
    let dragging = false;
    let lx = 0;
    let ly = 0;
    const onDown = (e: PointerEvent) => {
      const s = getState();
      if (s.phase !== "playing" || s.paused) return;
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const c = cam.current;
      c.yaw -= (e.clientX - lx) * 0.005;
      c.pitch = clamp(c.pitch + (e.clientY - ly) * 0.004, -0.45, 1.1);
      c.lastDrag = performance.now() / 1000;
      lx = e.clientX;
      ly = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [gl]);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = clock.elapsedTime;
    const s = getState();
    const playing = s.phase === "playing";
    const c = cam.current;
    const { pos, vel } = runtime;

    // 교감과 인사 — 곁에 누가 머물면 은은히 밝아지고, 인사하면 빛이 퍼진다
    runtime.bond = runtime.bondAccum;
    runtime.bondAccum = 0;
    motion.boost += (runtime.bond - motion.boost) * damp(2, dt);
    if (runtime.flash) {
      runtime.flash = false;
      motion.flash = 1;
    }
    runtime.following = runtime.followAccum > 0;
    runtime.followAccum = 0;
    // 누군가 곁에 머무는 동안에는 플랑크톤이 없어도 천천히 자란다
    if (playing && runtime.bond > 0.05) addGrowth(0.0009 * runtime.bond * dt);
    motion.grow += (runtime.growth - motion.grow) * damp(1.5, dt);

    // ---------------- 입력 ----------------
    const input = playing && !s.paused ? readInput() : { forward: 0, strafe: 0, vertical: 0 };
    const sinY = Math.sin(c.yaw);
    const cosY = Math.cos(c.yaw);
    // 카메라 기준 전방 f = (-sin, 0, -cos), 우측 r = (cos, 0, -sin)
    _wish.set(
      -sinY * input.forward + cosY * input.strafe,
      input.vertical,
      -cosY * input.forward - sinY * input.strafe,
    );
    const inputMag = Math.min(1, _wish.length());
    if (inputMag > 1e-3) _wish.normalize();

    // ---------------- 맥동과 추진 ----------------
    const prevPulse = motion.pulse;
    motion.pulse += dt * (1.4 + 2.2 * inputMag);
    runtime.pulse = motion.pulse;
    // 우산을 오므리는 순간에 조금 더 힘차게 나아간다.
    const surge = 0.78 + 0.34 * Math.max(0, Math.sin(motion.pulse));
    _target.copy(_wish).multiplyScalar(WORLD.maxSpeed * inputMag * surge);
    vel.lerp(_target, damp(inputMag > 0 ? 1.5 : 0.65, dt));

    if (inputMag > 0.1) {
      const beat = Math.floor((motion.pulse - Math.PI * 0.5) / (Math.PI * 2));
      const prevBeat = Math.floor((prevPulse - Math.PI * 0.5) / (Math.PI * 2));
      if (beat !== prevBeat && beat !== lastBeat.current) {
        lastBeat.current = beat;
        audio.swish(0.5 + 0.5 * inputMag);
      }
    }

    // ---------------- 부드러운 경계 (해류가 안쪽으로 밀어준다) ----------------
    const r = Math.hypot(pos.x, pos.z);
    const edge = WORLD.radius - 12;
    if (r > edge) {
      const k = ((r - edge) / 12) ** 2 * 9 * dt;
      vel.x -= (pos.x / r) * k;
      vel.z -= (pos.z / r) * k;
    }
    const floor = terrainHeight(pos.x, pos.z) + WORLD.floorClearance;
    if (pos.y < floor + 2.5) vel.y += ((floor + 2.5 - pos.y) / 2.5) ** 2 * 9 * dt;
    if (pos.y > WORLD.ceiling - 4) vel.y -= ((pos.y - (WORLD.ceiling - 4)) / 4) ** 2 * 9 * dt;

    if (vel.length() > WORLD.maxSpeed) vel.setLength(WORLD.maxSpeed);
    pos.addScaledVector(vel, dt);

    // 마지막 안전장치
    const r2 = Math.hypot(pos.x, pos.z);
    if (r2 > WORLD.radius + 6) {
      const k = (WORLD.radius + 6) / r2;
      pos.x *= k;
      pos.z *= k;
    }
    pos.y = clamp(pos.y, terrainHeight(pos.x, pos.z) + WORLD.floorClearance, WORLD.ceiling);

    // 동굴 바위는 통과하지 못한다 (구멍으로는 드나든다)
    const nearCave = Math.hypot(pos.x - CAVE.x, pos.z - CAVE.z) < CAVE.radius + 14;
    if (nearCave && caveResolve(pos, 0.9)) {
      pos.y = Math.max(pos.y, terrainHeight(pos.x, pos.z) + WORLD.floorClearance);
      vel.multiplyScalar(1 - damp(4, dt)); // 벽에 닿으면 부드럽게 멈춘다
    }
    // 동굴 안에서는 소리가 먹먹해진다
    const enclosure = nearCave ? caveInsideness(pos.x, pos.y, pos.z) : 0;
    if (Math.abs(enclosure - lastEnclosure.current) > 0.02 || (enclosure === 0) !== (lastEnclosure.current === 0)) {
      lastEnclosure.current = enclosure;
      audio.setEnclosure(enclosure);
    }

    playerUniform.value.copy(pos);

    // ---------------- 자세 ----------------
    const hSpeed = Math.hypot(vel.x, vel.z);
    const speed = clamp(vel.length() / WORLD.maxSpeed, 0, 1);
    if (hSpeed > 0.25) {
      runtime.yaw = lerpAngle(runtime.yaw, Math.atan2(vel.x, vel.z), damp(3.5, dt));
    }
    runtime.lean += (clamp(hSpeed / WORLD.maxSpeed, 0, 1) * 0.95 - runtime.lean) * damp(2.8, dt);
    runtime.speed = speed;
    motion.speed += (speed - motion.speed) * damp(4, dt);

    const g = group.current;
    if (g) {
      // 가만히 있어도 물결에 실려 천천히 떠 있다.
      g.position.set(pos.x + Math.sin(t * 0.43) * 0.1, pos.y + Math.sin(t * 0.8) * 0.16, pos.z + Math.cos(t * 0.37) * 0.1);
      g.rotation.set(runtime.lean + Math.sin(t * 0.6) * 0.04, runtime.yaw, Math.sin(t * 0.5) * 0.05, "YXZ");

      _q.copy(g.quaternion).invert();
      _local.copy(vel).divideScalar(WORLD.maxSpeed).applyQuaternion(_q);
      motion.velLocal.lerp(_local, damp(3, dt));
    }

    // ---------------- 카메라 ----------------
    if (!playing) {
      c.yaw += dt * 0.05; // 메뉴에서는 천천히 주위를 돈다
    } else if (hSpeed > 0.5 && performance.now() / 1000 - c.lastDrag > 1.5) {
      // 이동 방향 뒤쪽으로 서서히 돌아간다. 후진 중에는 돌지 않는다.
      const align = (vel.x * -sinY + vel.z * -cosY) / hSpeed;
      if (align > -0.6) {
        const targetYaw = Math.atan2(vel.x, vel.z) + Math.PI;
        const rate = 1.3 * Math.min(1, hSpeed / WORLD.maxSpeed) * (0.3 + 0.7 * Math.max(0, align));
        c.yaw = lerpAngle(c.yaw, targetYaw, damp(rate, dt));
      }
    }

    const pitch = clamp(c.pitch - clamp(vel.y / WORLD.maxSpeed, -1, 1) * 0.28, -0.6, 1.2);
    const cp = Math.cos(pitch);
    _desired.set(
      pos.x + Math.sin(c.yaw) * cp * CAM_DISTANCE,
      pos.y + Math.sin(pitch) * CAM_DISTANCE + 0.6,
      pos.z + Math.cos(c.yaw) * cp * CAM_DISTANCE,
    );
    // 해저 지형을 뚫지 않게
    _desired.y = Math.max(_desired.y, terrainHeight(_desired.x, _desired.z) + 1.0);
    _look.set(pos.x, pos.y + 0.5, pos.z);
    // 해파리와 카메라 사이에 동굴 벽이 끼지 않게, 막히는 지점 앞까지만 물러난다
    if (nearCave) {
      const STEPS = 12;
      let safe = 1;
      for (let i = 1; i <= STEPS; i++) {
        const k = i / STEPS;
        if (
          caveSolid(
            _look.x + (_desired.x - _look.x) * k,
            _look.y + (_desired.y - _look.y) * k,
            _look.z + (_desired.z - _look.z) * k,
            0.5,
          )
        ) {
          safe = Math.max(0.12, (i - 1) / STEPS);
          break;
        }
      }
      if (safe < 1) _desired.lerpVectors(_look, _desired, safe);
    }

    if (!c.ready || camera.position.distanceToSquared(_desired) > 60 * 60) {
      // 첫 프레임이거나 스폰 위치로 순간 이동한 경우: 보간 없이 바로 자리를 잡는다.
      c.ready = true;
      camera.position.copy(_desired);
      c.look.copy(_look);
    } else {
      camera.position.lerp(_desired, damp(4.5, dt));
      c.look.lerp(_look, damp(7, dt));
    }
    camera.position.y = Math.max(camera.position.y, terrainHeight(camera.position.x, camera.position.z) + 0.8);
    camera.lookAt(c.look);
    audio.updateListener(camera);

    // ---------------- 네트워크 ----------------
    sendTimer.current += dt;
    if (playing && sendTimer.current >= SEND_INTERVAL) {
      // 남은 시간을 이어 가서 프레임 수와 상관없이 고르게 초당 20번 보낸다
      sendTimer.current = Math.min(sendTimer.current - SEND_INTERVAL, SEND_INTERVAL);
      network.sendMove({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        yaw: runtime.yaw,
        lean: runtime.lean,
        speed,
        growth: runtime.growth,
        t: performance.now(),
      });
    }
  });

  return (
    <>
      <group ref={group}>
        <Jellyfish variant={variant} motion={motion} light />
      </group>
      <Trail target={group} motion={motion} variant={variant} />
    </>
  );
}
