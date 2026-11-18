import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// One command (`npm run dev` in the project root) starts API + web. /api and /uploads are proxied to the API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
});
