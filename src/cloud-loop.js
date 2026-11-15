import * as C from 'cesium';
import { dropLayer, setLayer } from './layers.js';

const STEP = 3 * 3600_000;
export const CLOUD_KEYS = ['w:clouds:0', 'w:clouds:1', 'w:clouds:2'];

async function loadFrame(time, signal) {
  const url = '/api/weather/map?field=clouds&time=' + encodeURIComponent(new Date(time).toISOString());
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Cloud forecast unavailable');
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // BuPu progresses from almost white to dark purple as coverage increases.
  for (let i = 0; i < pixels.data.length; i += 4) {
    const cover = Math.min(1, (255 - pixels.data[i + 1]) / 245);
    pixels.data[i] = 95 + 90 * cover;
    pixels.data[i + 1] = 170 - 18 * cover;
    pixels.data[i + 2] = 238;
    pixels.data[i + 3] *= Math.pow(cover, 0.72);
  }
  ctx.putImageData(pixels, 0, 0);
  const smooth = canvas.cloneNode();
  const out = smooth.getContext('2d');
  out.filter = 'blur(1.1px)';
  for (const x of [-canvas.width, 0, canvas.width]) out.drawImage(canvas, x, 0);
  const provider = new C.SingleTileImageryProvider({
    url, tileWidth: smooth.width, tileHeight: smooth.height,
    credit: new C.Credit('NOAA GFS · Cloud cover', true)
  });
  provider.requestImage = () => Promise.resolve(smooth);
  return provider;
}

export function createCloudLoop(viewer) {
  let controller, layers = [], start = 0, opacity = 0.62;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function blend() {
    if (!layers.length) return;
    // Run from six hours ago to the selected forecast and back in 20 seconds.
    const phase = (performance.now() - start) % 20000 / 5000;
    const position = reducedMotion.matches ? 2 : 2 - Math.abs(phase - 2);
    layers.forEach((layer, i) => {
      layer.alpha = opacity * Math.max(0, 1 - Math.abs(position - i));
    });
  }
  viewer.scene.preRender.addEventListener(blend);
  function clear() {
    controller?.abort();
    layers = [];
    CLOUD_KEYS.forEach(dropLayer);
  }
  return {
    clear,
    setOpacity(value) { opacity = value; blend(); },
    async load(stamp) {
      controller?.abort();
      const request = controller = new AbortController();
      try {
        const end = Date.parse(stamp);
        const frames = await Promise.all(CLOUD_KEYS.map((_, i) =>
          loadFrame(end - (2 - i) * STEP, request.signal)));
        if (request.signal.aborted) return;
        layers = frames.map((provider, i) =>
          setLayer(CLOUD_KEYS[i], new C.ImageryLayer(provider, { alpha: 0 })));
        start = performance.now() - 10000;
        blend();
      } catch (error) {
        if (!request.signal.aborted) { clear(); throw error; }
      }
    }
  };
}
