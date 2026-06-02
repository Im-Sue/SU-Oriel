import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_API_PROXY_TARGET?.trim() || env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:3030";

  return {
    plugins: [react()],
    server: {
      proxy: {
        // 开发态统一走 /api 同源请求，再由 Vite 代理到真实后端，避免硬编码 localhost。
        // ws:true：slot-terminal WS 走 /api/slot-terminal/ws，必须转发 Upgrade，否则握手失败、终端空白。
        // 对纯 HTTP 无副作用（仅带 Upgrade 头的请求才升级）。
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
          ws: true
        },
        // AI CLI 嵌入式终端走 WebSocket，必须 ws:true，否则浏览器 ws://5173/ws/...
        // 会被 vite 当成普通 HTTP，握手失败、终端立刻显示"已关闭"。
        "/ws": {
          target: proxyTarget,
          changeOrigin: true,
          ws: true
        }
      }
    },
    test: {
      environment: "happy-dom",
      setupFiles: "./src/test/setup.ts",
      exclude: ["**/.test-dist/**", "**/node_modules/**"],
      pool: "threads",
      poolOptions: {
        threads: {
          singleThread: true
        }
      }
    }
  };
});
