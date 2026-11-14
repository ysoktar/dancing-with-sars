import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages project sites
// (https://<user>.github.io/<repo>/) and any static host.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('three') || id.includes('globe')) return 'globe';
          if (id.includes('chart.js')) return 'charts';
        },
      },
    },
  },
});
