import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const rawBase = env.VITE_BASE_PATH || "/";
  const base = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;
  return {
  base,
  server: {
    host: "::",
    port: 8080,
    proxy: {
      // Mismo origen que Vite: el navegador no hace OPTIONS/CORS.
      // php artisan serve es un solo hilo; el preflight duplicaba cada petición.
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/auth": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: true,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  };
});
