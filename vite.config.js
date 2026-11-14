import { defineConfig, loadEnv } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { nasaApiPlugin } from './server/nasa-api.js';

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
  build: {
    rollupOptions: { input: { missionforge: "index.html", orbit: "orbit.html" } },
    chunkSizeWarningLimit: 6000,
  },
  plugins: [
    nasaApiPlugin(loadEnv),
    viteStaticCopy({
      targets: ['Assets', 'Widgets', 'Workers', 'ThirdParty'].map((folder) => ({
        src: `node_modules/cesium/Build/Cesium/${folder}`,
        dest: 'cesium',
        rename: { stripBase: 4 },
      })),
    }),
  ],
});

