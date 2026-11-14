// Procedural planet and ring textures, so bodies without a bundled image still
// render as something better than a flat colour. Returns data URLs.

function surface(width, height) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return element;
}

function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function turbulence(context, width, height, next, strength) {
  for (let i = 0; i < 260; i++) {
    context.globalAlpha = strength * (0.3 + next() * 0.8);
    context.fillStyle = next() > 0.5 ? '#ffffff' : '#000000';
    context.beginPath();
    context.ellipse(next() * width, next() * height, width * (0.05 + next() * 0.2), 2 + next() * height * 0.03, 0, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

export function bandedTexture({ bands, seed = 1, strength = 0.08, width = 1024, height = 512 }) {
  const element = surface(width, height);
  const context = element.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, height);
  for (const [stop, color] of bands) gradient.addColorStop(stop, color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  turbulence(context, width, height, random(seed), strength);
  return element.toDataURL('image/jpeg', 0.88);
}

export function crateredTexture({ base, shades, craters = 420, seed = 7, width = 1024, height = 512 }) {
  const element = surface(width, height);
  const context = element.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);
  const next = random(seed);
  for (let i = 0; i < 160; i++) {
    context.globalAlpha = 0.05 + next() * 0.08;
    context.fillStyle = shades[Math.floor(next() * shades.length)];
    context.beginPath();
    context.ellipse(next() * width, next() * height, width * (0.03 + next() * 0.12), height * (0.02 + next() * 0.08), 0, 0, Math.PI * 2);
    context.fill();
  }
  for (let i = 0; i < craters; i++) {
    const radius = 1 + next() * 9;
    const x = next() * width;
    const y = next() * height;
    context.globalAlpha = 0.18 + next() * 0.3;
    context.fillStyle = '#000000';
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.14 + next() * 0.26;
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.arc(x - radius * 0.3, y - radius * 0.3, radius * 0.75, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
  return element.toDataURL('image/jpeg', 0.88);
}

// A radial strip: the ring geometry maps the vertical axis across the ring's
// width, so gaps are drawn as transparent rows.
export function ringTexture({ seed = 3, width = 16, height = 512 } = {}) {
  const element = surface(width, height);
  const context = element.getContext('2d');
  const next = random(seed);
  for (let y = 0; y < height; y++) {
    const t = y / height;
    let alpha = 0.72;
    if (t < 0.06 || t > 0.985) alpha = 0;
    if (t > 0.46 && t < 0.5) alpha *= 0.12;
    if (t > 0.79 && t < 0.815) alpha *= 0.25;
    alpha *= 0.72 + 0.28 * Math.sin(t * 46);
    alpha *= 0.86 + next() * 0.14;
    const warmth = 196 + Math.round(34 * Math.sin(t * 17));
    context.fillStyle = `rgba(${warmth}, ${warmth - 22}, ${warmth - 62}, ${Math.max(0, alpha).toFixed(3)})`;
    context.fillRect(0, y, width, 1);
  }
  return element.toDataURL('image/png');
}
