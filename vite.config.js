import { defineConfig } from 'vite';

export default defineConfig({
  root: 'dashboard',
  base: '/dashboard/',
  server: {
    proxy: {
      '/api': process.env.BACKEND_URL || 'http://127.0.0.1:7071'
    }
  },
  build: {
    outDir: '../dist-dashboard',
    emptyOutDir: true
  }
});
