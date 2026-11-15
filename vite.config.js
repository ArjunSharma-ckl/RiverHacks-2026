import { defineConfig, loadEnv } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { nasaApiPlugin } from './server/nasa-api.js';
import { imageryTile } from './server/arcgis.js';

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
  build: {
    chunkSizeWarningLimit: 6000,
    rolldownOptions: {
      input: { missionforge: 'index.html', orbit: 'orbit.html', planner: 'planner.html' },
    },
  },
  plugins: [
    nasaApiPlugin(loadEnv, { imageryTile }),
    viteStaticCopy({
      targets: ['Assets', 'Widgets', 'Workers', 'ThirdParty'].map((folder) => ({
        src: `node_modules/cesium/Build/Cesium/${folder}`,
        dest: 'cesium',
        rename: { stripBase: 4 },
      })),
    }),
    {
      name: 'omit-oversized-unused-launch-webm',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'cinematics/.keep', source: '' });
      },
      closeBundle() {
        // Cloudflare Workers assets must each be below 25 MiB. The app uses
        // orion-mission-cut.mp4; this legacy WebM is not referenced.
        const oversized = 'dist/cinematics/mission-launch-1080p.webm';
        return import('node:fs/promises').then(({ unlink }) => unlink(oversized).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        }));
      },
    },
  ],
});
