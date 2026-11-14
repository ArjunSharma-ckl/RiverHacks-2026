import * as C from 'cesium';

const BASE = (typeof CESIUM_BASE_URL === 'string' ? CESIUM_BASE_URL : '/cesium') + '/Assets/Textures/SkyBox/';
const FACES = [
  ['positiveX', 'px'], ['negativeX', 'mx'],
  ['positiveY', 'py'], ['negativeY', 'my'],
  ['positiveZ', 'pz'], ['negativeZ', 'mz']
];

// Anything dimmer than this is empty sky and is forced to true black, so the
// stars have something to stand out against.
const FLOOR = 0.04;

function load(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function smoothstep(value, low, high) {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

// Colour across the Milky Way, from its faint outer edges to the bright core:
// indigo, teal, magenta, then warm gold where the band is densest.
const STOPS = [
  [0.00, 22, 12, 60],
  [0.30, 26, 92, 150],
  [0.55, 158, 54, 148],
  [0.78, 240, 132, 92],
  [1.00, 255, 216, 170]
];

function ramp(t) {
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [p0, r0, g0, b0] = STOPS[i - 1];
      const [p1, r1, g1, b1] = STOPS[i];
      const k = (t - p0) / (p1 - p0);
      return [r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k];
    }
  }
  const last = STOPS[STOPS.length - 1];
  return [last[1], last[2], last[3]];
}

// Grades Cesium's Tycho star cube rather than inventing a sky, so the band is
// the real Milky Way. Each pixel is split into a point-source part and a
// diffuse part: stars keep their own colour and get brighter, the diffuse
// band picks up the ramp above, and empty sky goes to black. Working per
// pixel on the existing faces keeps the cube seamless.
function grade(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = frame.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const lifted = (luminance - FLOOR) / (1 - FLOOR);
    if (lifted <= 0) {
      data[i] = data[i + 1] = data[i + 2] = 0;
      continue;
    }
    const star = smoothstep(luminance, 0.22, 0.5);
    const diffuse = lifted * (1 - star);
    const [cr, cg, cb] = ramp(Math.min(1, diffuse / 0.18));
    // Keep stars close to their own brightness and colour instead of
    // driving them all into clipped white; the band gets the colour.
    const gain = 0.85 + star * 0.55;
    const tint = diffuse * 3.5;
    data[i] = Math.min(255, r * gain + cr * tint);
    data[i + 1] = Math.min(255, g * gain + cg * tint);
    data[i + 2] = Math.min(255, b * gain + cb * tint);
  }

  context.putImageData(frame, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

export async function paintGalaxy(scene) {
  try {
    const sources = {};
    await Promise.all(FACES.map(async ([key, suffix]) => {
      sources[key] = grade(await load(`${BASE}tycho2t3_80_${suffix}.jpg`));
    }));
    scene.skyBox = new C.SkyBox({ sources });
  } catch {
    // Keep Cesium's own star box if the textures cannot be read.
  }
}
