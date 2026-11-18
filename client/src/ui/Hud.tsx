import { useEffect, useState } from "react";
import { exitOcean, glow, invite, setPaused, toast } from "../game/actions.ts";
import { setState, useGame } from "../game/store.ts";
import { josa } from "../../../shared/names.ts";
import { ControlsGuide, SoundControls } from "./SoundControls.tsx";

/** 술래잡기 중일 때만 보이는 작은 표시 — 남은 시간과 내 역할 */
function TagStatus() {
  const tag = useGame((s) => s.tag);
  const partner = useGame((s) => s.tagPartner);
  const endsAt = useGame((s) => s.tagEndsAt);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!tag) return;
    const iv = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(iv);
  }, [tag]);
  if (!tag) return null;
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <div className={`tag-status tag-status--${tag}`} role="status">
      <span className="tag-status__dot" />
      {tag === "it" ? `내가 술래 · ${partner}에게 닿으면 넘겨요` : `${partner}${josa(partner, "이", "가")} 술래 · 도망쳐요`}
      <span className="tag-status__time">{time}</span>
    </div>
  );
}

function Presence() {
  const net = useGame((s) => s.net);
  const others = useGame((s) => s.others);

  let text: string;
  if (net === "online") text = others > 0 ? `해파리 ${others + 1}마리가 함께 유영 중` : "지금은 혼자 유영 중";
  else if (net === "connecting") text = "바다에 연결하는 중…";
  else if (net === "reconnecting") text = "연결이 끊겨 다시 잇는 중…";
  else text = "연결할 수 없어 혼자 유영 중 · 계속 다시 시도합니다";

  return (
    <div className={`presence presence--${net}`} role="status">
      <span className="presence__dot" />
      {text}
    </div>
  );
}

export function Hud() {
  const paused = useGame((s) => s.paused);
  const muted = useGame((s) => s.muted);
  const ambientVol = useGame((s) => s.ambientVol);
  const [guideFaded, setGuideFaded] = useState(false);

  // 조작 안내는 잠시 뒤 스스로 흐려진다.
  useEffect(() => {
    const t = setTimeout(() => setGuideFaded(true), 14000);
    return () => clearTimeout(t);
  }, []);

  // 쉬러 온 곳이니, 10분이 지나면 한 번만 조용히 알려 준다.
  useEffect(() => {
    const t = setTimeout(() => toast("10분이 지났어요. 충분히 쉬었다면 돌아가도 좋아요.", 9000), 10 * 60 * 1000);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <div className="hud">
        <Presence />
        <TagStatus />
        <div className="hud__actions">
          <label className="hud__volume" title="환경음 볼륨">
            <span className="sr-only">환경음 볼륨</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(ambientVol * 100)}
              onChange={(e) => setState({ ambientVol: Number(e.target.value) / 100 })}
              disabled={muted}
            />
          </label>
          <button type="button" className="chip" onClick={() => setState({ muted: !muted })} aria-pressed={muted}>
            {muted ? "소리 켜기" : "소리 끄기"}
          </button>
          <button type="button" className="chip" onClick={glow} title="빛으로 인사 (E)">
            인사
          </button>
          <button type="button" className="chip" onClick={() => void invite()} title="같은 바다에서 만날 수 있는 링크를 복사합니다">
            초대
          </button>
          <button type="button" className="chip" onClick={() => setPaused(true)}>
            설정
          </button>
          <button type="button" className="chip" onClick={exitOcean}>
            나가기
          </button>
        </div>
        <div className={`hud__guide ${guideFaded ? "is-faded" : ""}`}>
          <ControlsGuide />
        </div>
      </div>

      {paused && (
        <div className="overlay" onClick={() => setPaused(false)}>
          <div className="card overlay__card" role="dialog" aria-label="설정" onClick={(e) => e.stopPropagation()}>
            <h2>잠시 쉬는 중</h2>
            <p className="overlay__note">바다는 계속 흐르고 있어요. 준비되면 돌아오세요.</p>
            <SoundControls />
            <hr />
            <ControlsGuide />
            <div className="overlay__buttons">
              <button type="button" className="enter enter--small" onClick={() => setPaused(false)} autoFocus>
                계속 유영하기
              </button>
              <button type="button" className="link" onClick={exitOcean}>
                나가기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
