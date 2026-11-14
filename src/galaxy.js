import * as C from 'cesium';

const BASE = (typeof CESIUM_BASE_URL === 'string' ? CESIUM_BASE_URL : '/cesium') + '/Assets/Textures/SkyBox/';
const FACES = [
  ['positiveX', 'px'], ['negativeX', 'mx'],
  ['positiveY', 'py'], ['negativeY', 'my'],
  ['positiveZ', 'pz'], ['negativeZ', 'mz']
];

function load(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

// Grades Cesium's Tycho star cube rather than inventing a sky: the real Milky
// Way band and its nebulosity pick up indigo and magenta, the empty sky goes
// deep violet instead of flat black, and actual stars stay white and sharp.
// Working per pixel on the existing faces means no seams between them.
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
    const nebula = Math.pow(luminance, 1.4);          // the diffuse band
    const star = Math.max(0, luminance - 0.74) / 0.26; // only the bright points
    data[i] = Math.min(255, 7 + r * 1.02 + nebula * 104 + star * 58);
    data[i + 1] = Math.min(255, 4 + g * 0.84 + nebula * 32 + star * 60);
    data[i + 2] = Math.min(255, 20 + b * 1.32 + nebula * 136 + star * 44);
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
