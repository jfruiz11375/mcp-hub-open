import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    port: Number(process.env.WEB_PORT || 5173),
    https: true,
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.API_PORT || 4010}`,
        changeOrigin: true
      }
    }
  }
});
