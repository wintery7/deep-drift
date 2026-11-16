import type { Camera, Vector3 } from "three";
import { Vector3 as V3 } from "three";

/**
 * 심해 사운드 — 음원 파일 없이 Web Audio API로 모두 합성한다.
 *  - 환경음 버스: 수중 저음, 드론, 느린 패드, 멀리서 들리는 고래 울음
 *  - 효과음 버스: 물방울, 해파리의 유영 소리, 다른 해파리가 다가올 때의 잔잔한 울림
 * 패드·물방울·고래는 매번 무작위로 생성되어 반복 청취에도 같은 루프가 들리지 않는다.
 */

// D 단조 펜타토닉 — 어떤 조합으로 울려도 불협이 나지 않는다.
const PAD_NOTES = [73.42, 87.31, 110.0, 130.81, 146.83, 174.61, 220.0, 261.63];
const CHIME_NOTES = [587.33, 698.46, 880.0, 1046.5, 1174.66];

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];

const _fwd = new V3();
const _up = new V3();

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambient!: GainNode;
  private sfx!: GainNode;
  private ambientReverb!: GainNode;
  private sfxReverb!: GainNode;
  private noise!: AudioBuffer;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private active = false;
  private levels = { ambient: 0.7, sfx: 0.6, muted: false };
  private whalePos = new V3(60, 14, 0);
  private listenerPos = new V3();
  private lastSwish = 0;

  /** 사용자 제스처(입장 버튼) 안에서 호출해야 한다. */
  start() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
        this.build();
      } catch {
        this.ctx = null;
        return;
      }
    }
    void this.ctx.resume().catch(() => {});
    this.active = true;
    this.applyLevels(1.5);
    this.scheduleLoops();
  }

  /** 메뉴로 나갈 때: 부드럽게 줄인 뒤 멈춘다. */
  stop() {
    this.active = false;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    const ctx = this.ctx;
    if (!ctx) return;
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.active) void ctx.suspend().catch(() => {});
    }, 1200);
    this.timers.add(t);
  }

  setLevels(ambient: number, sfx: number, muted: boolean) {
    this.levels = { ambient, sfx, muted };
    if (this.active) this.applyLevels(0.08);
  }

  updateListener(camera: Camera) {
    const ctx = this.ctx;
    if (!ctx || !this.active) return;
    const l = ctx.listener;
    const p = camera.position;
    this.listenerPos.copy(p);
    camera.getWorldDirection(_fwd);
    _up.copy(camera.up).applyQuaternion(camera.quaternion);
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setTargetAtTime(p.x, t, 0.05);
      l.positionY.setTargetAtTime(p.y, t, 0.05);
      l.positionZ.setTargetAtTime(p.z, t, 0.05);
      l.forwardX.setTargetAtTime(_fwd.x, t, 0.05);
      l.forwardY.setTargetAtTime(_fwd.y, t, 0.05);
      l.forwardZ.setTargetAtTime(_fwd.z, t, 0.05);
      l.upX.setTargetAtTime(_up.x, t, 0.05);
      l.upY.setTargetAtTime(_up.y, t, 0.05);
      l.upZ.setTargetAtTime(_up.z, t, 0.05);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(_fwd.x, _fwd.y, _fwd.z, _up.x, _up.y, _up.z);
    }
  }

  setWhalePosition(p: Vector3) {
    this.whalePos.copy(p);
  }

  /** 해파리가 물을 밀어낼 때의 부드러운 소리 */
  swish(intensity: number) {
    const ctx = this.ctx;
    if (!ctx || !this.active || ctx.state !== "running") return;
    const now = ctx.currentTime;
    if (now - this.lastSwish < 0.45) return;
    this.lastSwish = now;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random() * 4;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(rand(420, 560), now);
    bp.frequency.exponentialRampToValueAtTime(190, now + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.22 * intensity, now + 0.14);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    src.connect(bp).connect(g).connect(this.sfx);
    src.start(now, Math.random() * 4);
    src.stop(now + 0.85);
  }

  /** 다른 해파리가 가까이 왔을 때 그 방향에서 들리는 잔잔한 울림 */
  chime(pos: Vector3) {
    const ctx = this.ctx;
    if (!ctx || !this.active || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const panner = this.makePanner(pos.x, pos.y, pos.z, 6, 1);
    const base = pick(CHIME_NOTES);
    [1, 1.5].forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = base * ratio;
      const g = ctx.createGain();
      const start = now + i * 0.18;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(i === 0 ? 0.09 : 0.045, start + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 3.2);
      osc.connect(g).connect(panner);
      osc.start(start);
      osc.stop(start + 3.3);
    });
    panner.connect(this.sfx);
    panner.connect(this.sfxReverb);
  }

  // ------------------------------------------------------------------

  private applyLevels(timeConstant: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(this.levels.muted ? 0 : 0.9, t, timeConstant);
    this.ambient.gain.setTargetAtTime(this.levels.ambient, t, 0.08);
    this.sfx.gain.setTargetAtTime(this.levels.sfx, t, 0.08);
  }

  private build() {
    const ctx = this.ctx!;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 6;
    limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(limiter);

    this.ambient = ctx.createGain();
    this.ambient.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);

    this.ambientReverb = this.makeReverb(5.5, this.ambient, 0.9);
    this.sfxReverb = this.makeReverb(3.5, this.sfx, 0.7);

    // --- 브라운 노이즈 (수중 저음의 재료) ---
    const len = ctx.sampleRate * 8;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    // 루프 이음매가 튀지 않게 양 끝을 페이드
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      data[i] *= k;
      data[len - 1 - i] *= k;
    }

    // --- 깊은 바다의 압력감 ---
    const bed = ctx.createBufferSource();
    bed.buffer = this.noise;
    bed.loop = true;
    const bedLp = ctx.createBiquadFilter();
    bedLp.type = "lowpass";
    bedLp.frequency.value = 190;
    bedLp.Q.value = 0.6;
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.55;
    bed.connect(bedLp).connect(bedGain).connect(this.ambient);
    this.lfo(0.05, 55, bedLp.frequency);
    bed.start();

    // --- 물결이 스치는 중역 ---
    const wash = ctx.createBufferSource();
    wash.buffer = this.noise;
    wash.loop = true;
    wash.playbackRate.value = 1.7;
    const washBp = ctx.createBiquadFilter();
    washBp.type = "bandpass";
    washBp.frequency.value = 520;
    washBp.Q.value = 0.5;
    const washGain = ctx.createGain();
    washGain.gain.value = 0.05;
    wash.connect(washBp).connect(washGain).connect(this.ambient);
    this.lfo(0.09, 0.035, washGain.gain);
    this.lfo(0.031, 160, washBp.frequency);
    wash.start(0, 3);

    // --- 드론 ---
    [
      { f: 55, g: 0.1, rate: 0.043 },
      { f: 82.6, g: 0.05, rate: 0.061 },
      { f: 110.4, g: 0.028, rate: 0.037 },
    ].forEach(({ f, g, rate }) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.value = g;
      osc.connect(gain).connect(this.ambient);
      this.lfo(rate, g * 0.6, gain.gain);
      osc.start();
    });
  }

  private lfo(rate: number, depth: number, target: AudioParam) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.value = rate;
    const g = ctx.createGain();
    g.gain.value = depth;
    osc.connect(g).connect(target);
    osc.start();
  }

  /** 노이즈 감쇠 임펄스로 만든 간단한 잔향. 반환값은 send 입력. */
  private makeReverb(seconds: number, dest: AudioNode, wet: number): GainNode {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
      }
    }
    const input = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = impulse;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2200;
    const out = ctx.createGain();
    out.gain.value = wet;
    input.connect(conv).connect(lp).connect(out).connect(dest);
    return input;
  }

  private makePanner(x: number, y: number, z: number, refDistance: number, rolloff: number): PannerNode {
    const ctx = this.ctx!;
    const p = ctx.createPanner();
    p.panningModel = "equalpower";
    p.distanceModel = "inverse";
    p.refDistance = refDistance;
    p.rolloffFactor = rolloff;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      p.setPosition(x, y, z);
    }
    return p;
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.active) return;
      fn();
    }, ms);
    this.timers.add(t);
  }

  private get audible() {
    return this.ctx !== null && this.ctx.state === "running" && !document.hidden;
  }

  private scheduleLoops() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();

    const padLoop = () => {
      if (this.audible) this.playPad();
      this.later(rand(5000, 11000), padLoop);
    };
    const bubbleLoop = () => {
      if (this.audible) this.playBubbles();
      this.later(rand(1800, 7000), bubbleLoop);
    };
    const whaleLoop = () => {
      if (this.audible) this.playWhale();
      this.later(rand(32000, 75000), whaleLoop);
    };
    this.later(2500, padLoop);
    this.later(4000, bubbleLoop);
    this.later(14000, whaleLoop);
  }

  private playPad() {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const freq = pick(PAD_NOTES);
    const attack = rand(2.5, 4.5);
    const hold = rand(1, 3);
    const release = rand(4, 7);
    const peak = 0.05;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + attack);
    g.gain.setValueAtTime(peak, now + attack + hold);
    g.gain.linearRampToValueAtTime(0, now + attack + hold + release);

    (["sine", "triangle"] as const).forEach((type, i) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = i === 0 ? -5 : 6;
      const og = ctx.createGain();
      og.gain.value = i === 0 ? 1 : 0.35;
      osc.connect(og).connect(lp);
      osc.start(now);
      osc.stop(now + attack + hold + release + 0.1);
    });
    lp.connect(g);
    g.connect(this.ambient);
    g.connect(this.ambientReverb);
  }

  private playBubbles() {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const count = 1 + Math.floor(Math.random() * 5);
    const angle = rand(0, Math.PI * 2);
    const dist = rand(3, 11);
    const lp = this.listenerPos;
    const panner = this.makePanner(lp.x + Math.cos(angle) * dist, lp.y + rand(-3, 2), lp.z + Math.sin(angle) * dist, 4, 1);
    panner.connect(this.sfx);
    panner.connect(this.sfxReverb);

    let t = now;
    for (let i = 0; i < count; i++) {
      const f0 = rand(480, 1300);
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * rand(1.6, 2.1), t + 0.075);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(0.05, 0.11), t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.connect(g).connect(panner);
      osc.start(t);
      osc.stop(t + 0.12);
      t += rand(0.06, 0.16);
    }
  }

  private playWhale() {
    const ctx = this.ctx!;
    const w = this.whalePos;
    const panner = this.makePanner(w.x, w.y, w.z, 30, 0.7);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 650;
    lp.connect(panner);
    panner.connect(this.ambient);
    panner.connect(this.ambientReverb);

    let t = ctx.currentTime + 0.1;
    const moans = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < moans; i++) {
      const dur = rand(2.6, 4.4);
      const f1 = rand(110, 170);
      const f2 = f1 * rand(1.35, 1.9);
      const f3 = f1 * rand(0.7, 1.05);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + dur * 0.25);
      g.gain.setValueAtTime(0.5, t + dur * 0.55);
      g.gain.linearRampToValueAtTime(0, t + dur);
      g.connect(lp);

      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = rand(4, 6);
      const vibGain = ctx.createGain();
      vibGain.gain.value = 3;
      vibrato.connect(vibGain);
      vibrato.start(t);
      vibrato.stop(t + dur + 0.1);

      [
        { mult: 1, gain: 1, type: "sine" as const },
        { mult: 2.01, gain: 0.18, type: "triangle" as const },
      ].forEach(({ mult, gain, type }) => {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(f1 * mult, t);
        osc.frequency.exponentialRampToValueAtTime(f2 * mult, t + dur * 0.4);
        osc.frequency.exponentialRampToValueAtTime(f3 * mult, t + dur);
        vibGain.connect(osc.frequency);
        const og = ctx.createGain();
        og.gain.value = gain;
        osc.connect(og).connect(g);
        osc.start(t);
        osc.stop(t + dur + 0.1);
      });

      t += dur + rand(0.5, 1.6);
    }
  }
}

export const audio = new AudioEngine();
