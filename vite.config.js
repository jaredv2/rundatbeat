import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/loops-proxy': {
        target: 'https://loops-api-rdb.vercel.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/loops-proxy/, ''),
      },
    },
  },
});
