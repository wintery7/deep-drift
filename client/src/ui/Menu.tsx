import { useState } from "react";
import { enterOcean } from "../game/actions.ts";
import { VARIANTS } from "../game/runtime.ts";
import { setState, useGame } from "../game/store.ts";
import { ControlsGuide, SoundControls } from "./SoundControls.tsx";

export function Menu() {
  const variant = useGame((s) => s.variant);
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
          심해로 들어가기
        </button>

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
