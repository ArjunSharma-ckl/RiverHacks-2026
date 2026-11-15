import * as C from 'cesium';
import { WMS_URL } from './gibs.js';

// Fade measured pixels into a reference mosaic over the last 12 degrees of
// coverage. A binary transparency key leaves a hard ring around polar night.
export async function trueColour(stamp, signal) {
  const width = 2048, height = 1024;
  const query = new URLSearchParams({
    service: 'WMS', request: 'GetMap', version: '1.1.1', srs: 'EPSG:4326',
    bbox: '-180,-90,180,90', width, height, format: 'image/png', time: stamp,
    layers: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor'
  });
  const load = async url => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('Imagery unavailable');
    return createImageBitmap(await response.blob());
  };
  const [daily, reference] = await Promise.all([
    load(WMS_URL + '?' + query), load('/textures/viirs-polar-reference.jpg')
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(daily, 0, 0); daily.close();
  const pixels = ctx.getImageData(0, 0, width, height);
  const rgba = pixels.data;
  const distance = new Uint8Array(width * height);
  const feather = 68;
  for (let j = 0; j < distance.length; j++) {
    const i = j * 4;
    distance[j] = rgba[i+3] && Math.max(rgba[i],rgba[i+1],rgba[i+2]) > 3 ? feather : 0;
  }
  for (const direction of [1, -1]) {
    for (let row = 0; row < height; row++) {
      const y = direction === 1 ? row : height - 1 - row;
      let edge = feather;
      // Start across the antimeridian so longitude wraps seamlessly.
      for (let col = -feather; col < width; col++) {
        const x = ((direction === 1 ? col : width-1-col) + width) % width;
        const j = y * width + x;
        edge = Math.min(distance[j], edge+1, row ? distance[j-direction*width]+1 : feather);
        distance[j] = edge;
      }
    }
  }
  for (let j = 0; j < distance.length; j++) {
    const t = distance[j] / feather;
    rgba[j*4+3] *= t*t*(3-2*t);
  }
  ctx.putImageData(pixels, 0, 0);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.drawImage(reference, 0, 0); reference.close();
  const provider = new C.SingleTileImageryProvider({ url: WMS_URL, tileWidth: width, tileHeight: height,
    credit: new C.Credit('NASA VIIRS · Daily imagery with seasonal polar reference', true) });
  provider.requestImage = () => Promise.resolve(canvas);
  return provider;
}
