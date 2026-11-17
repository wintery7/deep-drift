import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { OceanRoom } from "./OceanRoom.ts";

const port = Number(process.env.PORT) || 2567;

const app = express();
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// 메뉴에 보여 줄 "지금 바다에 있는 해파리 수". 개발 중에는 다른 포트(Vite)에서 호출한다.
app.get("/stats", async (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  try {
    const rooms = await matchMaker.query({ name: "ocean" });
    res.json({ jellies: rooms.reduce((sum, r) => sum + (r.clients ?? 0), 0), seas: rooms.length });
  } catch {
    res.json({ jellies: 0, seas: 0 });
  }
});

// 빌드된 클라이언트가 있으면 같은 포트에서 함께 서빙한다 (배포용).
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
}

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer, pingInterval: 5000, pingMaxRetries: 3 }),
});

// 같은 이름의 바다끼리만 한 방에 모인다 (기본은 모두의 바다, 초대 링크는 별도의 바다).
gameServer.define("ocean", OceanRoom).filterBy(["sea"]);

gameServer.listen(port).then(() => {
  console.log(`[deep-drift] ocean server listening on :${port}`);
});
