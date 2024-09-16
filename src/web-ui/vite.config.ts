import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';
import { compression } from 'vite-plugin-compression2';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html')
      }
    },
    sourcemap: true // Source map generation must be turned on
  },
  plugins: [react(), compression()],
  // shadcn options
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        ws: true
        // rewriteWsOrigin: true
      },
      '/auth': 'http://localhost:3000'
    }
  }
});
