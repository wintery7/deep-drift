// 게임 서버(:2567)와 클라이언트(:5173)를 한 번에 띄운다.
//   npm run dev            — 둘 다 실행
//   npm run dev -- --open  — 실행 후 브라우저도 연다
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const open = process.argv.includes("--open");

// 개발 중에는 포트를 고정한다. (바깥에서 PORT 환경 변수가 들어와도 서로의 포트를 차지하지 않게)
const SERVER_PORT = "2567";

const procs = [
  ["server", "npm run dev -w server"],
  ["client", `npm run dev -w client${open ? " -- --open" : ""}`],
].map(([name, cmd]) => {
  const child = spawn(cmd, { cwd: root, shell: true, stdio: "inherit", env: { ...process.env, PORT: SERVER_PORT } });
  child.on("exit", (code) => {
    console.log(`[dev] ${name} 종료 (code ${code ?? "?"})`);
    shutdown(code ?? 0);
  });
  return child;
});

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const p of procs) {
    if (p.exitCode !== null || !p.pid) continue;
    if (process.platform === "win32") {
      // shell 로 띄운 자식의 하위 프로세스까지 함께 정리한다
      spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      p.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
