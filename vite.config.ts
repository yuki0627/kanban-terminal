import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Dev ports. The backend (Express) listens on PORT (default 34567, see
// server/index.ts); Vite's own dev server uses CLIENT_PORT — a SEPARATE port, since
// both run at once under `yarn dev` and can't share one. Both are env-overridable.
const BACKEND_PORT = process.env.PORT || "34567";
const CLIENT_PORT = Number(process.env.CLIENT_PORT) || 6856;

export default defineConfig({
  plugins: [vue()],
  server: {
    port: CLIENT_PORT,
    proxy: {
      // socket.io pub/sub (sidebar activity). Must precede the "/ws" rule.
      "/ws/pubsub": {
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true,
      },
      "/ws": {
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true,
      },
      "/api": {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
