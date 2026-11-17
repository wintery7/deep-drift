import { useEffect, useState } from "react";
import { PUBLIC_SEA } from "../../../shared/world.ts";
import { enterOcean, usePublicSea } from "../game/actions.ts";
import { VARIANTS } from "../game/runtime.ts";
import { setState, useGame } from "../game/store.ts";
import { fetchLiveCount } from "../net/network.ts";
import { ControlsGuide, SoundControls } from "./SoundControls.tsx";

/** 지금 바다에 몇 마리가 있는지 — 누군가 있다는 것만 조용히 알려 준다 */
function LiveCount() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetchLiveCount().then((n) => {
        if (alive) setCount(n);
      });
    };
    load();
    const iv = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  if (count === null) return null;
  return (
    <p className="menu__live">
      <span className={`menu__live-dot ${count > 0 ? "is-on" : ""}`} />
      {count > 0 ? `지금 ${count}마리가 바다에 있어요` : "지금은 고요한 바다예요"}
    </p>
  );
}

export function Menu() {
  const variant = useGame((s) => s.variant);
  const sea = useGame((s) => s.sea);
  const invited = sea !== PUBLIC_SEA;
  const [panel, setPanel] = useState<"none" | "sound" | "guide">("none");

  return (
    <div className="menu">
      <div className="menu__inner">
        <h1 className="logo">DEEP DRIFT</h1>
        <p className="tagline">같은 바다에서, 각자의 속도로.</p>

        <div className="swatches" role="radiogroup" aria-label="해파리 색">
          {VARIANTS.map((v, i) => (
            <button
              key={v.name}
              type="button"
              role="radio"
              aria-checked={variant === i}
              aria-label={v.name}
              title={v.name}
              className={`swatch ${variant === i ? "is-active" : ""}`}
              style={{ ["--swatch" as string]: v.color, ["--swatch-glow" as string]: v.glow }}
              onClick={() => setState({ variant: i })}
            />
          ))}
        </div>

        <button type="button" className="enter" onClick={enterOcean} autoFocus>
          {invited ? "초대받은 바다로 들어가기" : "심해로 들어가기"}
        </button>

        {invited ? (
          <p className="menu__live">
            초대 링크로 연결된 바다예요 ·{" "}
            <button type="button" className="link link--inline" onClick={usePublicSea}>
              모두의 바다로 가기
            </button>
          </p>
        ) : (
          <LiveCount />
        )}

        <div className="menu__links">
          <button type="button" className={`link ${panel === "sound" ? "is-active" : ""}`} onClick={() => setPanel(panel === "sound" ? "none" : "sound")}>
            사운드 설정
          </button>
          <button type="button" className={`link ${panel === "guide" ? "is-active" : ""}`} onClick={() => setPanel(panel === "guide" ? "none" : "guide")}>
            조작 방법
          </button>
        </div>

        {panel !== "none" && <div className="card menu__panel">{panel === "sound" ? <SoundControls /> : <ControlsGuide />}</div>}
      </div>
      <p className="menu__foot">가입도, 목표도, 대화도 없습니다. 머물고 싶은 만큼만 머무르세요.</p>
    </div>
  );
}
