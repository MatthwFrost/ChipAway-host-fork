import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

function copyStaticFiles() {
  return {
    name: 'copy-static-files',
    closeBundle() {
      copyFileSync(resolve('404.html'), resolve('dist/404.html'));
      copyFileSync(resolve('preview.png'), resolve('dist/preview.png'));
    },
  };
}

export default defineConfig({
  plugins: [react(), copyStaticFiles()],
  base: './',
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  },
});
