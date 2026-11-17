# DEEP DRIFT — 서버 하나가 게임(WebSocket)과 빌드된 클라이언트를 같은 포트로 서빙한다.
FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=2567
EXPOSE 2567
CMD ["npm", "start"]
