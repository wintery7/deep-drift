import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 포트가 이미 쓰이고 있으면 조용히 다른 포트로 옮기지 않고 알려 준다.
    strictPort: true,
    fs: { allow: [".."] },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
