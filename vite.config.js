import { objectSearch } from './object-search.js';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
  plugins: [objectSearch(),
    viteStaticCopy({
      targets: ['Assets', 'Widgets', 'Workers', 'ThirdParty'].map((folder) => ({
        src: `node_modules/cesium/Build/Cesium/${folder}`,
        dest: 'cesium',
        rename: { stripBase: 4 },
      })),
    }),
  ],
});

