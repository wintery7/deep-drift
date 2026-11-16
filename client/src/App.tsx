import { useEffect } from "react";
import { setPaused } from "./game/actions.ts";
import { installInput } from "./game/input.ts";
import { getState, useGame } from "./game/store.ts";
import { OceanScene } from "./scene/OceanScene.tsx";
import { Hud } from "./ui/Hud.tsx";
import { Menu } from "./ui/Menu.tsx";

export function App() {
  const phase = useGame((s) => s.phase);

  useEffect(() => {
    installInput();
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      const s = getState();
      if (s.phase === "playing") setPaused(!s.paused);
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
    </div>
  );
}
