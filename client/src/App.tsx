import { useEffect } from "react";
import { glow, setPaused } from "./game/actions.ts";
import { installInput } from "./game/input.ts";
import { getState, useGame } from "./game/store.ts";
import { OceanScene } from "./scene/OceanScene.tsx";
import { Hud } from "./ui/Hud.tsx";
import { Menu } from "./ui/Menu.tsx";

function Toast() {
  const message = useGame((s) => s.toast);
  if (!message) return null;
  return (
    <div className="toast" role="status" key={message}>
      {message}
    </div>
  );
}

export function App() {
  const phase = useGame((s) => s.phase);

  useEffect(() => {
    installInput();
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Escape") {
        const s = getState();
        if (s.phase === "playing") setPaused(!s.paused);
      } else if (e.code === "KeyE") {
        glow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`app app--${phase}`}>
      <div className="stage">
        <OceanScene />
      </div>
      {phase === "menu" ? <Menu /> : <Hud />}
      <Toast />
    </div>
  );
}
