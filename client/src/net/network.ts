import { Client, type Room } from "colyseus.js";
import { MSG_GLOW, MSG_MOVE, MSG_REST, PUBLIC_SEA, type MoveMessage } from "../../../shared/world.ts";
import { josa } from "../../../shared/names.ts";
import { runtime } from "../game/runtime.ts";
import { getState, setState } from "../game/store.ts";
import { toast } from "../game/toast.ts";

export interface Snapshot {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  lean: number;
  speed: number;
}

export interface RemoteJelly {
  id: string;
  variant: number;
  connected: boolean;
  /** 인사 횟수 카운터 — 값이 바뀌면 빛을 재생한다 */
  glow: number;
  growth: number;
  /** 익명 이름 */
  name: string;
  /** 쉬는 중 */
  resting: boolean;
  buffer: Snapshot[];
}

interface JellyLike {
  x: number;
  y: number;
  z: number;
  yaw: number;
  lean: number;
  speed: number;
  variant: number;
  connected: boolean;
  glow?: number;
  growth?: number;
  name?: string;
  resting?: boolean;
}
interface OceanStateLike {
  players: { forEach(cb: (p: JellyLike, id: string) => void): void };
}

const TOKEN_KEY = "deep-drift:reconnect";
const RETRY_MS = 4000;
const MAX_BUFFER = 24;

function endpoint(): string {
  const override = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (override) return override;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  // 개발 중에는 Vite(5173)와 게임 서버(2567)가 분리되어 있다.
  return import.meta.env.DEV ? `${proto}://${location.hostname}:2567` : `${proto}://${location.host}`;
}

class Network {
  readonly remotes = new Map<string, RemoteJelly>();
  /** 렌더링할 원격 해파리 id 목록 (변경 시에만 새 배열) */
  ids: string[] = [];

  private client: Client | null = null;
  private room: Room<OceanStateLike> | null = null;
  private wantOnline = false;
  private joining = false;
  private spawned = false;
  private variant = 0;
  private sea: string = PUBLIC_SEA;
  private resting = false;
  /** 방에 들어온 직후의 첫 상태 — 이미 있던 해파리는 "들어왔어요"라고 알리지 않는다 */
  private initialSync = true;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getIds = () => this.ids;

  get online() {
    return this.room !== null;
  }

  connect(variant: number, sea: string = PUBLIC_SEA) {
    this.variant = variant;
    this.sea = sea;
    this.wantOnline = true;
    this.spawned = false;
    void this.tryJoin();
  }

  leave() {
    this.wantOnline = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* noop */
    }
    const room = this.room;
    this.room = null;
    if (room) {
      room.removeAllListeners();
      void room.leave(true).catch(() => {});
    }
    this.clearRemotes();
    this.resting = false;
    setState({ net: "offline" });
  }

  sendRest(resting: boolean) {
    if (resting === this.resting) return;
    this.resting = resting;
    if (!this.room) return;
    try {
      this.room.send(MSG_REST, resting);
    } catch {
      /* noop */
    }
  }

  sendGlow() {
    if (!this.room) return;
    try {
      this.room.send(MSG_GLOW);
    } catch {
      /* noop */
    }
  }

  sendMove(msg: MoveMessage) {
    if (!this.room) return;
    try {
      this.room.send(MSG_MOVE, msg);
    } catch {
      // 전송 중 끊김은 onLeave에서 처리된다.
    }
  }

  private async tryJoin() {
    if (!this.wantOnline || this.room || this.joining) return;
    this.joining = true;
    setState({ net: this.spawned ? "reconnecting" : "connecting" });

    try {
      this.client ??= new Client(endpoint());
      let room: Room<OceanStateLike> | null = null;

      // 새로고침·순간 단절이면 같은 자리로 복귀를 먼저 시도한다.
      let token: string | null = null;
      try {
        // 토큰은 "바다 이름|토큰"으로 저장된다. 다른 바다의 토큰으로는 돌아가지 않는다.
        const saved = sessionStorage.getItem(TOKEN_KEY);
        const cut = saved ? saved.indexOf("|") : -1;
        if (saved && cut > 0 && saved.slice(0, cut) === this.sea) token = saved.slice(cut + 1);
        else if (saved) sessionStorage.removeItem(TOKEN_KEY);
      } catch {
        /* noop */
      }
      if (token) {
        try {
          room = await this.client.reconnect<OceanStateLike>(token);
        } catch {
          try {
            sessionStorage.removeItem(TOKEN_KEY);
          } catch {
            /* noop */
          }
        }
      }
      room ??= await this.client.joinOrCreate<OceanStateLike>("ocean", {
        variant: this.variant,
        sea: this.sea,
        nameA: getState().nameA,
        nameB: getState().nameB,
        growth: runtime.growth,
      });

      if (!this.wantOnline) {
        void room.leave(true).catch(() => {});
        return;
      }
      this.attach(room);
    } catch {
      setState({ net: "offline" });
      this.scheduleRetry(RETRY_MS);
    } finally {
      this.joining = false;
    }
  }

  private attach(room: Room<OceanStateLike>) {
    this.room = room;
    try {
      sessionStorage.setItem(TOKEN_KEY, `${this.sea}|${room.reconnectionToken}`);
    } catch {
      /* noop */
    }
    setState({ net: "online" });
    this.initialSync = true;
    // 재접속했을 때 쉬는 중 상태를 다시 알려 준다
    if (this.resting) {
      try {
        room.send(MSG_REST, true);
      } catch {
        /* noop */
      }
    }

    room.onStateChange((state) => this.sync(room, state));
    room.onError(() => {});
    room.onLeave(() => {
      if (this.room !== room) return;
      this.room = null;
      this.clearRemotes();
      if (this.wantOnline) {
        setState({ net: "reconnecting" });
        this.scheduleRetry(600);
      }
    });
  }

  private scheduleRetry(ms: number) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.tryJoin();
    }, ms);
  }

  private sync(room: Room<OceanStateLike>, state: OceanStateLike) {
    if (this.room !== room || !state?.players) return;
    const now = performance.now();
    const seen = new Set<string>();
    let changed = false;

    state.players.forEach((p, id) => {
      if (id === room.sessionId) {
        // 처음 입장할 때만 서버가 정해 준 자리에서 시작한다.
        if (!this.spawned) {
          this.spawned = true;
          runtime.pos.set(p.x, p.y, p.z);
          runtime.vel.set(0, 0, 0);
          runtime.yaw = p.yaw;
        }
        return;
      }
      seen.add(id);
      let r = this.remotes.get(id);
      if (!r) {
        r = {
          id,
          variant: p.variant,
          connected: p.connected,
          glow: p.glow ?? 0,
          growth: p.growth ?? 0,
          name: p.name ?? "",
          resting: p.resting ?? false,
          buffer: [],
        };
        this.remotes.set(id, r);
        changed = true;
        if (!this.initialSync && r.name) toast(`${r.name}${josa(r.name, "이", "가")} 바다에 들어왔어요`, 5000);
      }
      r.variant = p.variant;
      r.connected = p.connected;
      r.glow = p.glow ?? 0;
      r.growth = p.growth ?? 0;
      r.name = p.name ?? r.name;
      r.resting = p.resting ?? false;
      r.buffer.push({ t: now, x: p.x, y: p.y, z: p.z, yaw: p.yaw, lean: p.lean, speed: p.speed });
      if (r.buffer.length > MAX_BUFFER) r.buffer.shift();
    });

    for (const id of [...this.remotes.keys()]) {
      if (!seen.has(id)) {
        const gone = this.remotes.get(id);
        if (gone?.name) toast(`${gone.name}${josa(gone.name, "은", "는")} 먼저 돌아갔어요`, 5000);
        this.remotes.delete(id);
        changed = true;
      }
    }
    this.initialSync = false;
    if (changed) this.emit();
  }

  private clearRemotes() {
    if (this.remotes.size === 0) return;
    this.remotes.clear();
    this.emit();
  }

  private emit() {
    this.ids = [...this.remotes.keys()];
    setState({ others: this.ids.length });
    this.listeners.forEach((l) => l());
  }
}

export const network = new Network();

/** 지금 서버 전체에 몇 마리가 있는지 (메뉴 표시용). 실패하면 null. */
export async function fetchLiveCount(): Promise<number | null> {
  try {
    const res = await fetch(endpoint().replace(/^ws/, "http") + "/stats", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { jellies?: unknown };
    return typeof data.jellies === "number" ? data.jellies : null;
  } catch {
    return null;
  }
}
