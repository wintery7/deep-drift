import { Client, Room } from "colyseus";
import { Jelly, OceanState } from "./OceanState.ts";
import {
  MSG_GLOW,
  MSG_MOVE,
  MSG_NOTE,
  MSG_REST,
  SLEEPER,
  SONG_PIPES,
  TAG,
  WAKE_SELF,
  WAKE_TOGETHER,
  WORLD,
  isValidSea,
  terrainHeight,
} from "../../shared/world.ts";
import { NAME_FIRST, NAME_SECOND, composeName, isValidNamePart, randomNameParts } from "../../shared/names.ts";

/** 끊긴 사용자를 방에 남겨 두는 시간(초). 새로고침·순간 단절은 이 안에 복귀한다. */
const RECONNECT_WINDOW_S = 12;
/** 초당 허용 메시지 수 (토큰 버킷) */
const MSG_RATE = 40;

interface ClientMeta {
  lastMoveAt: number;
  lastGlowAt: number;
  /** 잠든 빛 곁에서 마지막으로 인사한 시각 */
  sleeperGlowAt: number;
  noteTokens: number;
  noteRefill: number;
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

    // 잠든 빛은 몇 분에 한 번 스스로 잠시 눈을 뜬다 — 혼자 온 사람도 볼 수 있도록
    this.clock.setInterval(() => {
      if (this.state.players.size > 0) this.wakeSleeper(WAKE_SELF, SLEEPER.selfWakeSeconds);
    }, SLEEPER.selfWakeEverySeconds * 1000);

    // 술래잡기 판정 — 닿았는지, 끝났는지는 서버가 정해 두 사람 화면이 어긋나지 않게 한다
    this.clock.setInterval(() => this.tickTag(), 100);

    this.onMessage(MSG_MOVE, (client, msg: unknown) => this.handleMove(client, msg));
    this.onMessage(MSG_GLOW, (client) => {
      const jelly = this.state.players.get(client.sessionId);
      const meta = this.meta.get(client.sessionId);
      if (!jelly || !meta) return;
      const now = Date.now();
      if (now - meta.lastGlowAt < 250) return; // 너무 잦은 인사는 무시
      // 짧은 간격으로 두 번 인사하면 곁의 해파리에게 술래잡기를 청한다
      const double = now - meta.lastGlowAt < TAG.doubleGlowMs;
      meta.lastGlowAt = double ? 0 : now; // 세 번째 인사가 또 "두 번"으로 세어지지 않게
      if (double) this.tagInvite(client.sessionId, now);
      jelly.glow = (jelly.glow + 1) % 256;
      if (Math.hypot(jelly.x - SLEEPER.x, jelly.z - SLEEPER.z) < SLEEPER.reach) {
        meta.sleeperGlowAt = now;
        this.touchSleeper(now);
      }
    });
    // 노래하는 산호: 울린 관 번호를 다른 사람에게 전한다 (초당 8번까지)
    this.onMessage(MSG_NOTE, (client, msg: unknown) => {
      const meta = this.meta.get(client.sessionId);
      const i = (msg as { i?: unknown } | null)?.i;
      if (!meta || !isNum(i) || !Number.isInteger(i) || i < 0 || i >= SONG_PIPES) return;
      const now = Date.now();
      meta.noteTokens = Math.min(8, meta.noteTokens + ((now - meta.noteRefill) / 1000) * 8);
      meta.noteRefill = now;
      if (meta.noteTokens < 1) return;
      meta.noteTokens -= 1;
      this.broadcast(MSG_NOTE, { i }, { except: client });
    });
    // 정의되지 않은 메시지는 조용히 무시한다.
    this.onMessage(MSG_REST, (client, msg: unknown) => {
      const jelly = this.state.players.get(client.sessionId);
      if (!jelly || typeof msg !== "boolean") return;
      if (msg && !jelly.resting) this.awaySince.set(client.sessionId, Date.now());
      if (!msg) this.awaySince.delete(client.sessionId);
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

    // 자람은 각자의 브라우저에 쌓여 있다가 입장할 때 함께 들어온다 (겉모습에만 쓰이는 값).
    const growth = (options as { growth?: unknown } | null)?.growth;
    jelly.growth = isNum(growth) ? clamp(growth, 0, 1) : 0;
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
    this.meta.set(client.sessionId, { lastMoveAt: now, lastGlowAt: 0, sleeperGlowAt: 0, noteTokens: 8, noteRefill: now, tokens: MSG_RATE, lastRefill: now });
  }

  async onLeave(client: Client, consented: boolean) {
    const jelly = this.state.players.get(client.sessionId);
    if (!jelly) return;

    if (!consented) {
      jelly.connected = false;
      jelly.speed = 0;
      this.awaySince.set(client.sessionId, Date.now());
      try {
        await this.allowReconnection(client, RECONNECT_WINDOW_S);
        jelly.connected = true;
        if (!jelly.resting) this.awaySince.delete(client.sessionId);
        const m = this.meta.get(client.sessionId);
        if (m) m.lastMoveAt = Date.now();
        return;
      } catch {
        // 시간 안에 돌아오지 않음 → 아래에서 정리
      }
    }

    this.state.players.delete(client.sessionId);
    this.meta.delete(client.sessionId);
    this.inviteAt.delete(client.sessionId);
    this.tagStartedAt.delete(client.sessionId);
    this.tagPassedAt.delete(client.sessionId);
    this.awaySince.delete(client.sessionId);
  }

  /** 잠든 빛 곁에서 인사가 건네졌다. 최근에 함께 인사한 사람이 둘 이상이면 깨어난다. */
  private touchSleeper(now: number) {
    if (this.state.sleeperAwake) return;
    let together = 0;
    this.meta.forEach((m, id) => {
      const j = this.state.players.get(id);
      if (j?.connected && now - m.sleeperGlowAt < SLEEPER.togetherWindowMs) together++;
    });
    if (together < 2) {
      this.state.sleeperStirs = (this.state.sleeperStirs + 1) % 65536;
      return;
    }
    // 함께 깨운 인사는 한 번만 쓰인다
    this.meta.forEach((m) => (m.sleeperGlowAt = 0));
    this.wakeSleeper(WAKE_TOGETHER, SLEEPER.awakeSeconds);
  }

  // ------------------------------------------------------------------
  // 빛 술래잡기
  // ------------------------------------------------------------------

  private inviteAt = new Map<string, number>();
  /** 쉬는 중이거나 연결이 끊긴 시각 */
  private awaySince = new Map<string, number>();
  private tagStartedAt = new Map<string, number>();
  private tagPassedAt = new Map<string, number>();

  private distance(a: Jelly, b: Jelly) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  /** 가장 가까운 해파리에게 청한다. 상대가 이미 나에게 청해 두었다면 바로 시작한다. */
  private tagInvite(id: string, now: number) {
    const me = this.state.players.get(id);
    if (!me || me.tagWith || !me.connected) return;
    let best = "";
    let bestD: number = TAG.inviteRange;
    this.state.players.forEach((p, pid) => {
      if (pid === id || !p.connected || p.resting || p.tagWith) return;
      const d = this.distance(me, p);
      if (d < bestD) {
        best = pid;
        bestD = d;
      }
    });
    if (!best) return;
    const other = this.state.players.get(best)!;
    if (other.inviteTo === id && now - (this.inviteAt.get(best) ?? 0) < TAG.inviteExpireMs) {
      this.startTag(id, best, now);
    } else {
      me.inviteTo = best;
      this.inviteAt.set(id, now);
    }
  }

  private startTag(a: string, b: string, now: number) {
    const A = this.state.players.get(a);
    const B = this.state.players.get(b);
    if (!A || !B) return;
    A.inviteTo = "";
    B.inviteTo = "";
    A.tagWith = b;
    B.tagWith = a;
    const aIsIt = Math.random() < 0.5;
    A.it = aIsIt;
    B.it = !aIsIt;
    for (const id of [a, b]) {
      this.tagStartedAt.set(id, now);
      this.tagPassedAt.set(id, now);
    }
  }

  private endTag(p: Jelly | undefined) {
    if (!p) return;
    p.tagWith = "";
    p.it = false;
  }

  private tickTag() {
    const now = Date.now();
    const players = this.state.players;
    players.forEach((p, id) => {
      // 청: 시간이 지나거나, 멀어지거나, 상대가 다른 놀이를 시작하면 사라진다
      if (p.inviteTo) {
        const t = players.get(p.inviteTo);
        if (
          !t ||
          !t.connected ||
          !p.connected ||
          t.tagWith ||
          now - (this.inviteAt.get(id) ?? 0) > TAG.inviteExpireMs ||
          this.distance(p, t) > TAG.inviteBreakDistance
        ) {
          p.inviteTo = "";
        }
      }

      // 놀이: 한 쌍을 한 번만 본다
      if (!p.tagWith) return;
      const q = players.get(p.tagWith);
      if (!q || q.tagWith !== id) {
        this.endTag(p);
        return;
      }
      if (id > p.tagWith) return;
      const d = this.distance(p, q);
      const away = (pid: string) => now - (this.awaySince.get(pid) ?? now) > TAG.awayGraceMs;
      if (
        away(id) ||
        away(p.tagWith) ||
        now - (this.tagStartedAt.get(id) ?? now) > TAG.durationMs ||
        d > TAG.breakDistance
      ) {
        this.endTag(p);
        this.endTag(q);
        return;
      }
      const present = p.connected && q.connected && !p.resting && !q.resting;
      if (present && d < TAG.tagRadius && now - (this.tagPassedAt.get(id) ?? 0) > TAG.immuneMs) {
        p.it = !p.it;
        q.it = !q.it;
        this.tagPassedAt.set(id, now);
        this.tagPassedAt.set(p.tagWith, now);
      }
    });
  }

  private sleepTimer: { clear(): void } | null = null;

  private wakeSleeper(kind: number, seconds: number) {
    if (this.state.sleeperAwake) return;
    this.state.sleeperAwake = true;
    this.state.sleeperWakeKind = kind;
    this.state.sleeperWakes = (this.state.sleeperWakes + 1) % 65536;
    this.sleepTimer?.clear();
    this.sleepTimer = this.clock.setTimeout(() => {
      this.state.sleeperAwake = false;
      this.sleepTimer = null;
    }, seconds * 1000);
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
    if (isNum(m.t)) jelly.t = m.t;
    if (isNum(m.growth)) {
      // 줄어드는 것은 자유롭지만, 한 번에 늘어나는 폭은 제한한다
      jelly.growth = Math.min(clamp(m.growth, 0, 1), jelly.growth + 0.2 * dt + 0.02);
    }
  }
}
