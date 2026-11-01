import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'ES2022',
  },
  server: {
    proxy: {
      '/now': 'http://localhost:8787',
      '/audio': 'http://localhost:8787',
      '/voice': 'http://localhost:8787',
      '/signal': 'http://localhost:8787',
    },
  },
});
