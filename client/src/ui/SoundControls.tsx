import { setState, useGame } from "../game/store.ts";

function Slider({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <label className={`slider ${disabled ? "is-disabled" : ""}`}>
      <span className="slider__label">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        aria-label={`${label} 볼륨`}
      />
      <span className="slider__value">{Math.round(value * 100)}</span>
    </label>
  );
}

export function SoundControls() {
  const ambientVol = useGame((s) => s.ambientVol);
  const sfxVol = useGame((s) => s.sfxVol);
  const muted = useGame((s) => s.muted);

  return (
    <div className="sound">
      <Slider label="환경음" value={ambientVol} onChange={(v) => setState({ ambientVol: v })} disabled={muted} />
      <Slider label="효과음" value={sfxVol} onChange={(v) => setState({ sfxVol: v })} disabled={muted} />
      <label className="toggle">
        <input type="checkbox" checked={muted} onChange={(e) => setState({ muted: e.target.checked })} />
        <span>소리 끄기</span>
      </label>
    </div>
  );
}

export function ControlsGuide() {
  return (
    <ul className="keys">
      <li>
        <span className="keys__caps">
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd>
        </span>
        <span>유영</span>
      </li>
      <li>
        <span className="keys__caps">
          <kbd>Space</kbd>
        </span>
        <span>떠오르기</span>
      </li>
      <li>
        <span className="keys__caps">
          <kbd>Shift</kbd>
        </span>
        <span>가라앉기</span>
      </li>
      <li>
        <span className="keys__caps">
          <kbd>드래그</kbd>
        </span>
        <span>둘러보기</span>
      </li>
      <li>
        <span className="keys__caps">
          <kbd>Esc</kbd>
        </span>
        <span>설정 · 쉬기</span>
      </li>
    </ul>
  );
}
