import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = "http://127.0.0.1:" + (process.env.PORT || 5178);

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": api, "/files": api } },
});
