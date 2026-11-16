import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { OceanRoom } from "./OceanRoom.ts";

const port = Number(process.env.PORT) || 2567;

const app = express();
app.get("/health", (_req, res) => {
  res.json({ ok: true });
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

gameServer.define("ocean", OceanRoom);

gameServer.listen(port).then(() => {
  console.log(`[deep-drift] ocean server listening on :${port}`);
});
