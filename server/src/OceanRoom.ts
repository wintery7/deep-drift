import { Client, Room } from "colyseus";
import { Jelly, OceanState } from "./OceanState.ts";
import { MSG_GLOW, MSG_MOVE, MSG_REST, WORLD, isValidSea, terrainHeight } from "../../shared/world.ts";
import { NAME_FIRST, NAME_SECOND, composeName, isValidNamePart, randomNameParts } from "../../shared/names.ts";

/** 끊긴 사용자를 방에 남겨 두는 시간(초). 새로고침·순간 단절은 이 안에 복귀한다. */
const RECONNECT_WINDOW_S = 12;
/** 초당 허용 메시지 수 (토큰 버킷) */
const MSG_RATE = 40;

interface ClientMeta {
  lastMoveAt: number;
  lastGlowAt: number;
  tokens: number;
  lastRefill: number;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class OceanRoom extends Room<OceanState> {
  maxClients = WORLD.maxPlayers;
  state = new OceanState();
  private meta = new Map<string, ClientMeta>();

  onCreate(options: unknown) {
    // 바다 이름(초대 코드)이 올바르지 않으면 방을 만들지 않는다.
    if (!isValidSea((options as { sea?: unknown } | null)?.sea)) throw new Error("invalid sea");

    this.setPatchRate(50); // 20Hz 상태 전파

    this.onMessage(MSG_MOVE, (client, msg: unknown) => this.handleMove(client, msg));
    this.onMessage(MSG_GLOW, (client) => {
      const jelly = this.state.players.get(client.sessionId);
      const meta = this.meta.get(client.sessionId);
      if (!jelly || !meta) return;
      const now = Date.now();
      if (now - meta.lastGlowAt < 1000) return; // 인사는 1초에 한 번까지
      meta.lastGlowAt = now;
      jelly.glow = (jelly.glow + 1) % 256;
    });
    // 정의되지 않은 메시지는 조용히 무시한다.
    this.onMessage(MSG_REST, (client, msg: unknown) => {
      const jelly = this.state.players.get(client.sessionId);
      if (!jelly || typeof msg !== "boolean") return;
      jelly.resting = msg;
    });
    this.onMessage("*", () => {});
  }

  onJoin(client: Client, options: unknown) {
    const jelly = new Jelly();

    const requested = (options as { variant?: unknown } | null)?.variant;
    jelly.variant =
      isNum(requested) && Number.isInteger(requested) && requested >= 0 && requested < WORLD.variants
        ? requested
        : Math.floor(Math.random() * WORLD.variants);

    // 이름은 단어 번호로만 받는다. 올바르지 않으면 무작위로 정한다.
    const o = options as { nameA?: unknown; nameB?: unknown } | null;
    const [ra, rb] = randomNameParts();
    const na = o?.nameA;
    const nb = o?.nameB;
    jelly.name = composeName(isValidNamePart(na, NAME_FIRST) ? na : ra, isValidNamePart(nb, NAME_SECOND) ? nb : rb);

    // 중심부 근처에 서로 겹치지 않게 흩어 놓는다.
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 5 + Math.random() * 11;
      x = Math.cos(angle) * dist;
      z = Math.sin(angle) * dist;
      let crowded = false;
      this.state.players.forEach((p) => {
        if (Math.hypot(p.x - x, p.z - z) < 5) crowded = true;
      });
      if (!crowded) break;
    }
    jelly.x = x;
    jelly.z = z;
    jelly.y = -6 + Math.random() * 5;
    // 중심을 바라보며 등장한다 (진행 방향 = (sin yaw, cos yaw))
    jelly.yaw = Math.atan2(-x, -z);

    this.state.players.set(client.sessionId, jelly);
    const now = Date.now();
    this.meta.set(client.sessionId, { lastMoveAt: now, lastGlowAt: 0, tokens: MSG_RATE, lastRefill: now });
  }

  async onLeave(client: Client, consented: boolean) {
    const jelly = this.state.players.get(client.sessionId);
    if (!jelly) return;

    if (!consented) {
      jelly.connected = false;
      jelly.speed = 0;
      try {
        await this.allowReconnection(client, RECONNECT_WINDOW_S);
        jelly.connected = true;
        const m = this.meta.get(client.sessionId);
        if (m) m.lastMoveAt = Date.now();
        return;
      } catch {
        // 시간 안에 돌아오지 않음 → 아래에서 정리
      }
    }

    this.state.players.delete(client.sessionId);
    this.meta.delete(client.sessionId);
  }

  private handleMove(client: Client, msg: unknown) {
    const jelly = this.state.players.get(client.sessionId);
    const meta = this.meta.get(client.sessionId);
    if (!jelly || !meta) return;

    // --- 빈도 제한 ---
    const now = Date.now();
    meta.tokens = Math.min(MSG_RATE, meta.tokens + ((now - meta.lastRefill) / 1000) * MSG_RATE);
    meta.lastRefill = now;
    if (meta.tokens < 1) return;
    meta.tokens -= 1;

    // --- 형식 검증 ---
    if (typeof msg !== "object" || msg === null) return;
    const m = msg as Record<string, unknown>;
    if (!isNum(m.x) || !isNum(m.y) || !isNum(m.z) || !isNum(m.yaw) || !isNum(m.lean) || !isNum(m.speed)) return;

    // --- 이동 속도 검증: 지난 메시지 이후 갈 수 있는 거리까지만 인정 ---
    const dt = clamp((now - meta.lastMoveAt) / 1000, 0, 0.5);
    meta.lastMoveAt = now;
    const maxDist = WORLD.maxSpeed * 1.5 * dt + 0.4;

    let dx = m.x - jelly.x;
    let dy = m.y - jelly.y;
    let dz = m.z - jelly.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > maxDist) {
      const k = maxDist / dist;
      dx *= k;
      dy *= k;
      dz *= k;
    }
    let x = jelly.x + dx;
    let y = jelly.y + dy;
    let z = jelly.z + dz;

    // --- 월드 범위 검증 ---
    const r = Math.hypot(x, z);
    if (r > WORLD.hardRadius) {
      const k = WORLD.hardRadius / r;
      x *= k;
      z *= k;
    }
    y = clamp(y, terrainHeight(x, z) + WORLD.floorClearance * 0.5, WORLD.ceiling + 1);

    jelly.x = x;
    jelly.y = y;
    jelly.z = z;
    jelly.yaw = Math.atan2(Math.sin(m.yaw), Math.cos(m.yaw));
    jelly.lean = clamp(m.lean, -1.3, 1.3);
    jelly.speed = clamp(m.speed, 0, 1);
  }
}
