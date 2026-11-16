/** 키보드 입력 상태. PRD FR-03의 키 배치를 따른다. */
const down = new Set<string>();

const TRACKED = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "ShiftLeft",
  "ShiftRight",
]);

let installed = false;

export function installInput() {
  if (installed) return;
  installed = true;

  window.addEventListener("keydown", (e) => {
    if (!TRACKED.has(e.code)) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    down.add(e.code);
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => {
    down.delete(e.code);
  });
  // 창을 벗어나면 눌린 키가 남지 않도록 비운다.
  window.addEventListener("blur", () => down.clear());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) down.clear();
  });
}

const axis = (pos: boolean, neg: boolean) => (pos ? 1 : 0) - (neg ? 1 : 0);

export function readInput() {
  return {
    forward: axis(down.has("KeyW") || down.has("ArrowUp"), down.has("KeyS") || down.has("ArrowDown")),
    strafe: axis(down.has("KeyD") || down.has("ArrowRight"), down.has("KeyA") || down.has("ArrowLeft")),
    vertical: axis(down.has("Space"), down.has("ShiftLeft") || down.has("ShiftRight")),
  };
}

export function clearInput() {
  down.clear();
}
